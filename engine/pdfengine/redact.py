"""Redaction: mark areas, review the marks, then remove what is under them.

Marks are Redact annotations; nothing is removed until ``apply_redactions``.
Applying removes, for each mark:

- **text** whose characters have their centre inside the mark. MuPDF removes
  every glyph whose box merely *touches* a redaction rectangle, and line boxes
  overlap their neighbours, so a mark over one word would also eat letters of
  the lines above and below. The text pass therefore redacts thin bands drawn
  through the centres of the chosen characters only;
- **image pixels** under the mark (``PDF_REDACT_IMAGE_PIXELS``); the rest of
  each image stays;
- **vector graphics** entirely covered by the mark;
- **annotations and form fields** overlapping the mark (their text or value
  could carry what is being removed).

Then the mark's fill (and optional overlay text) is painted, and by default
the document's metadata is cleared. All of it is one undo step. The saved file
cannot contain the removed content: saving writes a fresh, garbage-collected
copy (``save.py``), so the old content streams are not in it.
"""

import re
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any

import pymupdf
from pymupdf import mupdf

from .annotations import _bounds, _rect, check_rect, hex_color, rgb_color
from .errors import BadRequestError, NotFoundError
from .sessions import Session
from .text import search_page
from .textpages import content_text_page

#: Half the height of the band drawn through the centre of each text run.
BAND = 0.4
#: Smallest area (square points) an annotation must share with a mark to be
#: removed with it; avoids removing neighbours that only touch its edge.
MIN_OVERLAP = 1.0

DEFAULT_FILL = "#000000"
#: Key on a mark made for an annotation (search found its comment): the
#: annotation's xref. Such a mark removes that annotation and nothing else.
TARGET_KEY = "PDFnixTarget"


@dataclass
class _Area:
    rect: pymupdf.Rect  # displayed space
    fill: tuple[float, float, float] | None
    overlay: str
    #: How far text after a removed run moved back (see ``_measure_shifts``),
    #: and the displayed direction of that text.
    shrink: float = 0.0
    direction: tuple[float, float] = (1.0, 0.0)


@dataclass
class _Follower:
    """The first kept character after a removed run, on the same line."""

    area: int
    char: str
    centre: pymupdf.Point  # unrotated space
    direction: tuple[float, float]  # unrotated


# --- Marks ----------------------------------------------------------------------


def _overlay_text(annot: pymupdf.Annot) -> str:
    obj = mupdf.pdf_annot_obj(annot.this)
    return mupdf.pdf_to_text_string(mupdf.pdf_dict_gets(obj, "OverlayText"))


def _fill(annot: pymupdf.Annot) -> tuple[float, float, float] | None:
    fill = annot.colors.get("fill")
    return tuple(fill) if fill and len(fill) == 3 else None  # type: ignore[return-value]


def _marks(page: pymupdf.Page) -> list[pymupdf.Annot]:
    return list(page.annots(types=[pymupdf.PDF_ANNOT_REDACT]))


def _words_in(page: pymupdf.Page, rect: pymupdf.Rect, words: list[tuple] | None = None) -> str:
    """The page's own text under ``rect`` (displayed space), for review."""
    if words is None:
        words = content_text_page(page, 0, derotate=False).extractWORDS()
    chosen = [
        word[4]
        for word in words
        if rect.contains(pymupdf.Point((word[0] + word[2]) / 2, (word[1] + word[3]) / 2))
    ]
    return " ".join(chosen)


def _describe(
    annot: pymupdf.Annot, page: pymupdf.Page, index: int, words: list[tuple]
) -> dict[str, Any]:
    """``kind`` is "area" (removes what is under it) or "annotation"
    (removes one annotation, whose comment is then ``text``)."""
    rect = _bounds(annot)
    target = _target(annot)
    if target is not None:
        comment = ""
        for other in page.annots():
            if other.xref == target:
                comment = other.info.get("content") or ""
        return {
            "annotId": annot.xref,
            "page": index,
            "rect": _rect(rect),
            "kind": "annotation",
            "fill": None,
            "overlayText": "",
            "text": comment,
        }
    return {
        "annotId": annot.xref,
        "page": index,
        "rect": _rect(rect),
        "kind": "area",
        "fill": hex_color(_fill(annot)),
        "overlayText": _overlay_text(annot),
        "text": _words_in(page, rect, words),
    }


