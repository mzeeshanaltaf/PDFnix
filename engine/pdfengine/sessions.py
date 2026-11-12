"""Registry of open documents.

Each open tab in the app is one session holding a PyMuPDF ``Document`` as a
working copy. Phase 1 only provides the empty registry; opening, closing and
the session object itself arrive in phase 2.
"""

import threading
from typing import Any

from .errors import NotFoundError


class SessionRegistry:
    """Thread-safe map of session id to session."""

    def __init__(self) -> None:
        self._sessions: dict[str, Any] = {}
        self._lock = threading.RLock()

    def __len__(self) -> int:
        with self._lock:
            return len(self._sessions)

    def __contains__(self, session_id: object) -> bool:
        with self._lock:
            return session_id in self._sessions

    def add(self, session_id: str, session: Any) -> None:
        with self._lock:
            self._sessions[session_id] = session

    def get(self, session_id: str) -> Any:
        with self._lock:
            try:
                return self._sessions[session_id]
            except KeyError:
                raise NotFoundError(f"No open document with id '{session_id}'.") from None

    def remove(self, session_id: str) -> Any:
        with self._lock:
            try:
                return self._sessions.pop(session_id)
            except KeyError:
                raise NotFoundError(f"No open document with id '{session_id}'.") from None

    def ids(self) -> list[str]:
        with self._lock:
            return list(self._sessions)
