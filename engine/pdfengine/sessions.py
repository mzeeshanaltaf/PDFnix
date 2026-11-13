"""Open documents.

Each open tab in the app is one session holding a PyMuPDF ``Document`` as a
working copy. The document is opened from an in-memory copy of the file, so
the file on disk is never locked and can be overwritten when saving.

Locking: PyMuPDF is not safe to call from several threads, not even on
different documents, and it holds the GIL while it works, so threads would not
run in parallel anyway. All PyMuPDF access therefore goes through one
process-wide lock, ``MUPDF_LOCK``, reachable as ``Session.lock``.
"""

import os
import threading
import uuid
from typing import Any

import pymupdf

from .errors import (
    FileNotFound,
    FileUnreadableError,
    InvalidPdfError,
    NotFoundError,
    PasswordIncorrectError,
    PasswordRequiredError,
)

MUPDF_LOCK = threading.RLock()

# How many leading pages are examined to decide whether a document has text.
TEXT_PROBE_PAGES = 50


def page_info(page: pymupdf.Page) -> dict[str, float | int]:
    """Size (points, as displayed) and rotation of a page."""
    rect = page.rect
    return {
        "width": round(rect.width, 3),
        "height": round(rect.height, 3),
        "rotation": page.rotation,
    }


class Session:
    """One open document."""

    def __init__(
        self,
        path: str,
        doc: pymupdf.Document,
        *,
        file_size: int,
        encrypted: bool,
        password: str | None,
    ) -> None:
        self.id = uuid.uuid4().hex
        self.path = path
        self.file_size = file_size
        #: True if the file needed a password to open.
        self.encrypted = encrypted
        #: Kept so a later save can preserve the encryption (phase 3).
        self.password = password
        #: Increases with every change to the document.
        self.revision = 0
        self._doc: pymupdf.Document | None = doc

    @property
    def lock(self) -> threading.RLock:
        return MUPDF_LOCK

    @property
    def doc(self) -> pymupdf.Document:
        """The document. Call with ``lock`` held."""
        if self._doc is None:
            raise NotFoundError(f"The document '{self.id}' has been closed.")
        return self._doc

    @property
    def page_count(self) -> int:
        return self.doc.page_count

    def page(self, index: int) -> pymupdf.Page:
        """Page by 0-based index. Call with ``lock`` held."""
        doc = self.doc
        if not 0 <= index < doc.page_count:
            raise NotFoundError(f"Page index {index} is out of range (0 to {doc.page_count - 1}).")
        return doc[index]

    def page_infos(self) -> list[dict[str, float | int]]:
        with self.lock:
            return [page_info(page) for page in self.doc]

    def has_text_layer(self) -> bool:
        """Whether any of the first pages carries extractable text."""
        with self.lock:
            doc = self.doc
            for index in range(min(doc.page_count, TEXT_PROBE_PAGES)):
                if doc[index].get_text("text").strip():
                    return True
        return False

    def mutated(self, dirty_pages: list[int]) -> dict[str, Any]:
        """Records a change and returns the standard mutation response."""
        with self.lock:
            self.revision += 1
            return {
                "revision": self.revision,
                "dirtyPages": sorted(set(dirty_pages)),
                "pageCount": self.doc.page_count,
            }

    def close(self) -> None:
        with self.lock:
            doc, self._doc = self._doc, None
            if doc is not None:
                doc.close()


def open_session(path: str, password: str | None = None) -> Session:
    """Opens the PDF at ``path`` as a working copy held in memory."""
    try:
        with open(path, "rb") as handle:
            data = handle.read()
    except FileNotFoundError:
        raise FileNotFound(path) from None
    except IsADirectoryError:
        raise FileNotFound(path) from None
    except OSError as exc:
        # On Windows, opening a directory raises PermissionError.
        if os.path.isdir(path):
            raise FileNotFound(path) from None
        raise FileUnreadableError(path, exc.strerror or type(exc).__name__) from None

    with MUPDF_LOCK:
        try:
            doc = pymupdf.open(stream=data, filetype="pdf")
        except pymupdf.EmptyFileError:
            raise InvalidPdfError("The file is empty.") from None
        except Exception:
            raise InvalidPdfError() from None

        try:
            if not doc.is_pdf:
                raise InvalidPdfError()
            encrypted = bool(doc.needs_pass)
            if encrypted:
                if not password:
                    raise PasswordRequiredError()
                if not doc.authenticate(password):
                    raise PasswordIncorrectError()
            if doc.page_count < 1:
                raise InvalidPdfError("The document has no pages.")
        except Exception:
            doc.close()
            raise

        return Session(
            os.path.abspath(path),
            doc,
            file_size=len(data),
            encrypted=encrypted,
            password=password if encrypted else None,
        )


class SessionRegistry:
    """Thread-safe map of session id to session."""

    def __init__(self) -> None:
        self._sessions: dict[str, Session] = {}
        self._lock = threading.RLock()

    def __len__(self) -> int:
        with self._lock:
            return len(self._sessions)

    def __contains__(self, session_id: object) -> bool:
        with self._lock:
            return session_id in self._sessions

    def add(self, session: Session) -> None:
        with self._lock:
            self._sessions[session.id] = session

    def get(self, session_id: str) -> Session:
        with self._lock:
            try:
                return self._sessions[session_id]
            except KeyError:
                raise NotFoundError(f"No open document with id '{session_id}'.") from None

    def remove(self, session_id: str) -> Session:
        with self._lock:
            try:
                return self._sessions.pop(session_id)
            except KeyError:
                raise NotFoundError(f"No open document with id '{session_id}'.") from None

    def ids(self) -> list[str]:
        with self._lock:
            return list(self._sessions)

    def close_all(self) -> None:
        with self._lock:
            sessions = list(self._sessions.values())
            self._sessions.clear()
        for session in sessions:
            session.close()
