"""Endpoints of the document tools (phase 5): page management, forms,
redaction, watermarks and headers/footers. Mounted under ``/v1`` by
``server.create_app``. Pages are 0-based indexes.
"""

from typing import Annotated, Any, Literal

from fastapi import APIRouter, Response
from pydantic import Field

from .api import _Body
from .forms import flatten_form, list_fields, reset_form, set_values
from .pages import (
    SplitMode,
    delete_pages,
    duplicate_pages,
    extract_pages,
    insert_blank_pages,
    insert_pdf_file,
    merge_files,
    reorder_pages,
    split_document,
)
from .redact import (
    DEFAULT_FILL,
    add_marks,
    apply_redactions,
    list_marks,
    remove_mark,
    search_and_mark,
)
from .sessions import MUPDF_LOCK, SessionRegistry
from .watermark import (
    FontFamily,
    HeaderFooterSpec,
    Layer,
    Position,
    WatermarkSpec,
    add_header_footer,
    add_watermark,
    preview_header_footer,
    preview_watermark,
    read_image,
)

# --- Request bodies ---------------------------------------------------------------


class ReorderRequest(_Body):
    order: list[int]


class PagesRequest(_Body):
    pages: list[int]


class InsertBlankRequest(_Body):
    at: int
    count: int = 1
    width: float | None = None
    height: float | None = None


class InsertPdfRequest(_Body):
    path: str = Field(min_length=1)
    password: str | None = None
    at: int
    #: 0-based pages of the other file, in the order wanted; omit for all.
    from_pages: list[int] | None = None


class ExtractRequest(_Body):
    pages: list[int]
    out_path: str = Field(min_length=1)


class SplitRequest(_Body):
    mode: SplitMode
    #: ``ranges`` mode: the pages of each part.
    ranges: list[list[int]] | None = None
    #: ``every`` mode: pages per part.
    n: int | None = None
    out_dir: str = Field(min_length=1)
    name_template: str = "{name}-{n}"
    overwrite: bool = False


class FieldValue(_Body):
    field_id: int
    value: str | bool | list[str] | None


class FormValuesRequest(_Body):
    values: list[FieldValue]


Color = Annotated[str, Field(pattern=r"^#[0-9a-fA-F]{6}$")]


class MarkRequest(_Body):
    page: int
    rects: list[list[float]] | None = None
    quads: list[list[float]] | None = None
    #: Colour painted over the area once applied; null for none.
    fill: Color | None = DEFAULT_FILL
    overlay_text: str = Field(default="", max_length=200)


class RedactSearchRequest(_Body):
    query: str
    match_case: bool = False
    whole_word: bool = False
    pages: list[int] | None = None
    fill: Color | None = DEFAULT_FILL
    overlay_text: str = Field(default="", max_length=200)


class ApplyRedactionsRequest(_Body):
    clean_metadata: bool = True


class WatermarkRequest(_Body):
    kind: Literal["text", "image"]
    text: str = Field(default="", max_length=500)
    image_path: str | None = None
    font_family: FontFamily = "sans"
    bold: bool = True
    font_size: float = 72
    color: Color = "#ff0000"
    opacity: float = 0.3
    rotation: float = 45
    position: Position = "center"
    scale: float = 0.5
    layer: Layer = "over"
    pages: list[int] | None = None


class WatermarkPreviewRequest(WatermarkRequest):
    page: int
    #: Render scale, 1 = 72 dpi.
    preview_scale: float = Field(default=1.0, gt=0, le=8)


class HeaderFooterTexts(_Body):
    left: str = Field(default="", max_length=500)
    center: str = Field(default="", max_length=500)
    right: str = Field(default="", max_length=500)


class Margins(_Body):
    top: float = 36
    bottom: float = 36
    left: float = 54
    right: float = 54


class HeaderFooterRequest(_Body):
    header: HeaderFooterTexts = Field(default_factory=HeaderFooterTexts)
    footer: HeaderFooterTexts = Field(default_factory=HeaderFooterTexts)
    font_family: FontFamily = "sans"
    bold: bool = False
    font_size: float = 10
    color: Color = "#000000"
    margins: Margins = Field(default_factory=Margins)
    pages: list[int] | None = None
    start_number: int = 1
    date: str | None = Field(default=None, max_length=100)


class HeaderFooterPreviewRequest(HeaderFooterRequest):
    page: int
    preview_scale: float = Field(default=1.0, gt=0, le=8)


def _watermark_spec(body: WatermarkRequest) -> WatermarkSpec:
    return WatermarkSpec(
        kind=body.kind,
        text=body.text,
        image=read_image(body.image_path) if body.kind == "image" and body.image_path else b"",
        font_family=body.font_family,
        bold=body.bold,
        font_size=body.font_size,
        color=body.color.lower(),
        opacity=body.opacity,
        rotation=body.rotation,
        position=body.position,
        scale=body.scale,
        layer=body.layer,
    )


def _header_footer_spec(body: HeaderFooterRequest) -> HeaderFooterSpec:
    return HeaderFooterSpec(
        header=body.header.model_dump(),
        footer=body.footer.model_dump(),
        font_family=body.font_family,
        bold=body.bold,
        font_size=body.font_size,
        color=body.color.lower(),
        margins=body.margins.model_dump(),
        start_number=body.start_number,
        date=body.date,
    )


def _png(data: bytes) -> Response:
    return Response(content=data, media_type="image/png", headers={"Cache-Control": "no-store"})


class MergeInput(_Body):
    path: str = Field(min_length=1)
    password: str | None = None
    pages: list[int] | None = None


class MergeRequest(_Body):
    inputs: list[MergeInput]
    out_path: str = Field(min_length=1)


