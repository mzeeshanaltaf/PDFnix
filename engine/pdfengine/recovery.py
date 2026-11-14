"""Recovery copies of documents with unsaved changes.

While a document has unsaved changes, a copy of it is kept in the recovery
folder (``PDFENGINE_RECOVERY_DIR``, in the app's data folder): written once a
change has gone ``delay`` seconds (two minutes) without being in a copy, when
the app's window reloads, and when the engine shuts down or loses its owner.
The copy is deleted when the document is saved, closed, or undone back to its
saved state.

Each copy is two files named after the session id: ``<id>.pdf`` (the document,
encrypted as the original was) and ``<id>.json`` (where it came from). Copies
whose session is not open in this engine are offered to the user, who can
restore or discard them.

Lock order: the store's lock first, then the session lock, never the other way
round.
"""

import contextlib
import json
import logging
import os
import threading
import time
from datetime import UTC, datetime
from typing import Any

from .errors import NotFoundError
from .security import recovery_bytes
from .sessions import Session, SessionRegistry, open_bytes

logger = logging.getLogger("pdfengine")

RECOVERY_DELAY = 120.0
TICK_SECONDS = 5.0
_FORMAT = 1


def _write_atomic(path: str, data: bytes) -> None:
    temp = f"{path}.tmp"
    with open(temp, "wb") as handle:
        handle.write(data)
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(temp, path)


