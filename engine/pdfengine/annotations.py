"""Annotations: text markup (highlight, underline, strikeout) and notes.

Coordinates in and out are PDF points in the page's displayed (rotated) space.
PyMuPDF's own annotation geometry is inconsistent on rotated pages
(``Annot.rect`` and ``add_highlight_annot`` use the unrotated space,
``add_text_annot`` the displayed one, and notes, which do not rotate with the
page, are anchored at a corner that depends on the rotation), so this module
reads bounds with MuPDF's ``pdf_bound_annot``, which matches what is drawn,
and places notes by moving them until their drawn bounds are where asked.

``annotId`` is the annotation's xref: stable for the life of a session,
including across undo, redo and save.
"""

from collections.abc import Sequence
from typing import Any, Literal

import pymupdf
from pymupdf import mupdf

from .errors import BadRequestError, NotFoundError
from .info import parse_pdf_date
from .sessions import Session

MarkupType = Literal["highlight", "underline", "strikeout"]

_TYPE_NAMES = {
    pymupdf.PDF_ANNOT_TEXT: "note",
    pymupdf.PDF_ANNOT_HIGHLIGHT: "highlight",
    pymupdf.PDF_ANNOT_UNDERLINE: "underline",
    pymupdf.PDF_ANNOT_STRIKE_OUT: "strikeout",
    pymupdf.PDF_ANNOT_SQUIGGLY: "squiggly",
    pymupdf.PDF_ANNOT_FREE_TEXT: "freetext",
    pymupdf.PDF_ANNOT_INK: "ink",
    pymupdf.PDF_ANNOT_SQUARE: "square",
    pymupdf.PDF_ANNOT_CIRCLE: "circle",
    pymupdf.PDF_ANNOT_LINE: "line",
    pymupdf.PDF_ANNOT_POLYGON: "polygon",
    pymupdf.PDF_ANNOT_POLY_LINE: "polyline",
    pymupdf.PDF_ANNOT_STAMP: "stamp",
    pymupdf.PDF_ANNOT_CARET: "caret",
    pymupdf.PDF_ANNOT_FILE_ATTACHMENT: "attachment",
    pymupdf.PDF_ANNOT_REDACT: "redact",
}
#: Not shown or edited as annotations: pop-ups belong to their parent, form
#: fields are phase 5's, links are not annotations to the user.
_HIDDEN = {pymupdf.PDF_ANNOT_POPUP, pymupdf.PDF_ANNOT_WIDGET, pymupdf.PDF_ANNOT_LINK}
#: Annotation types that follow text and have quads.
_TEXT_MARKUP = {
    pymupdf.PDF_ANNOT_HIGHLIGHT,
    pymupdf.PDF_ANNOT_UNDERLINE,
    pymupdf.PDF_ANNOT_STRIKE_OUT,
    pymupdf.PDF_ANNOT_SQUIGGLY,
}
#: Types that can be moved with ``rect`` in this phase.
_MOVABLE = {pymupdf.PDF_ANNOT_TEXT}

_STEP_NAMES = {"highlight": "Highlight", "underline": "Underline", "strikeout": "Strikeout"}

NOTE_ICON = "Comment"


def _round(value: float) -> float:
    return round(value, 2)


def _rect(rect: pymupdf.Rect) -> list[float]:
    return [_round(rect.x0), _round(rect.y0), _round(rect.x1), _round(rect.y1)]


def _bounds(annot: pymupdf.Annot) -> pymupdf.Rect:
    """What the annotation covers on the displayed page."""
    return pymupdf.Rect(mupdf.pdf_bound_annot(annot.this))


def hex_color(rgb: Sequence[float] | None) -> str | None:
    if not rgb or len(rgb) != 3:
        return None
    return "#" + "".join(f"{max(0, min(255, round(c * 255))):02x}" for c in rgb)


def rgb_color(value: str) -> tuple[float, float, float]:
    """``#rrggbb`` to PyMuPDF's 0..1 floats."""
    text = value.removeprefix("#")
    if len(text) != 6:
        raise BadRequestError(f"Not a colour: {value!r}. Use #rrggbb.")
    try:
        r, g, b = (int(text[i : i + 2], 16) for i in (0, 2, 4))
    except ValueError:
        raise BadRequestError(f"Not a colour: {value!r}. Use #rrggbb.") from None
    return (r / 255, g / 255, b / 255)


