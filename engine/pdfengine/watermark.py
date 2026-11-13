"""Watermarks, headers, footers and page numbers.

**Watermarks** are drawn once into a one-page source PDF (text through
``insert_htmlbox``, which has fallback fonts for any script, or an image), with
the opacity applied by wrapping the source page's content in an ExtGState. The
source is then placed on every page with ``show_pdf_page``, which shares one
form XObject between all pages, takes any rotation angle, and journals (with
``compat.py``). Rotation is counter-clockwise as displayed: on a page stored
with ``/Rotate R`` the source is turned by ``rotation + R`` in the unrotated
space (checked at 0/90/180/270).

**Headers and footers** are set with ``insert_text`` in the base-14 fonts,
measured with ``get_text_length`` for alignment: ``insert_htmlbox`` per text
would take seconds on long documents. Text the base-14 fonts cannot show (not
Latin-1) falls back to ``insert_htmlbox``.

PyMuPDF caches a graft map per source document; after an undo it would point
at objects that no longer exist, so every call uses a fresh source and drops
its graft map afterwards.
"""

import datetime
import html
import math
import os
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any, Literal

import pymupdf
from pymupdf import mupdf

from .annotations import rgb_color
from .edit import _image_kind
from .errors import BadRequestError, FileNotFound, FileUnreadableError
from .sessions import Session

Position = Literal[
    "center",
    "top-left",
    "top",
    "top-right",
    "left",
    "right",
    "bottom-left",
    "bottom",
    "bottom-right",
]
Layer = Literal["over", "under"]
FontFamily = Literal["sans", "serif", "mono"]

#: Distance of a watermark from the page edge when it is not centred.
EDGE_MARGIN = 36.0
_GS_NAME = "PDFnixWM"
_CSS_FAMILY = {"sans": "Helvetica", "serif": "Times", "mono": "Courier"}
_BASE14 = {
    ("sans", False): "helv",
    ("sans", True): "hebo",
    ("serif", False): "tiro",
    ("serif", True): "tibo",
    ("mono", False): "cour",
    ("mono", True): "cobo",
}


# --- Watermark ---------------------------------------------------------------------


@dataclass
class WatermarkSpec:
    kind: Literal["text", "image"]
    text: str = ""
    image: bytes = b""
    font_family: FontFamily = "sans"
    bold: bool = True
    font_size: float = 72
    color: str = "#ff0000"
    opacity: float = 0.3
    #: Degrees counter-clockwise, as displayed.
    rotation: float = 45
    position: Position = "center"
    #: Image watermarks: width as a fraction of the page width.
    scale: float = 0.5
    layer: Layer = "over"


def read_image(path: str) -> bytes:
    try:
        with open(path, "rb") as handle:
            data = handle.read()
    except FileNotFoundError:
        raise FileNotFound(path) from None
    except OSError as exc:
        raise FileUnreadableError(path, exc.strerror or type(exc).__name__) from None
    if _image_kind(data) not in ("png", "jpeg"):
        raise BadRequestError("A watermark picture must be a PNG or JPEG file.")
    return data


def _check(spec: WatermarkSpec) -> None:
    if spec.kind == "text" and not spec.text.strip():
        raise BadRequestError("Enter the watermark text.")
    if spec.kind == "image" and not spec.image:
        raise BadRequestError("Choose a picture for the watermark.")
    if not 0 < spec.opacity <= 1:
        raise BadRequestError("Opacity is between 0 and 1.")
    if not 1 <= spec.font_size <= 500:
        raise BadRequestError("The font size is between 1 and 500 points.")
    if not 0.01 <= spec.scale <= 5:
        raise BadRequestError("The scale is between 0.01 and 5.")


