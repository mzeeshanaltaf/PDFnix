"""Password protection: set, change or remove it, applied when the document is
next saved.

| Endpoint | Purpose |
|---|---|
| ``POST /v1/docs/{id}/security`` | Set protection, applied on save |
| ``DELETE /v1/docs/{id}/security`` | Remove protection on save |
| ``GET /v1/docs/{id}/security`` | Current and pending state |

Encryption is AES-256. The "password to open" (user password) encrypts the
file; the "password to change permissions" (owner password) guards the
permission flags, which PDF readers honour by convention only. If only an open
password is given, the owner password is the same. If only an owner password is
given, the file opens without a password but carries the restrictions.

Setting and removing answer like any change (the standard mutation fields,
no dirty pages) plus the security state. Changing or removing the protection
of a file that is protected needs owner rights: the document was opened with
its owner password, or the request carries it (``currentPassword``).
Passwords live only in the session's memory: never logged, never written to
settings. A recovery copy is encrypted the way
the document will be saved (``recovery_bytes``), so it is never less protected
than the file.

The working document keeps its original encryption in memory; the new
protection is written by every save from the moment it is set
(``Session.protection``). Setting or removing protection is not an undo step;
it marks the document modified until saved.
"""

from dataclasses import dataclass
from typing import TYPE_CHECKING, Any, Literal

import pymupdf

from .errors import BadRequestError, EngineError

if TYPE_CHECKING:
    from .sessions import Session

#: Permission names used by the API, and the PDF permission bits each allows.
PERMISSION_BITS: dict[str, int] = {
    "print": pymupdf.PDF_PERM_PRINT | pymupdf.PDF_PERM_PRINT_HQ,
    "copy": pymupdf.PDF_PERM_COPY,
    "modify": pymupdf.PDF_PERM_MODIFY | pymupdf.PDF_PERM_ASSEMBLE,
    "annotate": pymupdf.PDF_PERM_ANNOTATE,
    "fillForms": pymupdf.PDF_PERM_FORM,
}

#: Screen readers may always extract text.
ALWAYS_ALLOWED = pymupdf.PDF_PERM_ACCESSIBILITY

REMOVE: Literal["remove"] = "remove"


class OwnerPasswordRequired(EngineError):
    def __init__(self, wrong: bool = False) -> None:
        message = (
            "That is not the document's owner password."
            if wrong
            else "Changing this document's protection needs its owner password "
            "(the password to change permissions)."
        )
        super().__init__("owner_password_required", message, 403)
        self.details = {"wrong": wrong}


@dataclass(frozen=True)
class Protection:
    """Protection to write on save."""

    user_password: str
    owner_password: str
    permissions: int

    def __repr__(self) -> str:  # never show passwords
        return (
            f"Protection(permissions={self.permissions}, open_password={bool(self.user_password)})"
        )


def permission_value(permissions: dict[str, bool]) -> int:
    value = ALWAYS_ALLOWED
    for name, bits in PERMISSION_BITS.items():
        if permissions.get(name, True):
            value |= bits
    return value


def permission_flags(value: int) -> dict[str, bool]:
    """The API's permission names for a PDF permission value. A permission
    with two bits (print, modify) counts as allowed if its main bit is set."""
    return {
        "print": bool(value & pymupdf.PDF_PERM_PRINT),
        "copy": bool(value & pymupdf.PDF_PERM_COPY),
        "modify": bool(value & pymupdf.PDF_PERM_MODIFY),
        "annotate": bool(value & pymupdf.PDF_PERM_ANNOTATE),
        "fillForms": bool(value & pymupdf.PDF_PERM_FORM),
    }


def _declared_permissions(doc: pymupdf.Document) -> int | None:
    """The ``/P`` value of the document's encryption dictionary (what the
    file restricts, whichever password it was opened with), or None."""
    kind, value = doc.xref_get_key(-1, "Encrypt/P")
    if kind != "int":
        return None
    return int(value) & 0xFFFFFFFF


def file_security(doc: pymupdf.Document, opened_with_password: bool) -> dict[str, Any]:
    """What a document's own encryption is (call with the lock held)."""
    method = (doc.metadata or {}).get("encryption") or None
    permissions = _declared_permissions(doc) if method else None
    return {
        "encrypted": bool(method),
        "method": method,
        "hasOpenPassword": bool(method) and opened_with_password,
        "permissions": permission_flags(permissions) if permissions is not None else None,
    }


