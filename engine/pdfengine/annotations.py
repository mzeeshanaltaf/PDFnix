"""Annotations: text markup (highlight, underline, strikeout), notes, free
text, shapes (square, circle, line with optional arrow heads) and ink.

Coordinates in and out are PDF points in the page's displayed (rotated) space.
PyMuPDF's own annotation geometry is inconsistent on rotated pages
(``Annot.rect``, ``Annot.vertices`` and the ``add_*_annot`` calls mostly use
the unrotated space, ``add_text_annot`` the displayed one, and notes, which do
not rotate with the page, are anchored at a corner that depends on the
rotation). MuPDF's own calls are consistent: ``pdf_bound_annot`` (what is
drawn), ``pdf_annot_rect`` / ``pdf_set_annot_rect``, ``pdf_annot_line`` /
``pdf_set_annot_line`` and the ink-list calls all use the displayed space. So
this module creates shapes with PyMuPDF from derotated input and reads and
changes geometry only through MuPDF's calls.

Free text is written with MuPDF's low-level calls rather than
``add_freetext_annot``: PyMuPDF's rich-text wrapper starts with indented
whitespace that MuPDF lays out as an empty first line, and leaves ``Contents``
empty. Writing it ourselves also lets an edit rewrite it in place, so its
``annotId`` survives.

``annotId`` is the annotation's xref: stable for the life of a session,
including across undo, redo and save.
"""

import html
import re
from collections.abc import Sequence
from dataclasses import dataclass, replace
from typing import Any, Literal

import pymupdf
from pymupdf import mupdf

from .errors import BadRequestError, NotFoundError
from .info import parse_pdf_date, pdf_date
from .sessions import Session

MarkupType = Literal["highlight", "underline", "strikeout"]
ShapeType = Literal["square", "circle", "line", "ink"]
FontFamily = Literal["sans", "serif", "mono"]
Align = Literal["left", "center", "right"]

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
#: fields (``forms.py``) and redaction marks (``redact.py``) have their own
#: tools, links are not annotations to the user.
_HIDDEN = {
    pymupdf.PDF_ANNOT_POPUP,
    pymupdf.PDF_ANNOT_WIDGET,
    pymupdf.PDF_ANNOT_LINK,
    pymupdf.PDF_ANNOT_REDACT,
}
#: Annotation types that follow text and have quads.
_TEXT_MARKUP = {
    pymupdf.PDF_ANNOT_HIGHLIGHT,
    pymupdf.PDF_ANNOT_UNDERLINE,
    pymupdf.PDF_ANNOT_STRIKE_OUT,
    pymupdf.PDF_ANNOT_SQUIGGLY,
}
#: Types whose ``rect`` can change: notes move, the others move and resize.
_RESIZABLE = {
    pymupdf.PDF_ANNOT_FREE_TEXT,
    pymupdf.PDF_ANNOT_SQUARE,
    pymupdf.PDF_ANNOT_CIRCLE,
    pymupdf.PDF_ANNOT_LINE,
    pymupdf.PDF_ANNOT_INK,
}
_MOVABLE = {pymupdf.PDF_ANNOT_TEXT} | _RESIZABLE
#: Types drawn with a stroke of some width.
_STROKED = {
    pymupdf.PDF_ANNOT_SQUARE,
    pymupdf.PDF_ANNOT_CIRCLE,
    pymupdf.PDF_ANNOT_LINE,
    pymupdf.PDF_ANNOT_INK,
    pymupdf.PDF_ANNOT_POLYGON,
    pymupdf.PDF_ANNOT_POLY_LINE,
}
#: Stroked types with an interior that can be filled.
_FILLABLE = {pymupdf.PDF_ANNOT_SQUARE, pymupdf.PDF_ANNOT_CIRCLE, pymupdf.PDF_ANNOT_POLYGON}

_STEP_NAMES = {
    "highlight": "Highlight",
    "underline": "Underline",
    "strikeout": "Strikeout",
    "square": "Rectangle",
    "circle": "Ellipse",
    "line": "Line",
    "ink": "Drawing",
}

NOTE_ICON = "Comment"

#: Smallest size of a shape or text box, in points.
MIN_SIZE = 1.0