def _set_opacity(source: pymupdf.Document, opacity: float) -> None:
    """Wraps the source page's content in an ExtGState with ``opacity``."""
    page = source[0]
    if opacity >= 1:
        return
    pdf = pymupdf._as_pdf_document(source)
    page_obj = mupdf.pdf_load_object(pdf, page.xref)
    resources = mupdf.pdf_dict_get_inheritable(page_obj, mupdf.PDF_ENUM_NAME_Resources)
    if not resources.m_internal:
        resources = mupdf.pdf_dict_put_dict(page_obj, mupdf.PDF_ENUM_NAME_Resources, 1)
    states = mupdf.pdf_dict_get(resources, mupdf.PDF_ENUM_NAME_ExtGState)
    if not states.m_internal:
        states = mupdf.pdf_dict_put_dict(resources, mupdf.PDF_ENUM_NAME_ExtGState, 1)
    state = mupdf.pdf_dict_puts_dict(states, _GS_NAME, 3)
    mupdf.pdf_dict_put(state, mupdf.PDF_ENUM_NAME_Type, mupdf.PDF_ENUM_NAME_ExtGState)
    mupdf.pdf_dict_put_real(state, mupdf.PDF_ENUM_NAME_ca, opacity)
    mupdf.pdf_dict_put_real(state, mupdf.PDF_ENUM_NAME_CA, opacity)
    xrefs = page.get_contents()
    content = b"\n".join(source.xref_stream(xref) or b"" for xref in xrefs)
    source.update_stream(xrefs[0], b"q /" + _GS_NAME.encode() + b" gs\n" + content + b"\nQ")
    if len(xrefs) > 1:
        source.xref_set_key(page.xref, "Contents", f"{xrefs[0]} 0 R")


def _build_source(spec: WatermarkSpec) -> tuple[pymupdf.Document, pymupdf.Rect]:
    """The watermark as a one-page PDF and the part of it to show."""
    source = pymupdf.open()
    if spec.kind == "image":
        pixmap = pymupdf.Pixmap(spec.image)
        width, height = float(pixmap.width), float(pixmap.height)
        page = source.new_page(width=width, height=height)
        page.insert_image(page.rect, stream=spec.image)
        clip = page.rect
    else:
        size = spec.font_size
        width = max(100.0, len(spec.text) * size * 1.2 + 20)
        page = source.new_page(width=width, height=size * 3)
        css = (
            f"* {{ margin: 0; padding: 0; }} p {{ white-space: nowrap; "
            f"font-family: {_CSS_FAMILY[spec.font_family]}; font-size: {size:g}pt; "
            f"font-weight: {'bold' if spec.bold else 'normal'}; color: {spec.color}; }}"
        )
        page.insert_htmlbox(page.rect, f"<p>{html.escape(spec.text)}</p>", css=css)
        clip = pymupdf.Rect()
        for block in page.get_text("dict")["blocks"]:
            clip |= pymupdf.Rect(block["bbox"])
        if clip.is_empty:
            raise BadRequestError("The watermark text cannot be drawn.")
    _set_opacity(source, spec.opacity)
    return source, clip


def _target(
    page_rect: pymupdf.Rect, width: float, height: float, spec: WatermarkSpec
) -> pymupdf.Rect:
    """Where the turned watermark goes on the displayed page."""
    angle = math.radians(spec.rotation)
    cos, sin = abs(math.cos(angle)), abs(math.sin(angle))
    box_w, box_h = width * cos + height * sin, width * sin + height * cos
    room_w = page_rect.width - (0 if spec.position == "center" else 2 * EDGE_MARGIN)
    room_h = page_rect.height - (0 if spec.position == "center" else 2 * EDGE_MARGIN)
    shrink = min(1.0, room_w / box_w, room_h / box_h) if box_w and box_h else 1.0
    box_w, box_h = box_w * shrink, box_h * shrink
    vertical, _, horizontal = spec.position.partition("-")
    if spec.position in ("left", "right"):
        vertical, horizontal = "", spec.position
    elif spec.position in ("top", "bottom"):
        vertical, horizontal = spec.position, ""
    elif spec.position == "center":
        vertical = horizontal = ""
    if horizontal == "left":
        x0 = EDGE_MARGIN
    elif horizontal == "right":
        x0 = page_rect.width - EDGE_MARGIN - box_w
    else:
        x0 = (page_rect.width - box_w) / 2
    if vertical == "top":
        y0 = EDGE_MARGIN
    elif vertical == "bottom":
        y0 = page_rect.height - EDGE_MARGIN - box_h
    else:
        y0 = (page_rect.height - box_h) / 2
    return pymupdf.Rect(x0, y0, x0 + box_w, y0 + box_h)


