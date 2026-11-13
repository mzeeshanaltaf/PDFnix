"""Save and Save As.

A save writes a complete, compacted file to a temporary name in the
destination folder and then replaces the target with it in one step
(``os.replace``), so the target is either the old file or the new one, never a
half-written mix. On any failure the temporary file is removed and the target
is untouched.

Compacting (``garbage=3``) renumbers objects, and doing that to the working
document would break its undo journal and change annotation ids. So the
working document is serialised as it is (``History.serialise``, which also
repairs what any write does to the journal), reopened as a throwaway copy, and
the copy is compacted and written. ``PDF_ENCRYPT_KEEP`` keeps an encrypted file's
encryption, passwords and permissions; PyMuPDF's default would remove them.

Incremental saves are not used: later features (redaction, encryption changes)
cannot be saved incrementally, and one code path is simpler.
"""

import contextlib
import errno
import os
import stat
import tempfile
from collections.abc import Callable
from typing import Any

import pymupdf

from .errors import BadRequestError, EngineError, SaveError
from .sessions import Session

# Windows error numbers.
_ERROR_SHARING_VIOLATION = 32
_ERROR_LOCK_VIOLATION = 33
_ERROR_HANDLE_DISK_FULL = 39
_ERROR_DISK_FULL = 112


def _is_read_only(path: str) -> bool:
    try:
        info = os.stat(path)
    except OSError:
        return False
    attributes = getattr(info, "st_file_attributes", 0)
    if attributes & getattr(stat, "FILE_ATTRIBUTE_READONLY", 0):
        return True
    return not info.st_mode & stat.S_IWRITE


def _disk_full(exc: OSError) -> bool:
    return exc.errno == errno.ENOSPC or getattr(exc, "winerror", None) in (
        _ERROR_DISK_FULL,
        _ERROR_HANDLE_DISK_FULL,
    )


def _explain(exc: OSError, target: str, stage: str) -> SaveError:
    """Turns an OS error from ``stage`` ("write" or "replace") into a SaveError."""
    name = os.path.basename(target)
    if _disk_full(exc):
        return SaveError("disk_full", f"There is not enough disk space to save {name}.")
    if isinstance(exc, PermissionError):
        if stage == "write":
            return SaveError(
                "folder_not_writable",
                f"PDFnix cannot write to the folder {os.path.dirname(target)}.",
            )
        if _is_read_only(target):
            return SaveError("file_read_only", f"{name} is read-only.")
        return SaveError(
            "file_locked",
            f"{name} is open in another program, which is preventing changes. "
            "Close it there and save again, or use Save As.",
        )
    if getattr(exc, "winerror", None) in (_ERROR_SHARING_VIOLATION, _ERROR_LOCK_VIOLATION):
        return SaveError("file_locked", f"{name} is open in another program.")
    reason = exc.strerror or type(exc).__name__
    return SaveError("save_failed", f"{name} could not be saved ({reason}).")


def open_copy(session: Session, data: bytes | None = None) -> pymupdf.Document:
    """A throwaway copy of the working document (from ``data``, its serialised
    bytes, when given), authenticated, without a journal. Call with the lock
    held."""
    if data is None:
        data = session.history.serialise()
    copy = pymupdf.open(stream=data, filetype="pdf")
    if copy.needs_pass and not copy.authenticate(session.password or ""):
        copy.close()
        raise SaveError("save_failed", "The document's encryption could not be kept.")
    return copy


def write_document(doc: pymupdf.Document, target: str) -> int:
    """Writes ``doc`` (a throwaway document, never a working one) to
    ``target`` atomically, compacted, keeping its encryption. Returns the file
    size."""
    return _write_atomically(
        target,
        lambda temp: doc.save(temp, garbage=3, deflate=True, encryption=pymupdf.PDF_ENCRYPT_KEEP),
    )


def write_pdf(session: Session, target: str) -> int:
    """Writes the document to ``target`` atomically. Returns the file size."""

    def write(temp: str) -> None:
        with session.lock:
            copy = open_copy(session)
            try:
                copy.save(temp, garbage=3, deflate=True, encryption=pymupdf.PDF_ENCRYPT_KEEP)
            finally:
                copy.close()

    return _write_atomically(target, write)


def check_target(target: str) -> None:
    """Raises if a file cannot be written at ``target``."""
    folder = os.path.dirname(target) or "."
    if not os.path.isdir(folder):
        raise SaveError("folder_not_found", f"The folder does not exist: {folder}")
    if os.path.isdir(target):
        raise BadRequestError(f"{target} is a folder.")
    if os.path.exists(target) and _is_read_only(target):
        raise SaveError("file_read_only", f"{os.path.basename(target)} is read-only.")


def _write_atomically(target: str, write: Callable[[str], None]) -> int:
    """Calls ``write(temp)`` for a temporary file next to ``target``, then
    puts it in place. Returns the file size."""
    folder = os.path.dirname(target) or "."
    check_target(target)

    try:
        handle, temp = tempfile.mkstemp(
            prefix=f".{os.path.basename(target)}.", suffix=".pdfnix-tmp", dir=folder
        )
        os.close(handle)
    except OSError as exc:
        raise _explain(exc, target, "write") from None

    try:
        write(temp)
        size = os.path.getsize(temp)
        try:
            os.replace(temp, target)
        except OSError as exc:
            raise _explain(exc, target, "replace") from None
        return size
    except EngineError:
        raise
    except OSError as exc:
        raise _explain(exc, target, "write") from None
    except Exception as exc:
        # MuPDF reports write failures (disk full and the like) as its own errors.
        raise SaveError(
            "save_failed", f"{os.path.basename(target)} could not be saved ({exc})."
        ) from None
    finally:
        with contextlib.suppress(OSError):
            os.remove(temp)


def save_session(session: Session, path: str | None) -> dict[str, Any]:
    """Save (``path`` None) or Save As. Returns the new path and state.

    The lock is held throughout, so the file holds exactly the state that is
    then marked as saved.
    """
    target = os.path.abspath(path) if path else session.path
    with session.lock:
        session.file_size = write_pdf(session, target)
        session.path = target
        session.history.mark_saved()
        return {
            "path": session.path,
            "fileName": os.path.basename(session.path),
            **session.state(),
        }
