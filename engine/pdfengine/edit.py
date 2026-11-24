"""Editing page content: the text and images a page draws itself (as opposed
to annotations, which sit on top of it).

Coordinates in and out are PDF points in the page's displayed space. Reads go
through ``textpages.content_text_page`` (page content only, never
annotations, safe under the journal); every change goes through
``Session.edit``. Rules from the pinned PyMuPDF (STATUS.md, Verified facts):

- redaction rects are in the unrotated space, and MuPDF removes every glyph
  whose box touches one, so text is removed with a thin band through the
  middle of each line rather than the line's box (line boxes overlap their
  neighbours);
- ``insert_htmlbox`` and ``insert_image`` take derotated rects and
  ``rotate=page.rotation`` to come out upright; ``insert_htmlbox`` returns
  without touching the page when the text does not fit at ``scale_low``;
- one image is removed by filtering the page content, because redaction would
  also remove any other image under it (a page background, say).
"""

import base64
import binascii
import difflib
import html
import re
import statistics
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any, Literal

import pymupdf
from pymupdf import mupdf

from .annotations import check_rect, rgb_color
from .errors import BadRequestError, EngineError, NotFoundError
from .fonts import (
    RunFont,
    builtin_choice,
    choose_for_replacement,
    family_for,
    font_for_run,
    style_for,
)
from .sessions import Session
from .textpages import content_image_rects, content_text_page

ObjectKind = Literal["text", "image"]
Align = Literal["left", "center", "right", "justify"]
ImageLabel = Literal["Image", "Signature", "Initials"]

#: Half the height of the band that removes a line of text.
BAND = 1.0
#: How close two rects must be to count as the same image.
IMAGE_TOLERANCE = 1.0
#: Largest image accepted, in bytes.
MAX_IMAGE_BYTES = 50 * 1024 * 1024
#: Kept free at the bottom of the page when a replaced paragraph grows.
BOTTOM_MARGIN = 18.0
#: How far one edited line may shrink to fit before the whole paragraph is
#: set again instead (a smaller line among the others would show).
MIN_LINE_SCALE = 0.97


class UnsupportedImageError(EngineError):
    def __init__(self) -> None:
        super().__init__("unsupported_image", "Only PNG, JPEG and SVG images can be inserted.", 415)


def _r(value: float) -> float:
    return round(value, 2)


def _rect_out(rect: pymupdf.Rect) -> list[float]:
    return [_r(rect.x0), _r(rect.y0), _r(rect.x1), _r(rect.y1)]


def _hex(color: int) -> str:
    return f"#{color & 0xFFFFFF:06x}"


def _angle(page: pymupdf.Page, direction: Sequence[float]) -> int:
    """Clockwise angle (0/90/180/270) of a text line as displayed, from its
    unrotated direction vector."""
    vector = pymupdf.Point(direction) * pymupdf.Matrix(page.rotation)
    if abs(vector.x) >= abs(vector.y):
        return 0 if vector.x >= 0 else 180
    return 90 if vector.y > 0 else 270


@dataclass
class _Line:
    """A text line: unrotated box (for redaction), displayed box, direction."""

    raw: pymupdf.Rect
    box: pymupdf.Rect
    direction: tuple[float, float]
    angle: int
    spans: list[dict[str, Any]]
    block: int

    @property
    def text(self) -> str:
        return "".join(span["text"] for span in self.spans)


def _lines(page: pymupdf.Page) -> list[_Line]:
    data = content_text_page(page, 0).extractDICT()
    matrix = page.rotation_matrix
    result = []
    for block_index, block in enumerate(data["blocks"]):
        if block.get("type", 0) != 0:
            continue
        for line in block["lines"]:
            spans = [span for span in line["spans"] if span["text"]]
            if not "".join(span["text"] for span in spans).strip():
                continue
            raw = pymupdf.Rect(line["bbox"])
            direction = tuple(line["dir"])
            result.append(
                _Line(raw, raw * matrix, direction, _angle(page, direction), spans, block_index)
            )
    return _join_paragraphs(result)


def _line_size(line: _Line) -> float:
    return max((span["size"] for span in line.spans), default=0.0)