def list_marks(session: Session) -> list[dict[str, Any]]:
    """Pending redaction marks, in page order."""
    with session.lock:
        result = []
        for index, page in enumerate(session.doc):
            marks = _marks(page)
            if not marks:
                continue
            words = content_text_page(page, 0, derotate=False).extractWORDS()
            result.extend(_describe(annot, page, index, words) for annot in marks)
        return result


def _quad_rect(values: Sequence[float]) -> pymupdf.Rect:
    if len(values) != 8:
        raise BadRequestError("A quad is eight numbers.")
    xs, ys = values[0::2], values[1::2]
    return check_rect([min(xs), min(ys), max(xs), max(ys)], "quad")


def _target(annot: pymupdf.Annot) -> int | None:
    """The annotation a mark removes, for marks made for an annotation."""
    value = mupdf.pdf_dict_gets(mupdf.pdf_annot_obj(annot.this), TARGET_KEY)
    return mupdf.pdf_to_int(value) if mupdf.pdf_is_int(value) else None


def _add_mark(
    page: pymupdf.Page,
    rect: pymupdf.Rect,
    fill: str | None,
    overlay: str,
    *,
    target: int | None = None,
) -> pymupdf.Annot:
    """Adds one mark (``rect`` displayed). With ``target`` (an annotation's
    xref) applying the mark removes that annotation and nothing else. Call
    inside an edit."""
    annot = page.add_redact_annot(
        rect * page.derotation_matrix,
        text=overlay or None,
        fill=rgb_color(fill) if fill else False,
        cross_out=False,
    )
    # Red outline, so other readers show the mark the same way.
    annot.set_colors(stroke=(1, 0, 0))
    annot.update(cross_out=False)
    if target is not None:
        obj = mupdf.pdf_annot_obj(annot.this)
        mupdf.pdf_dict_puts(obj, TARGET_KEY, mupdf.pdf_new_int(target))
    return annot


def add_marks(
    session: Session,
    index: int,
    *,
    rects: list[list[float]] | None = None,
    quads: list[list[float]] | None = None,
    fill: str | None = DEFAULT_FILL,
    overlay_text: str = "",
) -> dict[str, Any]:
    """Marks areas of page ``index`` for redaction: ``rects`` (dragged areas)
    or ``quads`` (selected text, one per line), displayed space."""
    areas = [check_rect(rect) for rect in rects or []]
    areas += [_quad_rect(quad) for quad in quads or []]
    if not areas:
        raise BadRequestError("Give the areas to mark as rects or quads.")
    with session.lock:
        page = session.page(index)
        with session.edit("Mark for Redaction") as step:
            created = [_add_mark(page, rect, fill, overlay_text) for rect in areas]
            step.pages.add(index)
        words = content_text_page(page, 0, derotate=False).extractWORDS()
        marks = [_describe(annot, page, index, words) for annot in created]
        return {**session.mutated(step.pages), "marks": marks}


_NOT_SEARCHED = {
    pymupdf.PDF_ANNOT_REDACT,
    pymupdf.PDF_ANNOT_POPUP,
    pymupdf.PDF_ANNOT_LINK,
    pymupdf.PDF_ANNOT_WIDGET,
}


def _annotation_matches(
    page: pymupdf.Page, needle: str, match_case: bool, whole_word: bool
) -> list[pymupdf.Annot]:
    """Annotations whose comment contains ``needle``. Their text is not on the
    page (a note shows only its icon), so search does not find it, but it would
    leak what is being redacted."""
    flags = 0 if match_case else re.IGNORECASE
    pattern = re.escape(needle).replace(r"\ ", r"\s+")
    if whole_word:
        pattern = rf"(?<!\w){pattern}(?!\w)"
    regex = re.compile(pattern, flags)
    found = []
    for annot in page.annots():
        if annot.type[0] in _NOT_SEARCHED:
            continue
        if regex.search(annot.info.get("content") or "") or regex.search(
            annot.info.get("subject") or ""
        ):
            found.append(annot)
    return found


