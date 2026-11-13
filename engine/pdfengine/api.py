"""The document endpoints. Mounted under ``/v1`` by ``server.create_app``.

Pages are addressed by 0-based index everywhere in the API.
"""

import asyncio
import os
import threading
from typing import Annotated, Any

from fastapi import APIRouter, Query, Request, Response
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

from .info import document_info, document_outline
from .pages import rotate_pages
from .render import ImageFormat, render_page
from .sessions import SessionRegistry, open_session
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


def build_router(sessions: SessionRegistry) -> APIRouter:
    router = APIRouter(prefix="/docs")
    render_slots = asyncio.Semaphore(RENDER_SLOTS)

    @router.post("/open")
    def open_document(body: OpenRequest) -> dict[str, Any]:
        session = open_session(body.path, body.password)
        try:
            with session.lock:
                metadata = session.doc.metadata or {}
                response = {
                    "docId": session.id,
                    "path": session.path,
                    "fileName": os.path.basename(session.path),
                    "pageCount": session.page_count,
                    "pages": session.page_infos(),
                    "title": str(metadata.get("title") or "").strip(),
                    "isEncrypted": session.encrypted,
                    "hasTextLayer": session.has_text_layer(),
                    "revision": session.revision,
                }
        except Exception:
            session.close()
            raise
        sessions.add(session)
        return response

    @router.delete("")
    def close_all_documents() -> dict[str, int]:
        """Closes every session. The app calls this when its window starts
        afresh, so sessions of a previous page load are not left behind."""
        count = len(sessions)
        sessions.close_all()
        return {"closed": count}

    @router.delete("/{doc_id}")
    def close_document(doc_id: str) -> dict[str, bool]:
        sessions.remove(doc_id).close()
        return {"closed": True}

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