def _join_paragraphs(lines: list[_Line]) -> list[_Line]:
    """Joins MuPDF blocks that are one paragraph: upright text in the same
    column, the same size, each block's first line one line pitch below the
    other's last. MuPDF splits a paragraph whose lines are not together in
    the content stream, as after an edit re-sets one of its lines. Lines come
    back grouped by block, each block's lines top to bottom."""
    groups: dict[int, list[_Line]] = {}
    for line in lines:
        groups.setdefault(line.block, []).append(line)
    paragraphs: list[list[_Line]] = []
    upright = sorted(
        (group for group in groups.values() if all(line.angle == 0 for line in group)),
        key=lambda group: min(line.box.y0 for line in group),
    )
    for group in upright:
        group.sort(key=lambda line: (line.box.y0, line.box.x0))
        target = next((paragraph for paragraph in paragraphs if _continues(paragraph, group)), None)
        if target is None:
            paragraphs.append(group)
        else:
            target.extend(group)
            target.sort(key=lambda line: (line.box.y0, line.box.x0))
    paragraphs.extend(
        group for group in groups.values() if not all(line.angle == 0 for line in group)
    )
    result = []
    for number, paragraph in enumerate(paragraphs):
        for line in paragraph:
            line.block = number
            result.append(line)
    return result


def _continues(paragraph: Sequence[_Line], group: Sequence[_Line]) -> bool:
    """True if ``group`` carries on ``paragraph`` directly below it."""
    last, first = paragraph[-1], group[0]
    size = _line_size(last)
    if size <= 0 or abs(_line_size(first) - size) > size * 0.1:
        return False
    left = max(min(line.box.x0 for line in paragraph), min(line.box.x0 for line in group))
    right = min(max(line.box.x1 for line in paragraph), max(line.box.x1 for line in group))
    narrower = min(
        max(line.box.x1 for line in paragraph) - min(line.box.x0 for line in paragraph),
        max(line.box.x1 for line in group) - min(line.box.x0 for line in group),
    )
    if right - left < narrower * 0.5:
        return False
    step = first.box.y0 - last.box.y0
    pitches = [b.box.y0 - a.box.y0 for a, b in zip(paragraph, paragraph[1:], strict=False)]
    pitches += [b.box.y0 - a.box.y0 for a, b in zip(group, group[1:], strict=False)]
    pitches = [pitch for pitch in pitches if pitch > 0.5]
    if pitches:
        pitch = statistics.median(pitches)
        return pitch * 0.8 <= step <= pitch * 1.2
    # Two single lines: a normal line pitch for their size.
    return size * 0.9 <= step <= size * 1.6


def _lines_in(page: pymupdf.Page, bbox: pymupdf.Rect) -> list[_Line]:
    """Lines whose centre lies in ``bbox`` (displayed space)."""
    area = pymupdf.Rect(bbox.x0 - 1, bbox.y0 - 1, bbox.x1 + 1, bbox.y1 + 1)
    return [
        line
        for line in _lines(page)
        if area.contains(
            pymupdf.Point((line.box.x0 + line.box.x1) / 2, (line.box.y0 + line.box.y1) / 2)
        )
    ]


# --- Reading -----------------------------------------------------------------


def page_blocks(session: Session, index: int) -> dict[str, Any]:
    """The editable text blocks and images of a page's content."""
    with session.lock:
        page = session.page(index)
        lines = _lines(page)
        blocks: dict[int, list[_Line]] = {}
        for line in lines:
            blocks.setdefault(line.block, []).append(line)
        result_blocks = []
        for number, (_, members) in enumerate(sorted(blocks.items())):
            box = pymupdf.Rect(members[0].box)
            for line in members[1:]:
                box |= line.box
            result_blocks.append(
                {
                    "blockId": str(number),
                    "bbox": _rect_out(box),
                    "angle": members[0].angle,
                    "text": "\n".join(line.text for line in members),
                    "lines": [
                        {
                            "bbox": _rect_out(line.box),
                            "spans": [
                                {
                                    "text": span["text"],
                                    "font": span["font"],
                                    "size": _r(span["size"]),
                                    "color": _hex(span["color"]),
                                    "flags": span["flags"],
                                }
                                for span in line.spans
                            ],
                        }
                        for line in members
                    ],
                }
            )
        images = [
            {"imageId": str(number), "bbox": _rect_out(rect)}
            for number, rect in enumerate(content_image_rects(page))
            if rect.width > 0 and rect.height > 0
        ]
        return {"blocks": result_blocks, "images": images}


# --- Removing ----------------------------------------------------------------


