"""Endpoints of the processing tools (phase 6): jobs, protection, OCR
languages, converters and printing. Mounted under ``/v1`` by
``server.create_app``.

| Endpoint | Purpose |
|---|---|
| ``POST /jobs {type, docId?, params}`` | Start a job; returns ``{jobId, ...snapshot}`` |
| ``GET /jobs/{jobId}`` | ``{status, progress, message, result?, error?}`` |
| ``POST /jobs/{jobId}/cancel`` | Request cancellation |
| ``GET/POST/DELETE /docs/{id}/security`` | Protection (``security.py``) |
| ``GET /ocr/languages``, ``DELETE /ocr/languages/{code}`` | OCR language data (``ocr.py``) |
| ``GET /convert/converters`` | Which Word-to-PDF converter exists (``convert.py``) |
| ``POST /docs/{id}/print-file`` | The document as it is now, in a temporary file to print |
"""

import os
import tempfile
from typing import Any

import pymupdf
from fastapi import APIRouter
from pydantic import Field

from .api import _Body
from .convert import detect_converters
from .jobs import JobRegistry, JobType
from .ocr import list_languages, remove_language
from .save import SAVE_OPTIONS, open_copy
from .security import remove_protection, security_state, set_protection
from .sessions import SessionRegistry


class StartJobRequest(_Body):
    type: str = Field(min_length=1)
    doc_id: str | None = None
    params: dict[str, Any] = Field(default_factory=dict)


class Permissions(_Body):
    allow_print: bool = Field(default=True, alias="print")
    allow_copy: bool = Field(default=True, alias="copy")
    modify: bool = True
    annotate: bool = True
    fill_forms: bool = True


class SecurityRequest(_Body):
    #: Password to open the file.
    user_password: str | None = Field(default=None, max_length=127)
    #: Password to change permissions.
    owner_password: str | None = Field(default=None, max_length=127)
    permissions: Permissions = Field(default_factory=Permissions)
    #: The owner password of a protected file opened without it.
    current_password: str | None = None


class RemoveSecurityRequest(_Body):
    current_password: str | None = None


def all_job_types() -> list[JobType]:
    from .compress import COMPRESS_JOB
    from .convert import CONVERT_JOBS
    from .ocr import DOWNLOAD_JOB, OCR_JOB

    return [COMPRESS_JOB, OCR_JOB, DOWNLOAD_JOB, *CONVERT_JOBS]


def build_job_registry(sessions: SessionRegistry) -> JobRegistry:
    jobs = JobRegistry(sessions)
    for job_type in all_job_types():
        jobs.register(job_type)
    return jobs


def build_jobs_router(jobs: JobRegistry) -> APIRouter:
    router = APIRouter(prefix="/jobs")

    @router.post("")
    def start_job(body: StartJobRequest) -> dict[str, Any]:
        job = jobs.start(body.type, body.doc_id, body.params)
        return jobs.snapshot(job.id)

    @router.get("/{job_id}")
    def job_status(job_id: str) -> dict[str, Any]:
        return jobs.snapshot(job_id)

    @router.post("/{job_id}/cancel")
    def cancel_job(job_id: str) -> dict[str, Any]:
        jobs.cancel(job_id)
        return jobs.snapshot(job_id)

    return router


def build_processing_router(sessions: SessionRegistry) -> APIRouter:
    router = APIRouter()

    @router.get("/convert/converters")
    def converters() -> dict[str, Any]:
        return detect_converters()

    @router.get("/ocr/languages")
    def ocr_languages() -> list[dict[str, Any]]:
        return list_languages()

    @router.delete("/ocr/languages/{code}")
    def delete_ocr_language(code: str) -> dict[str, bool]:
        remove_language(code)
        return {"removed": True}

    @router.post("/docs/{doc_id}/print-file")
    def print_file(doc_id: str) -> dict[str, str]:
        """Writes the document as it is now (unsaved changes included) to a
        new temporary folder ``pdfnix-print-*``, unencrypted so the printing
        program can open it. The app prints it and then deletes the folder."""
        session = sessions.get(doc_id)
        folder = tempfile.mkdtemp(prefix="pdfnix-print-")
        stem = os.path.splitext(os.path.basename(session.path))[0] or "document"
        path = os.path.join(folder, f"{stem}.pdf")
        with session.lock:
            copy = open_copy(session)
            try:
                copy.save(path, encryption=pymupdf.PDF_ENCRYPT_NONE, **SAVE_OPTIONS)
            finally:
                copy.close()
        return {"path": path}

    @router.get("/docs/{doc_id}/security")
    def get_security(doc_id: str) -> dict[str, Any]:
        return security_state(sessions.get(doc_id))

    @router.post("/docs/{doc_id}/security")
    def post_security(doc_id: str, body: SecurityRequest) -> dict[str, Any]:
        return set_protection(
            sessions.get(doc_id),
            user_password=body.user_password,
            owner_password=body.owner_password,
            permissions=body.permissions.model_dump(by_alias=True),
            current_password=body.current_password,
        )

    @router.delete("/docs/{doc_id}/security")
    def delete_security(doc_id: str, body: RemoveSecurityRequest | None = None) -> dict[str, Any]:
        return remove_protection(sessions.get(doc_id), body.current_password if body else None)

    return router
