"""Background jobs: long operations that report progress and can be cancelled.

A job is started with ``POST /v1/jobs {type, docId?, params}`` and polled with
``GET /v1/jobs/{jobId}``. Each job type is registered with:

- a pydantic model for its parameters (checked when the job is started, so a
  bad request fails at once with 422 instead of becoming a failed job);
- ``prepare(session, params)``, run synchronously while starting: checks that
  depend on the document or the disk (``files_exist``, page indexes) and
  anything that must be taken from the document before the request returns;
  its return value is handed to ``run``;
- ``run(context, plan)``, run in a worker thread.

Rules for job code (see docs/plan/phase-6-processing-jobs.md):
- check ``context.check()`` between pages; it raises ``JobCancelled``;
- PyMuPDF holds the GIL and is not thread-safe, so a thread only touches
  documents with ``MUPDF_LOCK`` held, for short stretches (one page). Work that
  would hold it for long (OCR, compression, Word conversion) runs in a child
  process (``worker.run_in_process``), which cancelling terminates;
- a job that changes the open document works on a copy and changes the
  document only at the end, in one undo step (``session.edit``), after checking
  that the document has not changed since the job started;
- a job that writes files writes them under temporary names and renames them
  when they are complete.
"""

import logging
import threading
import time
import uuid
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any, Literal

from pydantic import BaseModel, ValidationError

from .errors import BadRequestError, EngineError, NotFoundError
from .sessions import Session, SessionRegistry

logger = logging.getLogger("pdfengine")

JobStatus = Literal["queued", "running", "done", "failed", "cancelled"]
FINISHED: frozenset[str] = frozenset({"done", "failed", "cancelled"})

#: Finished jobs are forgotten this many seconds after they end.
KEEP_FINISHED_SECONDS = 600.0


class JobCancelled(Exception):
    """Raised by ``JobContext.check`` once cancellation has been requested."""


class JobConflictError(EngineError):
    def __init__(self, message: str) -> None:
        super().__init__("job_running", message, 409)


class DocumentChangedError(EngineError):
    def __init__(self) -> None:
        super().__init__(
            "document_changed",
            "The document was changed while the job was running, so its result was not "
            "applied. Run it again.",
            409,
        )


@dataclass
class Job:
    id: str
    type: str
    doc_id: str | None
    #: Whether the job changes its document (only one such job per document).
    changes_document: bool
    status: JobStatus = "queued"
    progress: float = 0.0
    message: str = ""
    result: dict[str, Any] | None = None
    error: dict[str, Any] | None = None
    created: float = field(default_factory=time.monotonic)
    finished: float | None = None
    cancel_requested: threading.Event = field(default_factory=threading.Event)

    def snapshot(self) -> dict[str, Any]:
        data: dict[str, Any] = {
            "jobId": self.id,
            "type": self.type,
            "docId": self.doc_id,
            "status": self.status,
            "progress": round(self.progress, 4),
            "message": self.message,
        }
        if self.result is not None:
            data["result"] = self.result
        if self.error is not None:
            data["error"] = self.error
        return data


class JobContext:
    """What a running job uses to report progress and notice cancellation."""

    def __init__(self, job: Job, session: Session | None, lock: threading.Lock) -> None:
        self._job = job
        self._lock = lock
        #: The job's document, if it has one.
        self.session = session

    @property
    def cancelled(self) -> bool:
        return self._job.cancel_requested.is_set()

    def check(self) -> None:
        """Raises ``JobCancelled`` if the job should stop."""
        if self.cancelled:
            raise JobCancelled()

    def progress(self, fraction: float, message: str | None = None) -> None:
        """Reports progress (0..1; never moves backwards) and the current step."""
        with self._lock:
            job = self._job
            job.progress = max(job.progress, min(1.0, max(0.0, fraction)))
            if message is not None:
                job.message = message


JobRun = Callable[[JobContext, Any], dict[str, Any]]
JobPrepare = Callable[[Session | None, Any], Any]


@dataclass(frozen=True)
class JobType:
    name: str
    params: type[BaseModel]
    run: JobRun
    prepare: JobPrepare | None = None
    #: "required", "none" (the job never has a document) or "optional".
    document: Literal["required", "none", "optional"] = "required"
    changes_document: bool = False