def _remove_lines(page: pymupdf.Page, lines: Sequence[_Line]) -> None:
    """Removes the text of ``lines``, keeping images and vector graphics.
    Call inside an edit."""
    for line in lines:
        raw = line.raw
        dx, dy = line.direction
        if abs(dx) >= abs(dy):
            middle = (raw.y0 + raw.y1) / 2
            band = pymupdf.Rect(raw.x0, middle - BAND, raw.x1, middle + BAND)
        else:
            middle = (raw.x0 + raw.x1) / 2
            band = pymupdf.Rect(middle - BAND, raw.y0, middle + BAND, raw.y1)
        page.add_redact_annot(band, fill=False)
    page.apply_redactions(
        images=pymupdf.PDF_REDACT_IMAGE_NONE,
        graphics=pymupdf.PDF_REDACT_LINE_ART_NONE,
        text=pymupdf.PDF_REDACT_TEXT_REMOVE,
    )


def _remove_image(page: pymupdf.Page, target: pymupdf.Rect) -> int:
    """Drops the images the page content draws at ``target`` (displayed
    space); returns how many. Other images, even overlapping ones, stay.
    Call inside an edit."""
    pdf_page = page._pdf_page()
    pdf = pdf_page.doc()
    transform = mupdf.FzMatrix()
    mupdf.pdf_page_transform(pdf_page, mupdf.FzRect(), transform)
    removed = 0

    class Options(mupdf.PdfSanitizeFilterOptions2):
        def __init__(self) -> None:
            super().__init__()
            self.use_virtual_image_filter()

        def image_filter(self, _ctx, ctm, _name, image, _scissor):  # type: ignore[no-untyped-def]
            nonlocal removed
            unit = mupdf.fz_transform_rect(mupdf.FzRect(0, 0, 1, 1), mupdf.FzMatrix(ctm))
            box = pymupdf.Rect(mupdf.fz_transform_rect(unit, transform))
            if all(abs(a - b) <= IMAGE_TOLERANCE for a, b in zip(box, target, strict=True)):
                removed += 1
                return None
            return image

    options = Options()
    filter_options = pymupdf._make_PdfFilterOptions(
        recurse=1, instance_forms=1, ascii=0, no_update=0, sanitize=1, sopts=options
    )
    mupdf.pdf_filter_page_contents(pdf, pdf_page, filter_options)
    return removed


def delete_object(
    session: Session, index: int, bbox: Sequence[float], kind: ObjectKind
) -> dict[str, Any]:
    """Removes the text lines centred in ``bbox``, or the image drawn at it."""
    area = check_rect(bbox, "bbox")
    with session.lock:
        page = session.page(index)
        if kind == "text":
            lines = _lines_in(page, area)
            if not lines:
                raise NotFoundError("There is no text there.")
            with session.edit("Delete Text") as step:
                _remove_lines(page, lines)
                step.pages.add(index)
        else:
            if not any(
                all(abs(a - b) <= IMAGE_TOLERANCE for a, b in zip(rect, area, strict=True))
                for rect in content_image_rects(page)
            ):
                raise NotFoundError("There is no image there.")
            with session.edit("Delete Image") as step:
                if not _remove_image(page, area):
                    # Drawn somewhere the filter does not reach (e.g. a
                    # shading or a nested form it cannot instance).
                    raise BadRequestError("This image cannot be removed.")
                step.pages.add(index)
        return session.mutated(step.pages)


# --- Replacing text ----------------------------------------------------------


def _dominant_span(lines: Sequence[_Line]) -> dict[str, Any]:
    weights: dict[tuple[str, float, int, int], int] = {}
    first: dict[tuple[str, float, int, int], dict[str, Any]] = {}
    for line in lines:
        for span in line.spans:
            key = (span["font"], round(span["size"], 1), span["color"], span["flags"])
            weights[key] = weights.get(key, 0) + len(span["text"].strip())
            first.setdefault(key, span)
    return first[max(weights, key=lambda key: weights[key])]


def _alignment(lines: Sequence[_Line], size: float) -> Align:
    # Edges along x only mean something for text that reads left to right;
    # turned text is set from its start.
    if len(lines) < 2 or lines[0].angle != 0:
        return "left"
    tolerance = max(1.5, size * 0.15)
    # The last line of a justified or left paragraph is shorter: leave it out
    # when comparing right edges and centres.
    body = lines[:-1] if len(lines) > 2 else lines

    def spread(values: list[float]) -> float:
        return max(values) - min(values)

    if spread([line.box.x0 for line in lines]) <= tolerance:
        return "left"
    if spread([line.box.x1 for line in body]) <= tolerance:
        return "right"
    if spread([(line.box.x0 + line.box.x1) / 2 for line in lines]) <= tolerance:
        return "center"
    return "left"