# Free text fonts: the CSS family MuPDF maps to its built-in font, and the
# base-14 name for the plain appearance string other readers fall back to.
_CSS_FAMILY = {"sans": "Helvetica", "serif": "Times", "mono": "Courier"}
_DA_FONT = {"sans": "Helv", "serif": "TiRo", "mono": "Cour"}
_QUADDING = {"left": 0, "center": 1, "right": 2}
_RC_HEAD = (
    '<?xml version="1.0"?><body xmlns="http://www.w3.org/1999/xhtml"'
    ' xmlns:xfa="http://www.xfa.org/schema/xfa-data/1.0/"'
    ' xfa:APIVersion="Acrobat:8.0.0" xfa:spec="2.4">'
)


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


def check_rect(values: Sequence[float], what: str = "rect") -> pymupdf.Rect:
    """A displayed-space rect from the API, normalised and validated."""
    if len(values) != 4:
        raise BadRequestError(f"A {what} is four numbers: x0, y0, x1, y1.")
    rect = pymupdf.Rect(values).normalize()
    if rect.width < MIN_SIZE or rect.height < MIN_SIZE:
        raise BadRequestError(f"The {what} is too small.")
    return rect


def _check_opacity(opacity: float | None) -> None:
    if opacity is not None and not 0 <= opacity <= 1:
        raise BadRequestError("Opacity is between 0 and 1.")


def _check_width(width: float | None) -> None:
    if width is not None and not 0 <= width <= 100:
        raise BadRequestError("The line width is between 0 and 100 points.")


def _check_rotation(rotation: int | None) -> None:
    if rotation is not None and rotation % 90:
        raise BadRequestError("Rotation is a multiple of 90 degrees.")


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


# --- Free text style ---------------------------------------------------------


@dataclass(frozen=True)
class TextStyle:
    font_family: FontFamily = "sans"
    font_size: float = 12.0
    color: str = "#000000"
    bold: bool = False
    italic: bool = False
    align: Align = "left"

    def css(self) -> str:
        return (
            f"font-family: {_CSS_FAMILY[self.font_family]}; "
            f"font-size: {self.font_size:g}pt; "
            f"color: {self.color}; "
            f"text-align: {self.align}; "
            f"font-weight: {'bold' if self.bold else 'normal'}; "
            f"font-style: {'italic' if self.italic else 'normal'}"
        )

    def describe(self) -> dict[str, Any]:
        return {
            "fontFamily": self.font_family,
            "fontSize": self.font_size,
            "bold": self.bold,
            "italic": self.italic,
            "align": self.align,
        }


def _family_from(name: str) -> FontFamily:
    lowered = name.lower()
    if any(key in lowered for key in ("cour", "mono")):
        return "mono"
    if any(key in lowered for key in ("times", "tiro", "serif", "roman")) and "sans" not in lowered:
        return "serif"
    return "sans"


def _read_text_style(annot: pymupdf.Annot) -> TextStyle:
    """A free text annotation's style: from its rich-text default style (DS),
    which this module writes, else from its plain appearance string (DA)."""
    doc = annot.get_parent().parent
    style = TextStyle()
    kind, ds = doc.xref_get_key(annot.xref, "DS")
    if kind == "string" and ds:
        values = {
            key.strip().lower(): value.strip()
            for key, _, value in (part.partition(":") for part in ds.split(";"))
            if value
        }
        size = re.match(r"([\d.]+)", values.get("font-size", ""))
        color = values.get("color", "")
        align = values.get("text-align", "left")
        style = TextStyle(
            font_family=_family_from(values.get("font-family", "")),
            font_size=float(size.group(1)) if size else style.font_size,
            color=color.lower() if re.fullmatch(r"#[0-9a-fA-F]{6}", color) else style.color,
            bold=values.get("font-weight", "") in ("bold", "700", "800", "900"),
            italic=values.get("font-style", "") in ("italic", "oblique"),
            align=align if align in _QUADDING else "left",  # type: ignore[arg-type]
        )
    else:
        kind, da = doc.xref_get_key(annot.xref, "DA")
        if kind == "string":
            font = re.search(r"/(\S+)\s+([\d.]+)\s+Tf", da)
            rgb = re.search(r"([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+rg", da)
            gray = re.search(r"([\d.]+)\s+g\b", da)
            color = style.color
            if rgb:
                color = hex_color([float(v) for v in rgb.groups()]) or color
            elif gray:
                color = hex_color([float(gray.group(1))] * 3) or color
            style = TextStyle(
                font_family=_family_from(font.group(1)) if font else "sans",
                font_size=float(font.group(2)) if font and float(font.group(2)) > 0 else 12.0,
                color=color,
            )
        quadding = mupdf.pdf_annot_quadding(annot.this)
        style = replace(style, align={0: "left", 1: "center", 2: "right"}.get(quadding, "left"))
    return style


