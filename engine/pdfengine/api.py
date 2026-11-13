"""The document endpoints. Mounted under ``/v1`` by ``server.create_app``.

Pages are addressed by 0-based index everywhere in the API.
"""

import asyncio
import os
import threading
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Query, Request, Response
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

from .annotations import (
    create_markup,
    create_note,
    delete_annotation,
    list_annotations,
    update_annotation,
)
from .errors import BadRequestError
from .info import document_info, document_outline
from .pages import rotate_pages
from .recovery import RecoveryStore
from .render import ImageFormat, render_page
from .save import save_session
from .sessions import Session, SessionRegistry, open_session
from .text import SearchCancelled, page_text, search_document

# Renders waiting for the PyMuPDF lock. Anything beyond this waits in the
# event loop, where a request the client has abandoned can still be dropped.
RENDER_SLOTS = 2
# nginx's "client closed request"; the client is gone, so nobody reads it.
CLIENT_CLOSED = 499


class _Body(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, extra="forbid")


class OpenRequest(_Body):
    path: str = Field(min_length=1)
    password: str | None = None


class SearchRequest(_Body):
    query: str
    match_case: bool = False
    whole_word: bool = False


class RotateRequest(_Body):
    #: 0-based page indexes; omit to rotate every page.
    pages: list[int] | None = None
    degrees: int


Color = Annotated[str, Field(pattern=r"^#[0-9a-fA-F]{6}$")]


class CreateAnnotationRequest(_Body):
    type: Literal["highlight", "underline", "strikeout", "note"]
    page: int
    #: Text markup: quads in displayed space, ``[ulx, uly, urx, ury, llx, lly, lrx, lry]``.
    quads: list[list[float]] | None = None
    #: Note: where its top-left corner goes, displayed space.
    point: tuple[float, float] | None = None
    color: Color
    contents: str | None = None
    author: str | None = None


class UpdateAnnotationRequest(_Body):
    contents: str | None = None
    color: Color | None = None
    opacity: float | None = None
    #: New bounds (displayed space); the annotation is moved to the top-left corner.
    rect: list[float] | None = None


class SaveRequest(_Body):
    #: Save As target; omit to save to the document's own path.
    path: str | None = Field(default=None, min_length=1)


class RestoreRequest(_Body):
    password: str | None = None


def _register(sessions: SessionRegistry, session: Session) -> dict[str, Any]:
    """Adds a freshly opened session and returns the open response."""
    try:
        response = session.describe()
    except Exception:
        session.close()
        raise
    sessions.add(session)
    return response