def _line_height(lines: Sequence[_Line], size: float) -> float:
    if len(lines) < 2 or size <= 0:
        return 1.2
    tops = sorted(line.box.y0 for line in lines)
    pitches = [b - a for a, b in zip(tops, tops[1:], strict=False) if b - a > 0.5]
    if not pitches:
        return 1.2
    return max(1.0, min(3.0, statistics.median(pitches) / size))


def _free_bottom(page: pymupdf.Page, box: pymupdf.Rect) -> float:
    """How far down a box may grow before it reaches other content."""
    limit = page.rect.y1 - BOTTOM_MARGIN
    obstacles = [line.box for line in _lines(page)] + content_image_rects(page)
    for rect in obstacles:
        overlaps = rect.x0 < box.x1 and rect.x1 > box.x0
        if overlaps and rect.y0 >= box.y1 - 0.5:
            limit = min(limit, rect.y0 - 1)
    return max(limit, box.y1)


@dataclass
class _Run:
    """Part of the new text and the original span whose style it takes."""

    text: str
    span: dict[str, Any]


def styled_runs(spans: Sequence[dict[str, Any]], new_text: str) -> list[_Run]:
    """Splits ``new_text`` into runs that each take the style of an original
    span. Text kept from the original keeps its span's style; typed text takes
    the style of the text it replaces, or of the character before it (as a
    word processor does), or of the first one at the very start."""
    if not spans:
        return []
    owner = [index for index, span in enumerate(spans) for _ in span["text"]]
    old_text = "".join(span["text"] for span in spans)
    owners: list[int] = []
    matcher = difflib.SequenceMatcher(None, old_text, new_text, autojunk=False)
    for tag, i1, i2, j1, j2 in matcher.get_opcodes():
        if tag == "equal":
            owners.extend(owner[i1:i2])
        elif tag in ("replace", "insert"):
            if tag == "replace":
                source = owner[i1]
            elif i1 > 0:
                source = owner[i1 - 1]
            else:
                source = owner[0] if owner else 0
            owners.extend([source] * (j2 - j1))
    runs: list[_Run] = []
    for char, index in zip(new_text, owners, strict=True):
        if runs and runs[-1].span is spans[index]:
            runs[-1].text += char
        else:
            runs.append(_Run(char, spans[index]))
    return runs


@dataclass
class _Piece:
    """A word to write, where to write it."""

    text: str
    font: pymupdf.Font
    size: float
    color: int
    origin: pymupdf.Point


@dataclass
class _LinePlan:
    line: _Line
    pieces: list[_Piece]
    scale: float
    labels: list[tuple[str, int]]
    substituted: bool


def _space_width(font: pymupdf.Font, size: float) -> float:
    # A subset font may lack the space glyph (its width then comes out as 0).
    width = font.text_length(" ", fontsize=size) if font.has_glyph(32) else 0.0
    return width if width > 0 else size * 0.25


def _natural_width(
    words: Sequence[tuple[str, RunFont, float]],
) -> tuple[float, int]:
    """Width of ``(text, font, size)`` runs set without stretching, and how
    many spaces they hold."""
    width = 0.0
    spaces = 0
    for text, run_font, size in words:
        for part in re.split(r"( +)", text):
            if not part:
                continue
            if part.startswith(" "):
                width += _space_width(run_font.font, size) * len(part)
                spaces += len(part)
            else:
                width += run_font.font.text_length(part, fontsize=size)
    return width, spaces