def _rich_text(text: str, style: TextStyle) -> str:
    lines = "<br/>".join(html.escape(line) for line in text.split("\n"))
    return f'{_RC_HEAD}<p style="{style.css()}">{lines}</p></body>'


def _annot_rotation(annot: pymupdf.Annot) -> int:
    doc = annot.get_parent().parent
    kind, value = doc.xref_get_key(annot.xref, "Rotate")
    try:
        return int(float(value)) % 360 if kind == "int" or kind == "float" else 0
    except ValueError:
        return 0


def _text_rotation(annot: pymupdf.Annot, page: pymupdf.Page) -> int:
    """Clockwise rotation of the text as the reader sees it."""
    return (page.rotation - _annot_rotation(annot)) % 360


def _write_freetext(
    annot: pymupdf.Annot,
    page: pymupdf.Page,
    rect: pymupdf.Rect,
    text: str,
    style: TextStyle,
    rotation: int,
    fill: str | None,
    opacity: float,
) -> None:
    """Sets everything a free text annotation shows and regenerates its look.

    ``rect`` is in displayed space; ``rotation`` is clockwise as displayed.
    PDF's ``/Rotate`` turns text counter-clockwise relative to the unrotated
    page, hence ``page.rotation - rotation``.
    """
    this = annot.this
    obj = mupdf.pdf_annot_obj(this)
    name = pymupdf.PDF_NAME
    mupdf.pdf_set_annot_rect(this, mupdf.FzRect(rect.x0, rect.y0, rect.x1, rect.y1))
    mupdf.pdf_set_annot_contents(this, text)
    mupdf.pdf_dict_put_text_string(obj, name("RC"), _rich_text(text, style))
    mupdf.pdf_dict_put_text_string(obj, name("DS"), style.css())
    r, g, b = rgb_color(style.color)
    font = _DA_FONT[style.font_family]
    appearance = f"{r:g} {g:g} {b:g} rg /{font} {style.font_size:g} Tf"
    mupdf.pdf_dict_put_text_string(obj, name("DA"), appearance)
    mupdf.pdf_set_annot_quadding(this, _QUADDING[style.align])
    stored = (page.rotation - rotation) % 360
    if stored:
        mupdf.pdf_dict_put_int(obj, name("Rotate"), stored)
    else:
        mupdf.pdf_dict_del(obj, name("Rotate"))
    if fill:
        mupdf.pdf_set_annot_color(this, list(rgb_color(fill)))
    else:
        mupdf.pdf_dict_del(obj, name("C"))
    mupdf.pdf_set_annot_border_width(this, 0)
    mupdf.pdf_set_annot_opacity(this, opacity)
    mupdf.pdf_dirty_annot(this)
    mupdf.pdf_update_annot(this)


# --- Geometry ----------------------------------------------------------------


def _geometry_box(annot: pymupdf.Annot) -> pymupdf.Rect:
    """The annotation's own geometry in displayed space: its rectangle, or the
    box around its points. Its drawn bounds add the stroke and line ends."""
    this = annot.this
    kind = annot.type[0]
    if kind == pymupdf.PDF_ANNOT_LINE:
        a, b = mupdf.FzPoint(), mupdf.FzPoint()
        mupdf.pdf_annot_line(this, a, b)
        return pymupdf.Rect(min(a.x, b.x), min(a.y, b.y), max(a.x, b.x), max(a.y, b.y))
    if kind == pymupdf.PDF_ANNOT_INK:
        box = pymupdf.Rect(pymupdf.EMPTY_RECT())
        for stroke in _ink_points(annot):
            for x, y in stroke:
                box |= pymupdf.Point(x, y)
        return box
    return pymupdf.Rect(mupdf.pdf_annot_rect(this))