def build_router(sessions: SessionRegistry, recovery: RecoveryStore) -> APIRouter:
    router = APIRouter(prefix="/docs")
    render_slots = asyncio.Semaphore(RENDER_SLOTS)

    @router.post("/open")
    def open_document(body: OpenRequest) -> dict[str, Any]:
        return _register(sessions, open_session(body.path, body.password))

    @router.delete("")
    def close_all_documents() -> dict[str, int]:
        """Closes every session. The app calls this when its window starts
        afresh, so sessions of a previous page load are not left behind.
        Unsaved changes are kept as recovery copies, which the fresh window
        then offers to restore."""
        count = len(sessions)
        recovery.flush()
        sessions.close_all()
        return {"closed": count}

    @router.delete("/{doc_id}")
    def close_document(doc_id: str) -> dict[str, bool]:
        session = sessions.remove(doc_id)
        session.close()
        recovery.discard_session(session)
        return {"closed": True}

    @router.get("/{doc_id}/state")
    def state(doc_id: str) -> dict[str, Any]:
        session = sessions.get(doc_id)
        with session.lock:
            return {
                "path": session.path,
                "fileName": os.path.basename(session.path),
                **session.state(),
            }

    @router.post("/{doc_id}/undo")
    def undo(doc_id: str) -> dict[str, Any]:
        session = sessions.get(doc_id)
        with session.lock:
            step = session.history.undo()
            return {**session.mutated(step.pages), "undone": step.name}

    @router.post("/{doc_id}/redo")
    def redo(doc_id: str) -> dict[str, Any]:
        session = sessions.get(doc_id)
        with session.lock:
            step = session.history.redo()
            return {**session.mutated(step.pages), "redone": step.name}

    @router.post("/{doc_id}/save")
    def save(doc_id: str, body: SaveRequest) -> dict[str, Any]:
        session = sessions.get(doc_id)
        response = save_session(session, body.path)
        recovery.discard_session(session)
        return response

    @router.get("/{doc_id}/annotations")
    def annotations(doc_id: str, page: int | None = None) -> list[dict[str, Any]]:
        return list_annotations(sessions.get(doc_id), page)

    @router.post("/{doc_id}/annotations")
    def create_annotation(doc_id: str, body: CreateAnnotationRequest) -> dict[str, Any]:
        session = sessions.get(doc_id)
        if body.type == "note":
            if body.point is None:
                raise BadRequestError("A note needs a point.")
            return create_note(
                session, body.page, body.point, body.contents or "", body.color, body.author
            )
        if body.quads is None:
            raise BadRequestError("Text markup needs quads.")
        return create_markup(
            session, body.type, body.page, body.quads, body.color, body.author, body.contents
        )

    @router.patch("/{doc_id}/annotations/{annot_id}")
    def patch_annotation(
        doc_id: str, annot_id: int, body: UpdateAnnotationRequest, page: int | None = None
    ) -> dict[str, Any]:
        return update_annotation(
            sessions.get(doc_id),
            annot_id,
            page,
            contents=body.contents,
            color=body.color,
            opacity=body.opacity,
            rect=body.rect,
        )

    @router.delete("/{doc_id}/annotations/{annot_id}")
    def remove_annotation(doc_id: str, annot_id: int, page: int | None = None) -> dict[str, Any]:
        return delete_annotation(sessions.get(doc_id), annot_id, page)

    @router.get("/{doc_id}/pages/{index}/render")
    async def render(
        doc_id: str,
        index: int,
        request: Request,
        scale: Annotated[float, Query(gt=0, le=64)] = 1.0,
        image_format: Annotated[ImageFormat, Query(alias="format")] = "auto",
    ) -> Response:
        session = sessions.get(doc_id)
        etag = f'"{session.revision}-{index}-{scale:.4f}-{image_format}"'
        headers = {"ETag": etag, "Cache-Control": "no-store"}
        if request.headers.get("if-none-match") == etag:
            return Response(status_code=304, headers=headers)

        async with render_slots:
            # The viewer cancels requests for pages that scrolled away.
            if await request.is_disconnected():
                return Response(status_code=CLIENT_CLOSED)
            image = await run_in_threadpool(render_page, session, index, scale, image_format)
        return Response(content=image.data, media_type=image.media_type, headers=headers)

    @router.get("/{doc_id}/pages/{index}/text")
    def text(doc_id: str, index: int) -> dict[str, Any]:
        return page_text(sessions.get(doc_id), index)

    @router.get("/{doc_id}/outline")
    def outline(doc_id: str) -> list[dict[str, Any]]:
        return document_outline(sessions.get(doc_id))

    @router.get("/{doc_id}/info")
    def info(doc_id: str) -> dict[str, Any]:
        return document_info(sessions.get(doc_id))

    @router.post("/{doc_id}/search", response_model=None)
    async def search(
        doc_id: str, body: SearchRequest, request: Request
    ) -> dict[str, Any] | Response:
        session = sessions.get(doc_id)
        gone = threading.Event()

        async def watch_client() -> None:
            while not gone.is_set():
                if await request.is_disconnected():
                    gone.set()
                    return
                await asyncio.sleep(0.1)

        watcher = asyncio.create_task(watch_client())
        try:
            return await run_in_threadpool(
                search_document,
                session,
                body.query,
                body.match_case,
                body.whole_word,
                cancelled=gone.is_set,
            )
        except SearchCancelled:
            return Response(status_code=CLIENT_CLOSED)
        finally:
            gone.set()
            watcher.cancel()

    @router.post("/{doc_id}/pages/rotate")
    def rotate(doc_id: str, body: RotateRequest) -> dict[str, Any]:
        return rotate_pages(sessions.get(doc_id), body.pages, body.degrees)

    return router


def build_recovery_router(sessions: SessionRegistry, recovery: RecoveryStore) -> APIRouter:
    router = APIRouter(prefix="/recovery")

    @router.get("")
    def list_copies() -> list[dict[str, Any]]:
        """Recovery copies left by a previous run (or page load) of the app."""
        return recovery.entries()

    @router.post("/{recovery_id}/open")
    def restore(recovery_id: str, body: RestoreRequest) -> dict[str, Any]:
        """Opens a copy as a document with unsaved changes, like ``/docs/open``."""
        return _register(sessions, recovery.restore(recovery_id, body.password))

    @router.delete("/{recovery_id}")
    def discard(recovery_id: str) -> dict[str, bool]:
        recovery.discard(recovery_id)
        return {"discarded": True}

    return router