def _plan_line(
    doc: pymupdf.Document,
    page: pymupdf.Page,
    line: _Line,
    new_text: str,
    *,
    last: bool,
    right_edge: float,
    align: Align,
) -> _LinePlan | None:
    """How to write ``new_text`` in place of ``line``, keeping each part's
    original font, size, colour and baseline. None if it cannot be done
    faithfully (a missing glyph, or far too long for the line)."""
    runs = styled_runs(line.spans, new_text)
    fonts: list[tuple[_Run, RunFont]] = []
    for run in runs:
        run_font = font_for_run(doc, page, run.span["font"], run.span["flags"], run.text)
        if run_font is None:
            return None
        fonts.append((run, run_font))
    start_x = line.spans[0]["origin"][0]
    new_width, new_spaces = _natural_width(
        [(run.text, run_font, run.span["size"]) for run, run_font in fonts]
    )

    # Was the line stretched to the paragraph's edge (justified)?
    old_fonts = [
        (span["text"], font_for_run(doc, page, span["font"], span["flags"], span["text"]))
        for span in line.spans
    ]
    justified_width = None
    if not last and all(font is not None for _, font in old_fonts):
        old_natural, old_spaces = _natural_width(
            [
                (text, font, span["size"])
                for (text, font), span in zip(old_fonts, line.spans, strict=True)
                if font is not None
            ]
        )
        actual = line.raw.x1 - start_x
        if old_spaces and actual - old_natural > 1.0 and abs(line.raw.x1 - right_edge) <= 2.0:
            justified_width = actual

    slack = max(1.0, (right_edge - start_x) * 0.02)
    available = justified_width + 1.0 if justified_width else right_edge + slack - start_x
    scale = 1.0
    if new_width > available:
        scale = available / new_width
        if scale < MIN_LINE_SCALE:
            return None
    extra = 0.0
    if justified_width and new_spaces and new_width * scale < justified_width:
        extra = (justified_width - new_width * scale) / new_spaces
        # A line with few words would gape; leave such a line unstretched.
        if extra > max(run.span["size"] for run in runs) * 1.5:
            extra = 0.0

    x = start_x
    if not justified_width and align == "right":
        x = line.raw.x1 - new_width * scale
    elif not justified_width and align == "center":
        x = (line.raw.x0 + line.raw.x1 - new_width * scale) / 2
    pieces: list[_Piece] = []
    labels: dict[str, int] = {}
    substituted = False
    for run, run_font in fonts:
        size = run.span["size"] * scale
        baseline = run.span["origin"][1]
        substituted = substituted or run_font.substituted
        labels[run_font.label] = labels.get(run_font.label, 0) + len(run.text.strip())
        for part in re.split(r"( +)", run.text):
            if not part:
                continue
            if part.startswith(" "):
                x += (_space_width(run_font.font, size) + extra) * len(part)
                continue
            pieces.append(
                _Piece(part, run_font.font, size, run.span["color"], pymupdf.Point(x, baseline))
            )
            x += run_font.font.text_length(part, fontsize=size)
    return _LinePlan(
        line, pieces, scale, sorted(labels.items(), key=lambda kv: -kv[1]), substituted
    )


def _plan_changed_lines(
    doc: pymupdf.Document, page: pymupdf.Page, lines: Sequence[_Line], text: str, align: Align
) -> list[_LinePlan] | None:
    """Plans for the lines whose text changed, when every line keeps its
    place: same number of lines, one block, upright text on an unturned page.
    None when the edit needs the whole block set again."""
    new_lines = text.split("\n")
    if (
        page.rotation != 0
        or len(new_lines) != len(lines)
        or len({line.block for line in lines}) != 1
        or any(line.angle != 0 for line in lines)
    ):
        return None
    right_edge = max(line.raw.x1 for line in lines)
    plans = []
    for index, (line, new) in enumerate(zip(lines, new_lines, strict=True)):
        if line.text.rstrip() == new.rstrip():
            continue
        if not new.strip():
            plans.append(_LinePlan(line, [], 1.0, [], False))
            continue
        plan = _plan_line(
            doc,
            page,
            line,
            new.rstrip(),
            last=index == len(lines) - 1,
            right_edge=right_edge,
            align=align,
        )
        if plan is None:
            return None
        plans.append(plan)
    return plans


def _write_plans(page: pymupdf.Page, plans: Sequence[_LinePlan]) -> dict[str, Any]:
    """Removes the planned lines and writes their new text. Call inside an edit."""
    _remove_lines(page, [plan.line for plan in plans])
    # In reading order, a writer per stretch of one colour: text written out
    # of order would be read back as separate lines.
    writer: pymupdf.TextWriter | None = None
    color = -1
    for piece in (piece for plan in plans for piece in plan.pieces):
        if writer is None or piece.color != color:
            if writer is not None:
                writer.write_text(page, color=pymupdf.sRGB_to_pdf(color))
            writer, color = pymupdf.TextWriter(page.rect), piece.color
        writer.append(piece.origin, piece.text, font=piece.font, fontsize=piece.size)
    if writer is not None:
        writer.write_text(page, color=pymupdf.sRGB_to_pdf(color))
    labels: dict[str, int] = {}
    for plan in plans:
        for label, weight in plan.labels:
            labels[label] = labels.get(label, 0) + weight
    used = pymupdf.Rect(plans[0].line.box)
    for plan in plans[1:]:
        used |= plan.line.box
    return {
        "font": max(labels, key=lambda label: labels[label]) if labels else "",
        "substituted": any(plan.substituted for plan in plans),
        "fontScale": round(min(plan.scale for plan in plans), 3),
        "rect": _rect_out(used),
    }