def _quads_out(annot: pymupdf.Annot, page: pymupdf.Page) -> list[list[float]]:
    """The annotation's quads in displayed space, each as
    ``[ulx, uly, urx, ury, llx, lly, lrx, lry]`` relative to the text."""
    matrix = page.rotation_matrix
    points = annot.vertices or []
    quads: list[list[float]] = []
    for start in range(0, len(points) - 3, 4):
        values: list[float] = []
        for point in points[start : start + 4]:
            moved = pymupdf.Point(point) * matrix
            values.extend((_round(moved.x), _round(moved.y)))
        quads.append(values)
    return quads


def _quads_in(quads: list[list[float]], page: pymupdf.Page) -> list[pymupdf.Quad]:
    """Quads from the API (displayed space) in the space PyMuPDF expects."""
    if not quads:
        raise BadRequestError("At least one quad is needed.")
    matrix = page.derotation_matrix
    result: list[pymupdf.Quad] = []
    for values in quads:
        if len(values) != 8:
            raise BadRequestError("A quad is eight numbers: ul, ur, ll, lr as x, y pairs.")
        corners = [pymupdf.Point(values[i], values[i + 1]) * matrix for i in range(0, 8, 2)]
        quad = pymupdf.Quad(*corners)
        if quad.is_empty:
            continue
        result.append(quad)
    if not result:
        raise BadRequestError("The quads cover no area.")
    return result


def describe(annot: pymupdf.Annot, page: pymupdf.Page, index: int) -> dict[str, Any]:
    kind = annot.type[0]
    info = annot.info
    opacity = annot.opacity
    result: dict[str, Any] = {
        "annotId": annot.xref,
        "page": index,
        "type": _TYPE_NAMES.get(kind, str(annot.type[1]).lower()),
        "rect": _rect(_bounds(annot)),
        "color": hex_color(annot.colors.get("stroke")),
        "opacity": 1.0 if opacity is None or opacity < 0 else round(opacity, 3),
        "contents": info.get("content") or "",
        "author": info.get("title") or "",
        "createdAt": parse_pdf_date(info.get("creationDate")),
        "modifiedAt": parse_pdf_date(info.get("modDate")),
    }
    if kind in _TEXT_MARKUP:
        result["quads"] = _quads_out(annot, page)
    return result


def _visible(annot: pymupdf.Annot) -> bool:
    return annot.type[0] not in _HIDDEN


def list_annotations(session: Session, page: int | None = None) -> list[dict[str, Any]]:
    """The annotations of one page, or of the whole document, in page order."""
    with session.lock:
        indexes = [page] if page is not None else range(session.page_count)
        result: list[dict[str, Any]] = []
        for index in indexes:
            pdf_page = session.page(index)
            result.extend(
                describe(annot, pdf_page, index) for annot in pdf_page.annots() if _visible(annot)
            )
        return result


def _find(
    session: Session, annot_id: int, page_hint: int | None
) -> tuple[int, pymupdf.Page, pymupdf.Annot]:
    """The annotation with xref ``annot_id``. Call with the lock held.

    ``page_hint`` is where the caller believes it is; without it (or if it is
    wrong) every page is searched.
    """
    doc = session.doc
    order: list[int] = []
    if page_hint is not None and 0 <= page_hint < doc.page_count:
        order.append(page_hint)
    order.extend(index for index in range(doc.page_count) if index != page_hint)
    for index in order:
        page = doc[index]
        if any(xref == annot_id for xref, *_ in page.annot_xrefs()):
            annot = page.load_annot(annot_id)
            if annot is not None and _visible(annot):
                return index, page, annot
            break
    raise NotFoundError(f"No annotation with id {annot_id}.")


def _move_to(annot: pymupdf.Annot, x: float, y: float) -> None:
    """Moves the annotation so its drawn bounds start at (x, y), displayed space.

    Moving the annotation's rectangle by a displayed-space offset moves its
    drawn bounds by the same offset, also for notes on rotated pages; the
    second pass only corrects rounding.
    """
    for _ in range(2):
        bounds = _bounds(annot)
        dx, dy = x - bounds.x0, y - bounds.y0
        if abs(dx) < 0.01 and abs(dy) < 0.01:
            return
        rect = mupdf.pdf_annot_rect(annot.this)
        mupdf.pdf_set_annot_rect(
            annot.this, mupdf.FzRect(rect.x0 + dx, rect.y0 + dy, rect.x1 + dx, rect.y1 + dy)
        )
        annot.update()


