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
import time
import uuid
from collections.abc import Iterator
from contextlib import contextmanager
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
from .history import History, Step
from .textpages import has_text

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
        #: Kept so a compacted copy can be opened when saving.
        self.password = password
        #: Increases with every change to the document, including undo and redo.
        self.revision = 0
        self._doc: pymupdf.Document | None = doc
        self.history = History(doc)
        #: When the oldest change not yet in a recovery copy was made
        #: (``time.monotonic``), or None. Maintained with ``recovered_revision``
        #: by ``recovery.py``.
        self.unrecovered_since: float | None = None
        #: The revision the current recovery copy holds, or None if there is none.
        self.recovered_revision: int | None = None

    @property
    def lock(self) -> threading.RLock:
        return MUPDF_LOCK

    @property
    def closed(self) -> bool:
        return self._doc is None

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
                if has_text(doc[index]):
                    return True
        return False

    @contextmanager
    def edit(self, name: str) -> Iterator[Step]:
        """Holds the lock and records the changes made in the block as one
        undoable step named ``name`` ("Highlight", "Rotate"…). Add the pages
        the change touches to the yielded step's ``pages``, then return
        ``mutated(step.pages)``.

        Validate input *before* the block where possible: a change that fails
        half way is undone, but costs the user their redo steps.
        """
        with self.lock, self.history.operation(name) as step:
            yield step

    def state(self) -> dict[str, Any]:
        """Revision and undo/redo state."""
        with self.lock:
            return {"revision": self.revision, **self.history.state()}

    def mutated(
        self, dirty_pages: set[int] | list[int], *, structure: bool = False
    ) -> dict[str, Any]:
        """Records a change and returns the standard mutation response:
        ``revision``, ``dirtyPages``, ``pageCount``, ``pages`` (size and
        rotation of each dirty page), ``structure`` and the undo/redo state.

        ``structure`` means pages were reordered, added or removed: every page
        is then dirty and ``pages`` lists all of them."""
        with self.lock:
            self.revision += 1
            if self.unrecovered_since is None:
                self.unrecovered_since = time.monotonic()
            doc = self.doc
            if structure:
                dirty = list(range(doc.page_count))
            else:
                dirty = sorted(index for index in set(dirty_pages) if 0 <= index < doc.page_count)
            return {
                "revision": self.revision,
                "dirtyPages": dirty,
                "pageCount": doc.page_count,
                "pages": [{"index": index, **page_info(doc[index])} for index in dirty],
                "structure": structure,
                **self.history.state(),
            }

    def unchanged(self) -> dict[str, Any]:
        """The mutation response for a request that changed nothing."""
        with self.lock:
            return {
                "revision": self.revision,
                "dirtyPages": [],
                "pageCount": self.page_count,
                "pages": [],
                "structure": False,
                **self.history.state(),
            }

    def describe(self) -> dict[str, Any]:
        """What the app needs to show a freshly opened document."""
        with self.lock:
            metadata = self.doc.metadata or {}
            return {
                "docId": self.id,
                "path": self.path,
                "fileName": os.path.basename(self.path),
                "pageCount": self.page_count,
                "pages": self.page_infos(),
                "title": str(metadata.get("title") or "").strip(),
                "isEncrypted": self.encrypted,
                "hasTextLayer": self.has_text_layer(),
                **self.state(),
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
    return open_bytes(data, path, password)


def open_bytes(data: bytes, path: str, password: str | None = None) -> Session:
    """Opens PDF ``data`` as a session for the file at ``path``."""
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

    def values(self) -> list[Session]:
        with self._lock:
            return list(self._sessions.values())

    def close_all(self) -> None:
        with self._lock:
            sessions = list(self._sessions.values())
            self._sessions.clear()
        for session in sessions:
            session.close()