def search_and_mark(
    session: Session,
    query: str,
    *,
    match_case: bool = False,
    whole_word: bool = False,
    pages: list[int] | None = None,
    fill: str | None = DEFAULT_FILL,
    overlay_text: str = "",
) -> dict[str, Any]:
    """Marks every match of ``query`` (one mark per line a match spans), and
    every annotation whose comment contains it (a mark over the annotation, so
    applying removes it). ``matches`` counts both."""
    needle = " ".join(query.split())
    if not needle:
        raise BadRequestError("Enter the text to find.")
    with session.lock:
        count = session.page_count
        targets = sorted(set(pages)) if pages is not None else list(range(count))
        for index in targets:
            session.page(index)
        # Per match: page, rects of text to mark, or the xref of an annotation.
        found: list[tuple[int, list[pymupdf.Rect], int | None]] = []
        for index in targets:
            page = session.page(index)
            for hit in search_page(page, index, needle, match_case, whole_word):
                found.append((index, [_quad_rect(quad) for quad in hit["quads"]], None))
            for annot in _annotation_matches(page, needle, match_case, whole_word):
                found.append((index, [_bounds(annot)], annot.xref))
        if not found:
            return {**session.unchanged(), "matches": 0, "marks": []}
        with session.edit("Mark for Redaction") as step:
            kept: list[tuple[int, pymupdf.Page]] = []
            created: list[tuple[int, pymupdf.Annot]] = []
            for index, rects, target in found:
                page = session.doc[index]
                kept.append((index, page))
                for rect in rects:
                    if target is None:
                        created.append((index, _add_mark(page, rect, fill, overlay_text)))
                    else:
                        created.append((index, _add_mark(page, rect, None, "", target=target)))
                step.pages.add(index)
        marks = []
        words_by_page: dict[int, list[tuple]] = {}
        pages_by_index = dict(kept)
        for index, annot in created:
            page = pages_by_index[index]
            if index not in words_by_page:
                words_by_page[index] = content_text_page(page, 0, derotate=False).extractWORDS()
            marks.append(_describe(annot, page, index, words_by_page[index]))
        return {**session.mutated(step.pages), "matches": len(found), "marks": marks}


def remove_mark(session: Session, annot_id: int) -> dict[str, Any]:
    with session.lock:
        for index, page in enumerate(session.doc):
            for annot in _marks(page):
                if annot.xref == annot_id:
                    with session.edit("Remove Redaction Mark") as step:
                        page.delete_annot(annot)
                        step.pages.add(index)
                    return session.mutated(step.pages)
        raise NotFoundError(f"No redaction mark with id {annot_id}.")


# --- Applying -------------------------------------------------------------------------


def _band(run: list[pymupdf.Point], direction: tuple[float, float]) -> list[pymupdf.Rect]:
    """Rectangles through the character centres of one run of a line."""
    dx, dy = direction
    if abs(dy) < 1e-3:  # horizontal
        xs = [p.x for p in run]
        y = sum(p.y for p in run) / len(run)
        return [pymupdf.Rect(min(xs) - 0.2, y - BAND, max(xs) + 0.2, y + BAND)]
    if abs(dx) < 1e-3:  # vertical
        ys = [p.y for p in run]
        x = sum(p.x for p in run) / len(run)
        return [pymupdf.Rect(x - BAND, min(ys) - 0.2, x + BAND, max(ys) + 0.2)]
    return [pymupdf.Rect(p.x - BAND, p.y - BAND, p.x + BAND, p.y + BAND) for p in run]


def _chars(page: pymupdf.Page) -> list[tuple[dict[str, Any], tuple[float, float]]]:
    """Every character of the page content with its line direction, in
    unrotated space, in content order."""
    data = content_text_page(page, 0).extractRAWDICT()
    out = []
    for block in data["blocks"]:
        if block.get("type", 0) != 0:
            continue
        for line in block["lines"]:
            direction = tuple(line["dir"])
            for span in line["spans"]:
                for char in span["chars"]:
                    out.append((char, direction))
    return out