def _describe(target: Any) -> dict[str, Any]:
    if target == REMOVE:
        return {"encrypted": False, "method": None, "hasOpenPassword": False, "permissions": None}
    return {
        "encrypted": True,
        "method": "AES-256",
        "hasOpenPassword": bool(target.user_password),
        "permissions": permission_flags(target.permissions),
    }


def _file_is_encrypted(session: "Session") -> bool:
    if session.saved_protection is not None:
        return session.saved_protection != REMOVE
    return bool((session.doc.metadata or {}).get("encryption"))


def security_state(session: "Session") -> dict[str, Any]:
    """``GET /security``: what the file has, what the next save writes, and
    whether the user may change it without the owner password."""
    with session.lock:
        saved = session.saved_protection
        current = (
            _describe(saved) if saved is not None else file_security(session.doc, session.encrypted)
        )
        pending = None
        if session.protection_pending:
            if session.protection == REMOVE:
                pending = {"action": "remove"}
            else:
                pending = {"action": "set", **_describe(session.protection)}
        return {
            "current": current,
            "pending": pending,
            "ownerAccess": session.owner_access,
            **session.undo_state(),
            "revision": session.revision,
        }


def _check_owner(session: "Session", current_password: str | None) -> None:
    """Owner rights are needed to change the protection of a protected file."""
    if session.owner_access or not _file_is_encrypted(session):
        return
    if not current_password:
        raise OwnerPasswordRequired()
    data = session.history.serialise()
    copy = pymupdf.open(stream=data, filetype="pdf")
    try:
        level = copy.authenticate(current_password)
    finally:
        copy.close()
    if not level & 4:
        raise OwnerPasswordRequired(wrong=True)
    session.owner_access = True


def set_protection(
    session: "Session",
    *,
    user_password: str | None,
    owner_password: str | None,
    permissions: dict[str, bool],
    current_password: str | None = None,
) -> dict[str, Any]:
    user = user_password or ""
    owner = owner_password or ""
    if not user and not owner:
        raise BadRequestError("Enter a password to open the file or to change its permissions.")
    if not owner:
        owner = user
    unknown = set(permissions) - set(PERMISSION_BITS)
    if unknown:
        raise BadRequestError(f"Unknown permission '{sorted(unknown)[0]}'.")
    with session.lock:
        _check_owner(session, current_password)
        session.protection = Protection(user, owner, permission_value(permissions))
        session.protection_pending = True
        return {**session.mutated([]), **security_state(session)}


def remove_protection(session: "Session", current_password: str | None = None) -> dict[str, Any]:
    with session.lock:
        if not _file_is_encrypted(session):
            if not session.protection_pending:
                raise BadRequestError("The document is not protected.")
            # Only an unsaved protection to take back.
            session.protection = session.saved_protection
            session.protection_pending = False
            return {**session.mutated([]), **security_state(session)}
        _check_owner(session, current_password)
        session.protection = REMOVE
        session.protection_pending = True
        return {**session.mutated([]), **security_state(session)}


def encryption_options(session: "Session") -> dict[str, Any]:
    """``Document.save`` options for the protection the next save writes."""
    target = session.protection
    if target is None:
        return {"encryption": pymupdf.PDF_ENCRYPT_KEEP}
    if target == REMOVE:
        return {"encryption": pymupdf.PDF_ENCRYPT_NONE}
    return {
        "encryption": pymupdf.PDF_ENCRYPT_AES_256,
        "user_pw": target.user_password,
        "owner_pw": target.owner_password,
        "permissions": target.permissions,
    }


def saved(session: "Session") -> None:
    """Called after a successful save (lock held): the file now has the
    target protection."""
    if session.protection is not None:
        session.saved_protection = session.protection
        # The passwords in force were set in this session.
        session.owner_access = True
    session.protection_pending = False


def recovery_bytes(session: "Session") -> tuple[bytes, bool]:
    """The document for a recovery copy, encrypted as it will be saved, and
    whether opening it needs a password. Call with the lock held."""
    target = session.protection
    if target is None:
        return session.history.serialise(), session.encrypted
    from .save import open_copy

    copy = open_copy(session)
    try:
        data = copy.tobytes(**encryption_options(session))
    finally:
        copy.close()
    return data, target != REMOVE and bool(target.user_password)