@dataclass
class _Styled:
    """A paragraph as HTML with each part in its original style."""

    html: str
    font_faces: str
    files: list[tuple[bytes, str]]
    substituted: bool


def _wrapped(line: _Line, following: _Line, right_edge: float) -> bool:
    """True if ``line`` ended only because the next word did not fit (an
    upright paragraph wrapping), judged from the next line's first word."""
    if line.angle != 0 or following.angle != 0:
        return False
    first_word = following.text.strip().split(" ")[0]
    size = following.spans[0]["size"] if following.spans else 10.0
    # A rough width: half the font size per character, plus a space.
    needed = (len(first_word) + 1) * size * 0.5
    return line.box.x1 + needed > right_edge - 1.0


def _justified(lines: Sequence[_Line]) -> bool:
    """True for an upright paragraph of three or more lines whose lines,
    except the last, all reach both edges (justified text)."""
    if len(lines) < 3 or any(line.angle != 0 for line in lines):
        return False
    body = lines[:-1]
    lefts = [line.box.x0 for line in lines]
    rights = [line.box.x1 for line in body]
    return max(lefts) - min(lefts) <= 1.5 and max(rights) - min(rights) <= 1.5


def _styled_html(
    doc: pymupdf.Document, page: pymupdf.Page, lines: Sequence[_Line], text: str
) -> _Styled | None:
    """``text`` as HTML whose parts keep the font, weight, slant, size and
    colour of the original spans they come from (see ``styled_runs``).

    A line break of the original that was only the text wrapping becomes a
    space, so the paragraph can wrap anew; one that ended a line early (an
    address, a list) stays a break, as does any break the user typed."""
    spans: list[dict[str, Any]] = []
    right_edge = max(line.box.x1 for line in lines)
    for number, line in enumerate(lines):
        if number:
            # The line break takes the style of the end of the previous line.
            spans.append(
                {**spans[-1], "text": "\n", "soft": _wrapped(lines[number - 1], line, right_edge)}
            )
        spans.extend(line.spans)
    runs = styled_runs(spans, text)
    if not runs:
        return None
    parts: list[str] = []
    faces: dict[str, str] = {}
    files: dict[str, tuple[bytes, str]] = {}
    substituted = False
    for run in runs:
        span = run.span
        if span.get("soft"):
            # A wrap becomes a space at the end of the text before it, in its font.
            if parts and not parts[-1].endswith(" </span>"):
                parts[-1] = parts[-1].removesuffix("</span>") + " </span>"
            continue
        choice = choose_for_replacement(doc, page, span["font"], span["flags"], run.text)
        substituted = substituted or choice.substituted
        if choice.font_file:
            faces[choice.css_family] = choice.font_face
            files[choice.font_file[1]] = choice.font_file
        style = f"{choice.css()} font-size: {span['size']:g}pt; color: {_hex(span['color'])};"
        body = "<br/>".join(html.escape(part) for part in run.text.split("\n"))
        parts.append(f'<span style="{style}">{body}</span>')
    return _Styled("".join(parts), " ".join(faces.values()), list(files.values()), substituted)


