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
import html
import statistics
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any, Literal

import pymupdf
from pymupdf import mupdf

from .annotations import check_rect, rgb_color
from .errors import BadRequestError, EngineError, NotFoundError
from .fonts import builtin_choice, choose_for_replacement, family_for, style_for
from .sessions import Session
from .textpages import content_image_rects, content_text_page

ObjectKind = Literal["text", "image"]
Align = Literal["left", "center", "right"]
ImageLabel = Literal["Image", "Signature", "Initials"]

#: Half the height of the band that removes a line of text.
BAND = 1.0
#: How close two rects must be to count as the same image.
IMAGE_TOLERANCE = 1.0
#: Largest image accepted, in bytes.
MAX_IMAGE_BYTES = 50 * 1024 * 1024
#: Kept free at the bottom of the page when a replaced paragraph grows.
BOTTOM_MARGIN = 18.0


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
    return result


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
        lines.sort(key=lambda line: (line.box.y0, line.box.x0))
        span = _dominant_span(lines)
        size = font_size or round(span["size"], 2)
        angle = lines[0].angle
        target = pymupdf.Rect(lines[0].box)
        for line in lines[1:]:
            target |= line.box

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
                    align=align or _alignment(lines, size),
                    line_height=_line_height(lines, size),
                    first_line_height=lines[0].box.height
                    if angle in (0, 180)
                    else lines[0].box.width,
                )
                result["font"] = choice.label
                result["substituted"] = choice.substituted
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
) -> dict[str, Any]:
    """Sets ``text`` into ``target`` (displayed space) where the old text was.
    Call inside an edit."""
    body = "<br/>".join(html.escape(line) for line in text.split("\n"))
    css = (
        f"{choice.font_face} body, p {{ margin: 0; padding: 0; }} "
        f"body {{ {choice.css()} font-size: {size:g}pt; color: {color}; "
        f"text-align: {align}; line-height: {line_height:.3f}; }}"
    )
    content = f"<p>{body}</p>"
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
            archive=choice.archive,
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