class RecoveryStore:
    def __init__(
        self,
        folder: str | None,
        sessions: SessionRegistry,
        *,
        delay: float = RECOVERY_DELAY,
        tick: float = TICK_SECONDS,
    ) -> None:
        self.folder = folder
        self.sessions = sessions
        self.delay = delay
        self.tick_seconds = tick
        self._lock = threading.RLock()
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None

    @property
    def enabled(self) -> bool:
        return self.folder is not None

    def _paths(self, recovery_id: str) -> tuple[str, str]:
        assert self.folder is not None
        if not recovery_id.isalnum():
            raise NotFoundError(f"No recovery copy '{recovery_id}'.")
        base = os.path.join(self.folder, recovery_id)
        return f"{base}.pdf", f"{base}.json"

    # Writing ----------------------------------------------------------------

    def write(self, session: Session) -> bool:
        """Brings the session's copy up to date. Returns True if one was written."""
        if not self.enabled:
            return False
        with self._lock:
            with session.lock:
                if session.closed:
                    return False
                if not session.modified:
                    self._discard_locked(session)
                    return False
                if session.recovered_revision == session.revision:
                    return False
                # Encrypted as the document will be saved (a pending password
                # change included), so the copy is never less protected.
                data, encrypted = recovery_bytes(session)
                revision = session.revision
                meta = {
                    "format": _FORMAT,
                    "originalPath": session.path,
                    "fileName": os.path.basename(session.path),
                    "encrypted": encrypted,
                    "pageCount": session.page_count,
                    "writtenAt": datetime.now(UTC).isoformat(),
                }
            pdf_path, json_path = self._paths(session.id)
            try:
                os.makedirs(self.folder, exist_ok=True)  # type: ignore[arg-type]
                _write_atomic(pdf_path, data)
                _write_atomic(json_path, json.dumps(meta).encode("utf-8"))
            except OSError:
                logger.exception("Could not write the recovery copy of %s", session.path)
                return False
            with session.lock:
                session.recovered_revision = revision
                if session.revision == revision:
                    session.unrecovered_since = None
            return True

    def _discard_locked(self, session: Session) -> None:
        self._remove(session.id)
        session.recovered_revision = None
        session.unrecovered_since = None

    def _remove(self, recovery_id: str) -> None:
        for path in self._paths(recovery_id):
            with contextlib.suppress(FileNotFoundError):
                os.remove(path)

    def discard_session(self, session: Session) -> None:
        """The document was saved or closed: its copy is no longer needed."""
        if not self.enabled:
            return
        with self._lock:
            try:
                self._remove(session.id)
            except OSError:
                logger.exception("Could not delete the recovery copy of %s", session.path)
            with session.lock:
                session.recovered_revision = None
                session.unrecovered_since = None

    def tick(self, now: float | None = None) -> None:
        """Writes the copies that are due and drops those no longer needed."""
        if not self.enabled:
            return
        now = time.monotonic() if now is None else now
        for session in self.sessions.values():
            with session.lock:
                if session.closed:
                    continue
                modified = session.modified
                due = (
                    modified
                    and session.recovered_revision != session.revision
                    and session.unrecovered_since is not None
                    and now - session.unrecovered_since >= self.delay
                )
                stale = not modified and session.recovered_revision is not None
            if due or stale:
                self.write(session)

    def flush(self) -> None:
        """Writes every copy that is out of date, now."""
        if not self.enabled:
            return
        for session in self.sessions.values():
            try:
                self.write(session)
            except Exception:
                logger.exception("Could not write the recovery copy of %s", session.path)

    # Background writer --------------------------------------------------------

    def start(self) -> None:
        if not self.enabled or self._thread is not None:
            return
        self._stop.clear()

        def run() -> None:
            while not self._stop.wait(self.tick_seconds):
                try:
                    self.tick()
                except Exception:
                    logger.exception("Recovery writer failed")

        self._thread = threading.Thread(target=run, name="recovery-writer", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        thread, self._thread = self._thread, None
        if thread is not None:
            thread.join(timeout=10)

    # Offering copies -----------------------------------------------------------

    def entries(self) -> list[dict[str, Any]]:
        """Copies that do not belong to a document open in this engine, newest first."""
        if not self.enabled or not os.path.isdir(self.folder):  # type: ignore[arg-type]
            return []
        open_ids = set(self.sessions.ids())
        result: list[dict[str, Any]] = []
        with self._lock:
            for name in os.listdir(self.folder):
                recovery_id, extension = os.path.splitext(name)
                if extension != ".json" or recovery_id in open_ids or not recovery_id.isalnum():
                    continue
                pdf_path, json_path = self._paths(recovery_id)
                try:
                    with open(json_path, encoding="utf-8") as handle:
                        meta = json.load(handle)
                    size = os.path.getsize(pdf_path)
                except (OSError, ValueError):
                    continue
                result.append(
                    {
                        "recoveryId": recovery_id,
                        "originalPath": str(meta.get("originalPath") or ""),
                        "fileName": str(meta.get("fileName") or ""),
                        "isEncrypted": bool(meta.get("encrypted")),
                        "pageCount": meta.get("pageCount"),
                        "writtenAt": meta.get("writtenAt"),
                        "size": size,
                    }
                )
        result.sort(key=lambda entry: entry["writtenAt"] or "", reverse=True)
        return result

    def restore(self, recovery_id: str, password: str | None) -> Session:
        """Opens a copy as a document with unsaved changes. The copy then
        belongs to the new session (it is not deleted until saved or closed)."""
        if not self.enabled:
            raise NotFoundError("Recovery is not available.")
        with self._lock:
            pdf_path, json_path = self._paths(recovery_id)
            try:
                with open(json_path, encoding="utf-8") as handle:
                    meta = json.load(handle)
                with open(pdf_path, "rb") as handle:
                    data = handle.read()
            except (OSError, ValueError):
                raise NotFoundError(f"No recovery copy '{recovery_id}'.") from None

            session = open_bytes(data, str(meta.get("originalPath") or pdf_path), password)
            new_pdf, new_json = self._paths(session.id)
            os.replace(pdf_path, new_pdf)
            os.replace(json_path, new_json)
            with session.lock:
                session.history.mark_unsaved()
                session.recovered_revision = session.revision
            return session

    def discard(self, recovery_id: str) -> None:
        if not self.enabled:
            return
        if recovery_id in self.sessions:
            raise NotFoundError(f"No recovery copy '{recovery_id}'.")
        with self._lock:
            self._remove(recovery_id)