def _draw_watermark(
    page: pymupdf.Page, source: pymupdf.Document, clip: pymupdf.Rect, spec: WatermarkSpec
) -> None:
    rect = page.rect
    if spec.kind == "image":
        width = rect.width * spec.scale
        height = width * clip.height / clip.width
    else:
        width, height = clip.width, clip.height
    target = _target(rect, width, height, spec) * page.derotation_matrix
    page.show_pdf_page(
        target,
        source,
        0,
        clip=clip,
        rotate=(spec.rotation + page.rotation) % 360,
        overlay=spec.layer == "over",
    )


# --- Header and footer --------------------------------------------------------------------


@dataclass
class HeaderFooterSpec:
    #: Six texts: header/footer x left/center/right. Empty ones are skipped.
    header: dict[str, str] = field(default_factory=dict)
    footer: dict[str, str] = field(default_factory=dict)
    font_family: FontFamily = "sans"
    bold: bool = False
    font_size: float = 10
    color: str = "#000000"
    #: Distance of the text from the page edges: top, bottom, left, right.
    margins: dict[str, float] = field(default_factory=dict)
    #: Number of the first page in the range.
    start_number: int = 1
    #: What ``{date}`` becomes; default today's date as YYYY-MM-DD.
    date: str | None = None


def substitute(text: str, number: int, total: int, date: str, file_name: str) -> str:
    """Replaces the tokens ``{page}``, ``{pages}``, ``{date}`` and
    ``{filename}``; anything else in braces is left as it is."""
    values = {"page": str(number), "pages": str(total), "date": date, "filename": file_name}
    out = []
    index = 0
    while index < len(text):
        if text[index] == "{":
            end = text.find("}", index)
            if end != -1 and text[index + 1 : end] in values:
                out.append(values[text[index + 1 : end]])
                index = end + 1
                continue
        out.append(text[index])
        index += 1
    return "".join(out)


def _latin1(text: str) -> bool:
    try:
        text.encode("latin-1")
    except UnicodeEncodeError:
        return False
    return True


def _draw_text(
    page: pymupdf.Page,
    text: str,
    align: str,
    baseline: float,
    spec: HeaderFooterSpec,
    margins: dict[str, float],
) -> None:
    """One header or footer text, ``baseline`` (displayed y), upright."""
    rect = page.rect
    size = spec.font_size
    color = rgb_color(spec.color)
    left, right = margins["left"], rect.width - margins["right"]
    if _latin1(text):
        font = _BASE14[(spec.font_family, spec.bold)]
        width = pymupdf.get_text_length(text, fontname=font, fontsize=size)
        if align == "left":
            x = left
        elif align == "right":
            x = right - width
        else:
            x = (rect.width - width) / 2
        point = pymupdf.Point(x, baseline) * page.derotation_matrix
        page.insert_text(
            point, text, fontname=font, fontsize=size, color=color, rotate=page.rotation
        )
        return
    box = pymupdf.Rect(left, baseline - size * 1.2, right, baseline + size * 0.4)
    css = (
        f"* {{ margin: 0; padding: 0; }} p {{ white-space: nowrap; text-align: {align}; "
        f"font-family: {_CSS_FAMILY[spec.font_family]}; font-size: {size:g}pt; "
        f"font-weight: {'bold' if spec.bold else 'normal'}; color: {spec.color}; }}"
    )
    page.insert_htmlbox(
        box * page.derotation_matrix,
        f"<p>{html.escape(text)}</p>",
        css=css,
        rotate=page.rotation,
        scale_low=0,
    )