def _centre(char: dict[str, Any]) -> pymupdf.Point:
    box = pymupdf.Rect(char["bbox"])
    return pymupdf.Point((box.x0 + box.x1) / 2, (box.y0 + box.y1) / 2)


def _text_bands(
    page: pymupdf.Page, areas: list[_Area]
) -> tuple[list[pymupdf.Rect], list[_Follower]]:
    """Thin rectangles (unrotated space) through the centres of the characters
    whose centre lies in an area: redacting them removes exactly those
    characters. Also the character after each removed run (see
    ``_measure_shifts``)."""
    to_display = page.rotation_matrix
    data = content_text_page(page, 0).extractRAWDICT()
    bands: list[pymupdf.Rect] = []
    followers: list[_Follower] = []
    for block in data["blocks"]:
        if block.get("type", 0) != 0:
            continue
        for line in block["lines"]:
            direction = tuple(line["dir"])
            run: list[pymupdf.Point] = []
            run_area = -1
            # The area of the run just closed, until a visible kept character follows.
            waiting = -1
            for span in line["spans"]:
                for char in span["chars"]:
                    centre = _centre(char)
                    shown = centre * to_display
                    hit = next((i for i, area in enumerate(areas) if area.rect.contains(shown)), -1)
                    if hit >= 0:
                        run.append(centre)
                        run_area = hit
                        waiting = -1
                        continue
                    if run:
                        bands.extend(_band(run, direction))
                        waiting = run_area
                        run = []
                    if waiting >= 0 and char["c"].strip():
                        followers.append(_Follower(waiting, char["c"], centre, direction))
                        waiting = -1
            if run:
                bands.extend(_band(run, direction))
    return bands, followers


def _measure_shifts(page: pymupdf.Page, areas: list[_Area], followers: list[_Follower]) -> None:
    """MuPDF 1.28 workaround. When it removes glyphs from the middle of a
    text string, the text after them in that string moves back by the advance
    of the first removed glyph (``test_mupdf_still_shifts_text_after_a_removed_run``).
    The text stays, but would slide under the fill. This measures how far the
    character after each removed run moved, so the fill can be painted that
    much shorter and leave it visible."""
    if not followers:
        return
    after = _chars(page)
    rotate = page.rotation_matrix
    for follower in followers:
        dx, dy = follower.direction
        best: float | None = None
        for char, direction in after:
            if char["c"] != follower.char or direction != follower.direction:
                continue
            centre = _centre(char)
            # Along the line (positive is forward) and across it.
            along = (centre.x - follower.centre.x) * dx + (centre.y - follower.centre.y) * dy
            across = -(centre.x - follower.centre.x) * dy + (centre.y - follower.centre.y) * dx
            if abs(across) > 0.5 or not -40 <= along <= 0.05:
                continue
            if best is None or abs(along) < abs(best):
                best = along
        if best is not None and best < -0.05:
            area = areas[follower.area]
            area.shrink = max(area.shrink, -best)
            shown = pymupdf.Point(dx, dy) * rotate - pymupdf.Point(0, 0) * rotate
            area.direction = (shown.x, shown.y)


def _remove_overlapping_annotations(page: pymupdf.Page, areas: list[_Area]) -> None:
    def overlaps(rect: pymupdf.Rect) -> bool:
        for area in areas:
            shared = pymupdf.Rect(rect) & area.rect
            if not shared.is_empty and shared.width * shared.height >= MIN_OVERLAP:
                return True
        return False

    for widget in list(page.widgets()):
        if overlaps(_bounds(widget._annot)):
            page.delete_widget(widget)
    for annot in list(page.annots()):
        if annot.type[0] in (pymupdf.PDF_ANNOT_REDACT, pymupdf.PDF_ANNOT_POPUP):
            continue
        if overlaps(_bounds(annot)):
            page.delete_annot(annot)