# --- Routers ------------------------------------------------------------------------


def build_tools_router(sessions: SessionRegistry) -> APIRouter:
    router = APIRouter(prefix="/docs")

    @router.post("/{doc_id}/pages/reorder")
    def pages_reorder(doc_id: str, body: ReorderRequest) -> dict[str, Any]:
        return reorder_pages(sessions.get(doc_id), body.order)

    @router.post("/{doc_id}/pages/delete")
    def pages_delete(doc_id: str, body: PagesRequest) -> dict[str, Any]:
        return delete_pages(sessions.get(doc_id), body.pages)

    @router.post("/{doc_id}/pages/duplicate")
    def pages_duplicate(doc_id: str, body: PagesRequest) -> dict[str, Any]:
        return duplicate_pages(sessions.get(doc_id), body.pages)

    @router.post("/{doc_id}/pages/insert-blank")
    def pages_insert_blank(doc_id: str, body: InsertBlankRequest) -> dict[str, Any]:
        return insert_blank_pages(
            sessions.get(doc_id), body.at, body.count, body.width, body.height
        )

    @router.post("/{doc_id}/pages/insert-pdf")
    def pages_insert_pdf(doc_id: str, body: InsertPdfRequest) -> dict[str, Any]:
        return insert_pdf_file(
            sessions.get(doc_id), body.path, body.at, body.password, body.from_pages
        )

    @router.post("/{doc_id}/pages/extract")
    def pages_extract(doc_id: str, body: ExtractRequest) -> dict[str, Any]:
        return extract_pages(sessions.get(doc_id), body.pages, body.out_path)

    @router.post("/{doc_id}/split")
    def split(doc_id: str, body: SplitRequest) -> dict[str, Any]:
        return split_document(
            sessions.get(doc_id),
            body.mode,
            body.out_dir,
            body.name_template,
            ranges=body.ranges,
            every=body.n,
            overwrite=body.overwrite,
        )

    @router.get("/{doc_id}/forms")
    def forms(doc_id: str) -> list[dict[str, Any]]:
        return list_fields(sessions.get(doc_id))

    @router.post("/{doc_id}/forms/values")
    def forms_values(doc_id: str, body: FormValuesRequest) -> dict[str, Any]:
        return set_values(
            sessions.get(doc_id),
            [{"fieldId": item.field_id, "value": item.value} for item in body.values],
        )

    @router.post("/{doc_id}/forms/flatten")
    def forms_flatten(doc_id: str) -> dict[str, Any]:
        return flatten_form(sessions.get(doc_id))

    @router.post("/{doc_id}/forms/reset")
    def forms_reset(doc_id: str) -> dict[str, Any]:
        return reset_form(sessions.get(doc_id))

    @router.get("/{doc_id}/redactions")
    def redactions(doc_id: str) -> list[dict[str, Any]]:
        return list_marks(sessions.get(doc_id))

    @router.post("/{doc_id}/redactions")
    def redactions_mark(doc_id: str, body: MarkRequest) -> dict[str, Any]:
        return add_marks(
            sessions.get(doc_id),
            body.page,
            rects=body.rects,
            quads=body.quads,
            fill=body.fill,
            overlay_text=body.overlay_text,
        )

    @router.delete("/{doc_id}/redactions/{annot_id}")
    def redactions_remove(doc_id: str, annot_id: int) -> dict[str, Any]:
        return remove_mark(sessions.get(doc_id), annot_id)

    @router.post("/{doc_id}/redactions/search")
    def redactions_search(doc_id: str, body: RedactSearchRequest) -> dict[str, Any]:
        return search_and_mark(
            sessions.get(doc_id),
            body.query,
            match_case=body.match_case,
            whole_word=body.whole_word,
            pages=body.pages,
            fill=body.fill,
            overlay_text=body.overlay_text,
        )

    @router.post("/{doc_id}/redactions/apply")
    def redactions_apply(doc_id: str, body: ApplyRedactionsRequest) -> dict[str, Any]:
        return apply_redactions(sessions.get(doc_id), clean_metadata=body.clean_metadata)

    @router.post("/{doc_id}/watermark")
    def watermark(doc_id: str, body: WatermarkRequest) -> dict[str, Any]:
        return add_watermark(sessions.get(doc_id), _watermark_spec(body), body.pages)

    @router.post("/{doc_id}/watermark/preview")
    def watermark_preview(doc_id: str, body: WatermarkPreviewRequest) -> Response:
        return _png(
            preview_watermark(
                sessions.get(doc_id), _watermark_spec(body), body.page, body.preview_scale
            )
        )

    @router.post("/{doc_id}/header-footer")
    def header_footer(doc_id: str, body: HeaderFooterRequest) -> dict[str, Any]:
        return add_header_footer(sessions.get(doc_id), _header_footer_spec(body), body.pages)

    @router.post("/{doc_id}/header-footer/preview")
    def header_footer_preview(doc_id: str, body: HeaderFooterPreviewRequest) -> Response:
        session = sessions.get(doc_id)
        spec = _header_footer_spec(body)
        with session.lock:
            targets = body.pages if body.pages is not None else list(range(session.page_count))
        ordered = sorted(set(targets))
        position = ordered.index(body.page) if body.page in ordered else 0
        number = body.start_number + position
        total = body.start_number + max(len(ordered), 1) - 1
        return _png(
            preview_header_footer(session, spec, body.page, body.preview_scale, number, total)
        )

    return router


def build_merge_router() -> APIRouter:
    router = APIRouter()

    @router.post("/merge")
    def merge(body: MergeRequest) -> dict[str, Any]:
        return merge_files(
            [item.model_dump() for item in body.inputs], body.out_path, lock=MUPDF_LOCK
        )

    return router