class JobRegistry:
    """The engine's jobs, by id. Thread-safe."""

    def __init__(self, sessions: SessionRegistry) -> None:
        self._sessions = sessions
        self._types: dict[str, JobType] = {}
        self._jobs: dict[str, Job] = {}
        self._lock = threading.Lock()
        sessions.on_remove.append(lambda session: self.cancel_for_document(session.id))

    def register(self, job_type: JobType) -> None:
        self._types[job_type.name] = job_type

    @property
    def types(self) -> list[str]:
        return sorted(self._types)

    def _prune(self, now: float) -> None:
        for job_id, job in list(self._jobs.items()):
            if job.finished is not None and now - job.finished > KEEP_FINISHED_SECONDS:
                del self._jobs[job_id]

    def start(self, type_name: str, doc_id: str | None, raw_params: dict[str, Any]) -> Job:
        job_type = self._types.get(type_name)
        if job_type is None:
            raise BadRequestError(f"Unknown job type '{type_name}'.")
        try:
            params = job_type.params.model_validate(raw_params or {})
        except ValidationError as exc:
            parts = []
            for err in exc.errors():
                location = ".".join(str(item) for item in err.get("loc", ()))
                parts.append(f"{location}: {err.get('msg', 'invalid value')}")
            raise EngineError(
                "invalid_request", "; ".join(parts) or "Invalid parameters.", 422
            ) from None

        session: Session | None = None
        if job_type.document == "required" and not doc_id:
            raise BadRequestError(f"A '{type_name}' job needs a docId.")
        if job_type.document == "none" and doc_id:
            raise BadRequestError(f"A '{type_name}' job does not take a docId.")
        if doc_id:
            session = self._sessions.get(doc_id)

        with self._lock:
            self._prune(time.monotonic())
            if job_type.changes_document and session is not None:
                for other in self._jobs.values():
                    if (
                        other.doc_id == session.id
                        and other.changes_document
                        and other.status not in FINISHED
                    ):
                        raise JobConflictError(
                            "Another job is already changing this document. Wait for it to "
                            "finish or cancel it."
                        )

        plan = job_type.prepare(session, params) if job_type.prepare else params

        job = Job(
            id=uuid.uuid4().hex,
            type=type_name,
            doc_id=session.id if session else None,
            changes_document=job_type.changes_document,
        )
        with self._lock:
            self._jobs[job.id] = job
        context = JobContext(job, session, self._lock)
        thread = threading.Thread(
            target=self._run,
            args=(job, job_type, context, plan),
            name=f"job-{type_name}",
            daemon=True,
        )
        thread.start()
        return job

    def _finish(self, job: Job, status: JobStatus, **fields: Any) -> None:
        with self._lock:
            job.status = status
            for key, value in fields.items():
                setattr(job, key, value)
            job.finished = time.monotonic()

    def _run(self, job: Job, job_type: JobType, context: JobContext, plan: Any) -> None:
        with self._lock:
            if job.cancel_requested.is_set():
                job.status = "cancelled"
                job.finished = time.monotonic()
                return
            job.status = "running"
        try:
            result = job_type.run(context, plan)
        except JobCancelled:
            self._finish(job, "cancelled", message="Cancelled")
        except EngineError as exc:
            if job.cancel_requested.is_set():
                self._finish(job, "cancelled", message="Cancelled")
            else:
                self._finish(
                    job, "failed", error={**exc.details, "code": exc.code, "message": exc.message}
                )
        except Exception as exc:
            if job.cancel_requested.is_set():
                self._finish(job, "cancelled", message="Cancelled")
            else:
                logger.exception("Job %s (%s) failed", job.id, job.type, exc_info=exc)
                self._finish(
                    job,
                    "failed",
                    error={"code": "internal_error", "message": f"The job failed: {exc}"},
                )
        else:
            self._finish(job, "done", progress=1.0, result=result, message="Done")

    def get(self, job_id: str) -> Job:
        with self._lock:
            job = self._jobs.get(job_id)
        if job is None:
            raise NotFoundError(f"No job with id '{job_id}'.")
        return job

    def snapshot(self, job_id: str) -> dict[str, Any]:
        job = self.get(job_id)
        with self._lock:
            return job.snapshot()

    def cancel(self, job_id: str) -> Job:
        job = self.get(job_id)
        job.cancel_requested.set()
        return job

    def cancel_for_document(self, doc_id: str) -> None:
        """Cancels the jobs of a document that is being closed."""
        with self._lock:
            jobs = [job for job in self._jobs.values() if job.doc_id == doc_id]
        for job in jobs:
            job.cancel_requested.set()

    def cancel_all(self) -> None:
        with self._lock:
            jobs = list(self._jobs.values())
        for job in jobs:
            job.cancel_requested.set()

    def wait(self, job_id: str, timeout: float = 60.0) -> dict[str, Any]:
        """Waits for a job to finish and returns its snapshot (for tests)."""
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            snapshot = self.snapshot(job_id)
            if snapshot["status"] in FINISHED:
                return snapshot
            time.sleep(0.02)
        raise TimeoutError(f"Job {job_id} did not finish within {timeout} s.")