def _ink_points(annot: pymupdf.Annot) -> list[list[tuple[float, float]]]:
    this = annot.this
    strokes = []
    for i in range(mupdf.pdf_annot_ink_list_count(this)):
        points = []
        for j in range(mupdf.pdf_annot_ink_list_stroke_count(this, i)):
            point = mupdf.pdf_annot_ink_list_stroke_vertex(this, i, j)
            points.append((point.x, point.y))
        strokes.append(points)
    return strokes


def _line_points(annot: pymupdf.Annot) -> list[list[float]]:
    a, b = mupdf.FzPoint(), mupdf.FzPoint()
    mupdf.pdf_annot_line(annot.this, a, b)
    return [[_round(a.x), _round(a.y)], [_round(b.x), _round(b.y)]]


def _place(annot: pymupdf.Annot, page: pymupdf.Page, target: pymupdf.Rect) -> None:
    """Moves and scales a free text, shape or ink annotation so its drawn
    bounds become ``target`` (displayed space). The margin between geometry and
    bounds (half the stroke, line ends) is kept as it is."""
    bounds = _bounds(annot)
    box = _geometry_box(annot)
    inner = pymupdf.Rect(
        target.x0 + (box.x0 - bounds.x0),
        target.y0 + (box.y0 - bounds.y0),
        target.x1 - (bounds.x1 - box.x1),
        target.y1 - (bounds.y1 - box.y1),
    )
    if inner.width < MIN_SIZE and box.width >= MIN_SIZE:
        inner.x1 = inner.x0 + MIN_SIZE
    if inner.height < MIN_SIZE and box.height >= MIN_SIZE:
        inner.y1 = inner.y0 + MIN_SIZE

    def scale(value: float, start: float, size: float, new_start: float, new_size: float) -> float:
        if size < 0.01:
            return new_start + (value - start)
        return new_start + (value - start) * new_size / size

    def move(x: float, y: float) -> mupdf.FzPoint:
        return mupdf.FzPoint(
            scale(x, box.x0, box.width, inner.x0, inner.width),
            scale(y, box.y0, box.height, inner.y0, inner.height),
        )

    this = annot.this
    kind = annot.type[0]
    if kind == pymupdf.PDF_ANNOT_LINE:
        a, b = mupdf.FzPoint(), mupdf.FzPoint()
        mupdf.pdf_annot_line(this, a, b)
        mupdf.pdf_set_annot_line(this, move(a.x, a.y), move(b.x, b.y))
    elif kind == pymupdf.PDF_ANNOT_INK:
        strokes = _ink_points(annot)
        mupdf.pdf_clear_annot_ink_list(this)
        for stroke in strokes:
            mupdf.pdf_add_annot_ink_list_stroke(this)
            for x, y in stroke:
                mupdf.pdf_add_annot_ink_list_stroke_vertex(this, move(x, y))
    else:
        mupdf.pdf_set_annot_rect(this, mupdf.FzRect(inner.x0, inner.y0, inner.x1, inner.y1))
    mupdf.pdf_dirty_annot(this)
    mupdf.pdf_update_annot(this)


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


# --- Describing --------------------------------------------------------------


def _width(annot: pymupdf.Annot) -> float:
    width = annot.border.get("width", -1)
    return 1.0 if width is None or width < 0 else _round(width)