def replace_text(
    session: Session,
    index: int,
    bbox: Sequence[float],
    text: str,
    *,
    font_family: str | None = None,
    font_size: float | None = None,
    color: str | None = None,
    align: Align | None = None,
    bold: bool | None = None,
    italic: bool | None = None,
) -> dict[str, Any]:
    """Replaces the text inside ``bbox`` with ``text`` (empty deletes it).

    The new text keeps the old font, size, colour, alignment and line spacing
    unless told otherwise. If it does not fit, the box grows downward into
    free space, then the font shrinks. The response says which font was used
    (``font``, ``substituted``) and by how much it shrank (``fontScale``).
    """
    area = check_rect(bbox, "bbox")
    if color is not None:
        rgb_color(color)
    if font_size is not None and not 1 <= font_size <= 500:
        raise BadRequestError("The font size is between 1 and 500 points.")
    if font_family is not None and font_family not in ("sans", "serif", "mono"):
        raise BadRequestError("The font family is sans, serif or mono.")
    text = text.replace("\r\n", "\n").replace("\r", "\n")

    with session.lock:
        page = session.page(index)
        lines = _lines_in(page, area)
        if not lines:
            raise NotFoundError("There is no text there.")
        # In the order the block lists them, which is the order of the
        # editor's lines.
        in_block_order = list(lines)
        lines.sort(key=lambda line: (line.box.y0, line.box.x0))
        span = _dominant_span(lines)
        size = font_size or round(span["size"], 2)
        angle = lines[0].angle
        target = pymupdf.Rect(lines[0].box)
        for line in lines[1:]:
            target |= line.box
        restyled = any(value is not None for value in (font_family, font_size, color, bold, italic))

        # Keep the formatting: unless the user restyled the block, only the
        # lines whose text changed are set again, each part in its own style.
        plans = None
        if text.strip() and not restyled:
            plans = _plan_changed_lines(
                session.doc, page, in_block_order, text, align or _alignment(lines, size)
            )
            if plans == [] and align is None:
                return {
                    **session.unchanged(),
                    "font": "",
                    "substituted": False,
                    "fontScale": 1.0,
                    "rect": _rect_out(target),
                }
        if plans:
            with session.edit("Edit Text") as step:
                result = _write_plans(page, plans)
                step.pages.add(index)
            response = session.mutated(step.pages)
            response.update(result)
            return response

        if text.strip():
            span_bold, span_italic = style_for(span["font"], span["flags"])
            wants_bold = span_bold if bold is None else bold
            wants_italic = span_italic if italic is None else italic
            if font_family is not None or (wants_bold, wants_italic) != (span_bold, span_italic):
                family = font_family or family_for(span["font"], span["flags"])
                choice = builtin_choice(family, wants_bold, wants_italic, substituted=False)
            else:
                choice = choose_for_replacement(
                    session.doc, page, span["font"], span["flags"], text
                )
            # Not restyled: each part of the paragraph keeps its own font,
            # weight, slant and colour.
            styled = None if restyled else _styled_html(session.doc, page, in_block_order, text)
        name = "Edit Text" if text.strip() else "Delete Text"

        with session.edit(name) as step:
            _remove_lines(page, lines)
            step.pages.add(index)
            result: dict[str, Any] = {}
            if text.strip():
                result = _insert_text(
                    page,
                    target,
                    angle,
                    text,
                    choice,
                    size=size,
                    color=color or _hex(span["color"]),
                    align=align
                    or ("justify" if styled and _justified(lines) else _alignment(lines, size)),
                    line_height=_line_height(lines, size),
                    first_line_height=lines[0].box.height
                    if angle in (0, 180)
                    else lines[0].box.width,
                    styled=styled,
                )
                result["font"] = choice.label
                result["substituted"] = choice.substituted or bool(styled and styled.substituted)
        response = session.mutated(step.pages)
        response.update(result)
        return response


def _insert_text(
    page: pymupdf.Page,
    target: pymupdf.Rect,
    angle: int,
    text: str,
    choice: Any,
    *,
    size: float,
    color: str,
    align: Align,
    line_height: float,
    first_line_height: float,
    styled: "_Styled | None" = None,
) -> dict[str, Any]:
    """Sets ``text`` into ``target`` (displayed space) where the old text was,
    in ``choice``, or with each part in its own style when ``styled`` is given.
    Call inside an edit."""
    body = "<br/>".join(html.escape(line) for line in text.split("\n"))
    font_faces = choice.font_face + (styled.font_faces if styled else "")
    css = (
        f"{font_faces} body, p {{ margin: 0; padding: 0; }} "
        f"body {{ {choice.css()} font-size: {size:g}pt; color: {color}; "
        f"text-align: {align}; line-height: {line_height:.3f}; }}"
    )
    content = f"<p>{styled.html if styled else body}</p>"
    archive = choice.archive
    if styled and styled.files:
        archive = pymupdf.Archive()
        for font_file in [*([choice.font_file] if choice.font_file else []), *styled.files]:
            archive.add(font_file)
    # Centre the first line box on where the old first line was drawn, and
    # leave a little room so text of the same length does not wrap.
    box = pymupdf.Rect(target)
    shift = (size * line_height - first_line_height) / 2
    slack = max(1.0, target.width * 0.02) if angle in (0, 180) else max(1.0, target.height * 0.02)
    if angle == 0:
        box.y0 -= shift
        box.x1 += slack
    elif angle == 180:
        box.y1 += shift
        box.x0 -= slack
    elif angle == 90:
        box.x1 += shift
        box.y1 += slack
    else:
        box.x0 -= shift
        box.y0 -= slack
    rotate = (page.rotation - angle) % 360
    matrix = page.derotation_matrix

    def attempt(rect: pymupdf.Rect, scale_low: float) -> tuple[float, float]:
        return page.insert_htmlbox(
            rect * matrix,
            content,
            css=css,
            archive=archive,
            rotate=rotate,
            scale_low=scale_low,
        )

    spare, scale = attempt(box, 1)
    if spare < 0 and angle == 0:
        grown = pymupdf.Rect(box.x0, box.y0, box.x1, _free_bottom(page, box))
        if grown.y1 > box.y1 + 0.5:
            box = grown
            spare, scale = attempt(box, 1)
    if spare < 0:
        spare, scale = attempt(box, 0)
    used = pymupdf.Rect(box)
    if angle == 0 and spare > 0:
        used.y1 = max(used.y0, used.y1 - spare)
    return {"fontScale": round(min(1.0, scale), 3), "rect": _rect_out(used)}