def _text_color(fill: tuple[float, float, float] | None) -> tuple[float, float, float]:
    if fill is None:
        return (0, 0, 0)
    r, g, b = fill
    return (1, 1, 1) if 0.299 * r + 0.587 * g + 0.114 * b < 0.5 else (0, 0, 0)


def _fill_rect(area: _Area) -> pymupdf.Rect:
    """The area to paint (displayed space): the mark, shortened at its end
    by how far the following text moved back (``_measure_shifts``)."""
    rect = pymupdf.Rect(area.rect)
    shrink = area.shrink
    if shrink <= 0:
        return rect
    ux, uy = area.direction
    if ux > 0.5:
        rect.x1 = max(rect.x0 + 1, rect.x1 - shrink)
    elif ux < -0.5:
        rect.x0 = min(rect.x1 - 1, rect.x0 + shrink)
    elif uy > 0.5:
        rect.y1 = max(rect.y0 + 1, rect.y1 - shrink)
    elif uy < -0.5:
        rect.y0 = min(rect.y1 - 1, rect.y0 + shrink)
    return rect


def _paint(page: pymupdf.Page, area: _Area) -> None:
    rect = _fill_rect(area) * page.derotation_matrix
    if area.fill is not None:
        page.draw_rect(rect, color=None, fill=area.fill, width=0, overlay=True)
    if area.overlay:
        # Upright for the reader (rotate=page.rotation), so the displayed
        # height limits the size.
        size = min(12.0, max(4.0, area.rect.height * 0.7))
        while size >= 4:
            spare = page.insert_textbox(
                rect,
                area.overlay,
                fontname="helv",
                fontsize=size,
                color=_text_color(area.fill),
                align=pymupdf.TEXT_ALIGN_CENTER,
                rotate=page.rotation,
            )
            if spare >= 0:
                break
            size -= 1


def _apply_page(page: pymupdf.Page) -> bool:
    """Applies the marks of one page. Returns whether there were any."""
    marks = _marks(page)
    if not marks:
        return False
    targets = {target for annot in marks if (target := _target(annot)) is not None}
    areas = [
        _Area(_bounds(annot), _fill(annot), _overlay_text(annot))
        for annot in marks
        if _target(annot) is None
    ]
    for annot in marks:
        page.delete_annot(annot)
    for annot in list(page.annots()):
        if annot.xref in targets:
            page.delete_annot(annot)
    if not areas:
        return True
    _remove_overlapping_annotations(page, areas)

    bands, followers = _text_bands(page, areas)
    if bands:
        for band in bands:
            page.add_redact_annot(band, fill=False)
        page.apply_redactions(
            images=pymupdf.PDF_REDACT_IMAGE_NONE,
            graphics=pymupdf.PDF_REDACT_LINE_ART_NONE,
            text=pymupdf.PDF_REDACT_TEXT_REMOVE,
        )
        _measure_shifts(page, areas, followers)
    for area in areas:
        page.add_redact_annot(area.rect * page.derotation_matrix, fill=False)
    page.apply_redactions(
        images=pymupdf.PDF_REDACT_IMAGE_PIXELS,
        graphics=pymupdf.PDF_REDACT_LINE_ART_REMOVE_IF_COVERED,
        text=pymupdf.PDF_REDACT_TEXT_NONE,
    )
    for area in areas:
        _paint(page, area)
    return True


def apply_redactions(session: Session, *, clean_metadata: bool = True) -> dict[str, Any]:
    """Removes the content under every mark, as one undoable step. With
    ``clean_metadata`` the document's title, author and other information and
    its XMP metadata are removed too."""
    with session.lock:
        doc = session.doc
        if not any(_marks(page) for page in doc):
            raise BadRequestError("There are no redaction marks to apply.")
        with session.edit("Apply Redactions") as step:
            for index in range(doc.page_count):
                page = doc[index]
                if _apply_page(page):
                    step.pages.add(index)
            if clean_metadata:
                doc.set_metadata({})
                doc.del_xml_metadata()
        return {**session.mutated(step.pages), "metadataCleaned": clean_metadata}