def _clamp_point(page: pymupdf.Page, x: float, y: float, size: pymupdf.Rect) -> tuple[float, float]:
    """Keeps an annotation of ``size`` on the page."""
    area = page.rect
    x = min(max(x, area.x0), max(area.x0, area.x1 - size.width))
    y = min(max(y, area.y0), max(area.y0, area.y1 - size.height))
    return x, y


def _stamp(annot: pymupdf.Annot, author: str | None, *, created: bool) -> None:
    now = pymupdf.get_pdf_now()
    if created:
        annot.set_info(title=author or None, creationDate=now, modDate=now)
    else:
        annot.set_info(modDate=now)


def create_markup(
    session: Session,
    kind: MarkupType,
    page_index: int,
    quads: list[list[float]],
    color: str,
    author: str | None,
    contents: str | None = None,
) -> dict[str, Any]:
    rgb = rgb_color(color)
    with session.lock:
        page = session.page(page_index)
        converted = _quads_in(quads, page)
        add = {
            "highlight": page.add_highlight_annot,
            "underline": page.add_underline_annot,
            "strikeout": page.add_strikeout_annot,
        }[kind]
        with session.edit(_STEP_NAMES[kind]) as step:
            annot = add(converted)
            if annot is None:
                raise BadRequestError("The annotation could not be created.")
            annot.set_colors(stroke=rgb)
            _stamp(annot, author, created=True)
            if contents:
                mupdf.pdf_set_annot_contents(annot.this, contents)
            annot.update()
            step.pages.add(page_index)
        response = session.mutated(step.pages)
        response["annotation"] = describe(annot, page, page_index)
        return response


def create_note(
    session: Session,
    page_index: int,
    point: tuple[float, float],
    contents: str,
    color: str,
    author: str | None,
) -> dict[str, Any]:
    rgb = rgb_color(color)
    with session.lock:
        page = session.page(page_index)
        with session.edit("Note") as step:
            annot = page.add_text_annot(page.rect.tl, contents or "", icon=NOTE_ICON)
            annot.set_colors(stroke=rgb)
            _stamp(annot, author, created=True)
            if not contents:
                mupdf.pdf_set_annot_contents(annot.this, "")
            annot.update()
            x, y = _clamp_point(page, point[0], point[1], _bounds(annot))
            _move_to(annot, x, y)
            step.pages.add(page_index)
        response = session.mutated(step.pages)
        response["annotation"] = describe(annot, page, page_index)
        return response


def update_annotation(
    session: Session,
    annot_id: int,
    page_hint: int | None,
    *,
    contents: str | None = None,
    color: str | None = None,
    opacity: float | None = None,
    rect: list[float] | None = None,
) -> dict[str, Any]:
    rgb = rgb_color(color) if color is not None else None
    if opacity is not None and not 0 <= opacity <= 1:
        raise BadRequestError("Opacity is between 0 and 1.")
    if rect is not None and len(rect) != 4:
        raise BadRequestError("A rect is four numbers: x0, y0, x1, y1.")
    changes = [
        name
        for name, value in (
            ("Edit Comment", contents),
            ("Change Colour", color),
            ("Change Opacity", opacity),
            ("Move", rect),
        )
        if value is not None
    ]
    if not changes:
        raise BadRequestError("Nothing to change.")

    with session.lock:
        index, page, annot = _find(session, annot_id, page_hint)
        if rect is not None and annot.type[0] not in _MOVABLE:
            raise BadRequestError("This kind of annotation cannot be moved.")
        name = changes[0] if len(changes) == 1 else "Edit Annotation"
        with session.edit(name) as step:
            if contents is not None:
                mupdf.pdf_set_annot_contents(annot.this, contents)
            if rgb is not None:
                annot.set_colors(stroke=rgb)
            if opacity is not None:
                annot.set_opacity(opacity)
            _stamp(annot, None, created=False)
            annot.update()
            if rect is not None:
                x, y = _clamp_point(page, rect[0], rect[1], _bounds(annot))
                _move_to(annot, x, y)
            step.pages.add(index)
        response = session.mutated(step.pages)
        response["annotation"] = describe(page.load_annot(annot_id), page, index)
        return response


def delete_annotation(session: Session, annot_id: int, page_hint: int | None) -> dict[str, Any]:
    with session.lock:
        index, page, annot = _find(session, annot_id, page_hint)
        with session.edit("Delete") as step:
            page.delete_annot(annot)
            step.pages.add(index)
        return session.mutated(step.pages)