def _draw_header_footer(
    page: pymupdf.Page, number: int, total: int, file_name: str, spec: HeaderFooterSpec
) -> None:
    margins = {"top": 36.0, "bottom": 36.0, "left": 54.0, "right": 54.0, **spec.margins}
    date = spec.date or datetime.date.today().isoformat()
    ascent = spec.font_size * 0.8
    for texts, baseline in (
        (spec.header, margins["top"] + ascent),
        (spec.footer, page.rect.height - margins["bottom"]),
    ):
        for align in ("left", "center", "right"):
            text = texts.get(align) or ""
            if text.strip():
                _draw_text(
                    page,
                    substitute(text, number, total, date, file_name),
                    align,
                    baseline,
                    spec,
                    margins,
                )


def _check_header_footer(spec: HeaderFooterSpec) -> None:
    texts = [*spec.header.values(), *spec.footer.values()]
    if not any(text.strip() for text in texts):
        raise BadRequestError("Enter at least one header or footer text.")
    if not 1 <= spec.font_size <= 200:
        raise BadRequestError("The font size is between 1 and 200 points.")
    if any(not 0 <= value <= 1000 for value in spec.margins.values()):
        raise BadRequestError("Margins are between 0 and 1000 points.")


# --- Applying and previewing -----------------------------------------------------------------


def _targets(session: Session, pages: list[int] | None) -> list[int]:
    count = session.page_count
    if pages is None:
        return list(range(count))
    if not pages:
        raise BadRequestError("No pages were chosen.")
    for index in pages:
        if not 0 <= index < count:
            raise BadRequestError(f"Page index {index} is out of range (0 to {count - 1}).")
    return sorted(set(pages))


def add_watermark(session: Session, spec: WatermarkSpec, pages: list[int] | None) -> dict[str, Any]:
    _check(spec)
    with session.lock:
        targets = _targets(session, pages)
        source, clip = _build_source(spec)
        doc = session.doc
        try:
            with session.edit("Watermark") as step:
                for index in targets:
                    _draw_watermark(doc[index], source, clip, spec)
                    step.pages.add(index)
        finally:
            doc.Graftmaps.pop(source._graft_id, None)
            source.close()
        return session.mutated(step.pages)


def add_header_footer(
    session: Session, spec: HeaderFooterSpec, pages: list[int] | None
) -> dict[str, Any]:
    _check_header_footer(spec)
    with session.lock:
        targets = _targets(session, pages)
        total = spec.start_number + len(targets) - 1
        file_name = os.path.basename(session.path)
        doc = session.doc
        with session.edit("Header & Footer") as step:
            for position, index in enumerate(targets):
                _draw_header_footer(
                    doc[index], spec.start_number + position, total, file_name, spec
                )
                step.pages.add(index)
        return session.mutated(step.pages)


def preview(
    session: Session,
    index: int,
    scale: float,
    draw: Callable[[pymupdf.Page], None],
) -> bytes:
    """PNG of page ``index`` with ``draw`` applied to a throwaway copy of it."""
    with session.lock:
        session.page(index)
        copy = pymupdf.open()
        try:
            copy.insert_pdf(session.doc, from_page=index, to_page=index, annots=True, links=False)
            page = copy[0]
            draw(page)
            return page.get_pixmap(matrix=pymupdf.Matrix(scale, scale), annots=True).tobytes("png")
        finally:
            copy.close()


def preview_watermark(session: Session, spec: WatermarkSpec, index: int, scale: float) -> bytes:
    _check(spec)
    source, clip = _build_source(spec)
    try:
        return preview(
            session, index, scale, lambda page: _draw_watermark(page, source, clip, spec)
        )
    finally:
        source.close()


def preview_header_footer(
    session: Session, spec: HeaderFooterSpec, index: int, scale: float, number: int, total: int
) -> bytes:
    _check_header_footer(spec)
    file_name = os.path.basename(session.path)
    return preview(
        session,
        index,
        scale,
        lambda page: _draw_header_footer(page, number, total, file_name, spec),
    )