def describe(annot: pymupdf.Annot, page: pymupdf.Page, index: int) -> dict[str, Any]:
    kind = annot.type[0]
    info = annot.info
    opacity = annot.opacity
    colors = annot.colors
    result: dict[str, Any] = {
        "annotId": annot.xref,
        "page": index,
        "type": _TYPE_NAMES.get(kind, str(annot.type[1]).lower()),
        "rect": _rect(_bounds(annot)),
        "color": hex_color(colors.get("stroke")),
        "opacity": 1.0 if opacity is None or opacity < 0 else round(opacity, 3),
        "contents": info.get("content") or "",
        "author": info.get("title") or "",
        "createdAt": parse_pdf_date(info.get("creationDate")),
        "modifiedAt": parse_pdf_date(info.get("modDate")),
    }
    if kind in _TEXT_MARKUP:
        result["quads"] = _quads_out(annot, page)
    if kind in _STROKED:
        result["width"] = _width(annot)
        result["fill"] = hex_color(colors.get("fill")) if kind in _FILLABLE else None
    if kind == pymupdf.PDF_ANNOT_LINE:
        result["points"] = _line_points(annot)
        start, end = annot.line_ends or (0, 0)
        result["arrowStart"] = start != pymupdf.PDF_ANNOT_LE_NONE
        result["arrowEnd"] = end != pymupdf.PDF_ANNOT_LE_NONE
    if kind == pymupdf.PDF_ANNOT_FREE_TEXT:
        style = _read_text_style(annot)
        # For free text, C is the background; the text colour is in the style.
        result["fill"] = hex_color(colors.get("stroke"))
        result["color"] = style.color
        result["text"] = result["contents"]
        result["rotation"] = _text_rotation(annot, page)
        result["box"] = _rect(_geometry_box(annot))
        result.update(style.describe())
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


def _stamp(annot: pymupdf.Annot, author: str | None, *, created: bool) -> None:
    now = pdf_date()
    if created:
        annot.set_info(title=author or None, creationDate=now, modDate=now)
    else:
        annot.set_info(modDate=now)


def _respond(session: Session, step_pages: set[int], annot_id: int, index: int) -> dict[str, Any]:
    response = session.mutated(step_pages)
    page = session.page(index)
    response["annotation"] = describe(page.load_annot(annot_id), page, index)
    return response


# --- Creating ----------------------------------------------------------------


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
        return _respond(session, step.pages, annot.xref, page_index)


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
        return _respond(session, step.pages, annot.xref, page_index)


@dataclass(frozen=True)
class ShapeStyle:
    color: str
    fill: str | None = None
    width: float = 1.0
    opacity: float = 1.0
    arrow_start: bool = False
    arrow_end: bool = False


def _apply_shape_style(annot: pymupdf.Annot, style: ShapeStyle) -> None:
    kind = annot.type[0]
    fill = rgb_color(style.fill) if style.fill and kind in _FILLABLE else None
    annot.set_colors(stroke=rgb_color(style.color), fill=fill if fill else [])
    annot.set_border(width=style.width)
    annot.set_opacity(style.opacity)
    if kind == pymupdf.PDF_ANNOT_LINE:
        arrow, none = pymupdf.PDF_ANNOT_LE_OPEN_ARROW, pymupdf.PDF_ANNOT_LE_NONE
        start = arrow if style.arrow_start else none
        annot.set_line_ends(start, arrow if style.arrow_end else none)


def _points(values: Sequence[Sequence[float]], what: str, minimum: int) -> list[pymupdf.Point]:
    points = []
    for value in values:
        if len(value) != 2:
            raise BadRequestError(f"A point of the {what} is two numbers: x, y.")
        points.append(pymupdf.Point(value[0], value[1]))
    if len(points) < minimum:
        raise BadRequestError(f"The {what} needs at least {minimum} points.")
    return points


def create_shape(
    session: Session,
    kind: ShapeType,
    page_index: int,
    style: ShapeStyle,
    author: str | None,
    *,
    rect: Sequence[float] | None = None,
    points: Sequence[Sequence[float]] | None = None,
    strokes: Sequence[Sequence[Sequence[float]]] | None = None,
    contents: str | None = None,
) -> dict[str, Any]:
    """Rectangle or ellipse (``rect``), line (two ``points``) or ink
    (``strokes``), all in displayed space."""
    rgb_color(style.color)
    if style.fill:
        rgb_color(style.fill)
    _check_opacity(style.opacity)
    _check_width(style.width)
    if kind in ("square", "circle"):
        if rect is None:
            raise BadRequestError("A rectangle or ellipse needs a rect.")
        box = check_rect(rect)
    elif kind == "line":
        if points is None:
            raise BadRequestError("A line needs two points.")
        ends = _points(points, "line", 2)[:2]
        if abs(ends[0] - ends[1]) < MIN_SIZE:
            raise BadRequestError("The line is too short.")
    else:
        if not strokes:
            raise BadRequestError("A drawing needs at least one stroke.")
        lines = [_points(stroke, "stroke", 1) for stroke in strokes]

    with session.lock:
        page = session.page(page_index)
        matrix = page.derotation_matrix
        with session.edit(_STEP_NAMES[kind]) as step:
            if kind == "square":
                annot = page.add_rect_annot(box * matrix)
            elif kind == "circle":
                annot = page.add_circle_annot(box * matrix)
            elif kind == "line":
                annot = page.add_line_annot(ends[0] * matrix, ends[1] * matrix)
            else:
                # A single point would draw nothing; make it a dot.
                lines = [
                    line if len(line) > 1 else [line[0], line[0] + (0.01, 0)] for line in lines
                ]
                annot = page.add_ink_annot([[tuple(p * matrix) for p in line] for line in lines])
            _apply_shape_style(annot, style)
            _stamp(annot, author, created=True)
            if contents:
                mupdf.pdf_set_annot_contents(annot.this, contents)
            annot.update()
            step.pages.add(page_index)
        return _respond(session, step.pages, annot.xref, page_index)