# --- Inserting images --------------------------------------------------------


def _image_kind(data: bytes) -> str:
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "png"
    if data.startswith(b"\xff\xd8"):
        return "jpeg"
    head = data[:2048].lstrip().lower()
    if (
        head.startswith((b"<?xml", b"<svg", b"<!--", b"<!doctype svg"))
        and b"<svg" in data[:4096].lower()
    ):
        return "svg"
    raise UnsupportedImageError()


def decode_image(data: str) -> bytes:
    try:
        raw = base64.b64decode(data, validate=True)
    except (binascii.Error, ValueError):
        raise BadRequestError("The image data is not valid base64.") from None
    if not raw:
        raise BadRequestError("The image is empty.")
    if len(raw) > MAX_IMAGE_BYTES:
        raise BadRequestError("The image is larger than 50 MB.")
    return raw


def _fit_on_page(page: pymupdf.Page, rect: pymupdf.Rect) -> pymupdf.Rect:
    """``rect`` moved (not resized) to lie on the page where it can."""
    area = page.rect
    dx = max(0.0, area.x0 - rect.x0) - max(0.0, rect.x1 - area.x1)
    dy = max(0.0, area.y0 - rect.y0) - max(0.0, rect.y1 - area.y1)
    if rect.width > area.width:
        dx = area.x0 - rect.x0
    if rect.height > area.height:
        dy = area.y0 - rect.y0
    return rect + (dx, dy, dx, dy)


def insert_image(
    session: Session,
    index: int,
    rect: Sequence[float],
    data: bytes,
    *,
    rotation: int = 0,
    pages: Sequence[int] = (),
    label: ImageLabel = "Image",
) -> dict[str, Any]:
    """Draws an image into the page content at ``rect`` (displayed space),
    turned ``rotation`` degrees clockwise, keeping transparency. With
    ``pages``, the same image goes at the same place on those pages too, all as
    one undoable step (initials on every page)."""
    box = check_rect(rect)
    if rotation % 90:
        raise BadRequestError("Rotation is a multiple of 90 degrees.")
    kind = _image_kind(data)
    svg_pdf: pymupdf.Document | None = None
    if kind == "svg":
        try:
            with pymupdf.open(stream=data, filetype="svg") as svg:
                svg_pdf = pymupdf.open("pdf", svg.convert_to_pdf())
        except Exception:
            raise BadRequestError("The SVG image could not be read.") from None
    else:
        try:
            pymupdf.Pixmap(data)
        except Exception:
            raise BadRequestError("The image could not be read.") from None

    with session.lock:
        targets = [index, *[page for page in pages if page != index]]
        for page_index in targets:
            session.page(page_index)
        try:
            with session.edit(label) as step:
                xref = 0
                for page_index in targets:
                    page = session.page(page_index)
                    placed = _fit_on_page(page, box)
                    turn = (page.rotation - rotation) % 360
                    where = placed * page.derotation_matrix
                    if svg_pdf is not None:
                        page.show_pdf_page(where, svg_pdf, 0, keep_proportion=False, rotate=turn)
                    else:
                        xref = page.insert_image(
                            where,
                            stream=data if not xref else None,
                            xref=xref,
                            keep_proportion=False,
                            rotate=turn,
                        )
                    step.pages.add(page_index)
        finally:
            if svg_pdf is not None:
                svg_pdf.close()
        return session.mutated(step.pages)