def create_freetext(
    session: Session,
    page_index: int,
    rect: Sequence[float],
    text: str,
    style: TextStyle,
    author: str | None,
    *,
    rotation: int = 0,
    fill: str | None = None,
    opacity: float = 1.0,
) -> dict[str, Any]:
    box = check_rect(rect)
    rgb_color(style.color)
    if fill:
        rgb_color(fill)
    _check_opacity(opacity)
    _check_rotation(rotation)
    if not 1 <= style.font_size <= 500:
        raise BadRequestError("The font size is between 1 and 500 points.")
    if not text.strip():
        raise BadRequestError("A text box needs some text.")

    with session.lock:
        page = session.page(page_index)
        with session.edit("Text Box") as step:
            annot = page.add_freetext_annot(pymupdf.Rect(0, 0, 10, 10), " ")
            _stamp(annot, author, created=True)
            _write_freetext(annot, page, box, text, style, rotation % 360, fill, opacity)
            step.pages.add(page_index)
        return _respond(session, step.pages, annot.xref, page_index)


# --- Changing ----------------------------------------------------------------


UNSET: Any = object()


def update_annotation(
    session: Session,
    annot_id: int,
    page_hint: int | None,
    *,
    contents: str | None = None,
    color: str | None = None,
    opacity: float | None = None,
    rect: list[float] | None = None,
    fill: str | None | Any = UNSET,
    width: float | None = None,
    arrow_start: bool | None = None,
    arrow_end: bool | None = None,
    text: str | None = None,
    font_family: FontFamily | None = None,
    font_size: float | None = None,
    bold: bool | None = None,
    italic: bool | None = None,
    align: Align | None = None,
    rotation: int | None = None,
) -> dict[str, Any]:
    """Changes what is given. ``fill`` is a colour, or None to remove it.

    ``rect`` is the new drawn bounds: notes are moved to its top-left corner,
    free text, shapes and ink are moved and scaled to fill it.
    """
    if color is not None:
        rgb_color(color)
    if fill is not UNSET and fill is not None:
        rgb_color(fill)
    _check_opacity(opacity)
    _check_width(width)
    _check_rotation(rotation)
    if font_size is not None and not 1 <= font_size <= 500:
        raise BadRequestError("The font size is between 1 and 500 points.")
    target = check_rect(rect) if rect is not None else None
    text_changes = {
        "font_family": font_family,
        "font_size": font_size,
        "bold": bold,
        "italic": italic,
        "align": align,
    }
    text_changes = {key: value for key, value in text_changes.items() if value is not None}

    named = [
        name
        for name, given in (
            ("Edit Comment", contents is not None),
            ("Change Colour", color is not None),
            ("Change Opacity", opacity is not None),
            ("Move", rect is not None),
            ("Change Fill", fill is not UNSET),
            ("Change Line", width is not None or arrow_start is not None or arrow_end is not None),
            ("Edit Text", text is not None),
            ("Change Text Style", bool(text_changes)),
            ("Rotate", rotation is not None),
        )
        if given
    ]
    if not named:
        raise BadRequestError("Nothing to change.")

    with session.lock:
        index, page, annot = _find(session, annot_id, page_hint)
        kind = annot.type[0]
        if rect is not None and kind not in _MOVABLE:
            raise BadRequestError("This kind of annotation cannot be moved.")
        is_text = kind == pymupdf.PDF_ANNOT_FREE_TEXT
        if (text is not None or text_changes or rotation is not None) and not is_text:
            raise BadRequestError("Only text boxes have text, a font and a rotation.")
        if text is not None and not text.strip():
            raise BadRequestError("A text box needs some text.")
        if (width is not None or arrow_start is not None or arrow_end is not None) and (
            kind not in _STROKED
        ):
            raise BadRequestError("This kind of annotation has no line.")
        if fill is not UNSET and kind not in _FILLABLE and not is_text:
            raise BadRequestError("This kind of annotation has no fill.")

        name = named[0] if len(named) == 1 else "Edit Annotation"
        if target is not None and kind in _RESIZABLE:
            bounds = _bounds(annot)
            same_width = abs(target.width - bounds.width) < 0.01
            if same_width and abs(target.height - bounds.height) < 0.01:
                # A plain move stays on the page, as notes do.
                x, y = _clamp_point(page, target.x0, target.y0, bounds)
                target = pymupdf.Rect(x, y, x + bounds.width, y + bounds.height)
            elif len(named) == 1:
                name = "Resize"

        with session.edit(name) as step:
            if is_text:
                _update_freetext(
                    annot,
                    page,
                    target=target,
                    text=text if text is not None else contents,
                    color=color,
                    fill=fill,
                    opacity=opacity,
                    rotation=rotation,
                    text_changes=text_changes,
                )
            else:
                if contents is not None:
                    mupdf.pdf_set_annot_contents(annot.this, contents)
                if kind in _STROKED and (
                    color is not None
                    or fill is not UNSET
                    or width is not None
                    or arrow_start is not None
                    or arrow_end is not None
                ):
                    current = describe(annot, page, index)
                    _apply_shape_style(
                        annot,
                        ShapeStyle(
                            color=color or current["color"] or "#000000",
                            fill=current.get("fill") if fill is UNSET else fill,
                            width=current["width"] if width is None else width,
                            opacity=current["opacity"],
                            arrow_start=current.get("arrowStart", False)
                            if arrow_start is None
                            else arrow_start,
                            arrow_end=current.get("arrowEnd", False)
                            if arrow_end is None
                            else arrow_end,
                        ),
                    )
                elif color is not None:
                    annot.set_colors(stroke=rgb_color(color))
                if opacity is not None:
                    annot.set_opacity(opacity)
                annot.update()
                if target is not None:
                    if kind in _RESIZABLE:
                        _place(annot, page, target)
                    else:
                        x, y = _clamp_point(page, target.x0, target.y0, _bounds(annot))
                        _move_to(annot, x, y)
            _stamp(annot, None, created=False)
            step.pages.add(index)
        return _respond(session, step.pages, annot_id, index)


def _update_freetext(
    annot: pymupdf.Annot,
    page: pymupdf.Page,
    *,
    target: pymupdf.Rect | None,
    text: str | None,
    color: str | None,
    fill: str | None | Any,
    opacity: float | None,
    rotation: int | None,
    text_changes: dict[str, Any],
) -> None:
    style = _read_text_style(annot)
    if color is not None:
        style = replace(style, color=color)
    if text_changes:
        style = replace(style, **text_changes)
    current_fill = hex_color(annot.colors.get("stroke"))
    current_opacity = annot.opacity
    _write_freetext(
        annot,
        page,
        target if target is not None else _geometry_box(annot),
        text if text is not None else annot.info.get("content") or "",
        style,
        _text_rotation(annot, page) if rotation is None else rotation % 360,
        current_fill if fill is UNSET else fill,
        (1.0 if current_opacity is None or current_opacity < 0 else current_opacity)
        if opacity is None
        else opacity,
    )


def delete_annotation(session: Session, annot_id: int, page_hint: int | None) -> dict[str, Any]:
    with session.lock:
        index, page, annot = _find(session, annot_id, page_hint)
        with session.edit("Delete") as step:
            page.delete_annot(annot)
            step.pages.add(index)
        return session.mutated(step.pages)
