"""Page operations: rotate, reorder, delete, duplicate, insert blank pages,
insert another PDF, extract, split and merge.

In-document operations are undoable steps marked as ``structure`` changes
(except rotation): page indexes mean different pages afterwards, so the app
reloads every page. How each is done under the journal (see STATUS.md,
Verified facts):

- reorder and delete use ``Document.select`` (MuPDF's ``pdf_rearrange_pages``),
  which also keeps outline entries and links pointing at the right pages and
  drops those pointing at deleted ones;
- duplicate uses ``fullcopy_page``: a repeated index in ``select`` would make
  two page-tree entries share one page object (and so its annotations);
- blank pages and inserted PDFs go through ``compat.py``, because PyMuPDF's
  ``new_page`` and ``insert_pdf`` fail inside an operation.

Extract, split and merge write new files and leave the open document alone.
"""

import os
import re
from typing import Any, Literal

import pymupdf

from . import compat
from .errors import (
    BadRequestError,
    EngineError,
    FileNotFound,
    FileUnreadableError,
    InvalidPdfError,
    PasswordIncorrectError,
    PasswordRequiredError,
)
from .save import check_target, open_copy, write_document
from .sessions import Session

#: Blank pages that may be inserted in one go.
MAX_BLANK_PAGES = 1000
#: Largest page side PDF allows (points).
MAX_PAGE_SIDE = 14400

SplitMode = Literal["ranges", "every", "bookmarks"]


class FilesExistError(EngineError):
    """Files to be written exist already; the caller may retry with
    ``overwrite``."""

    def __init__(self, paths: list[str]) -> None:
        names = ", ".join(os.path.basename(path) for path in paths[:3])
        more = f" and {len(paths) - 3} more" if len(paths) > 3 else ""
        super().__init__("files_exist", f"These files exist already: {names}{more}.", 409)
        self.details = {"paths": paths}


# --- Helpers -----------------------------------------------------------------


def _check_indexes(session: Session, pages: list[int], what: str = "pages") -> list[int]:
    """Sorted unique page indexes, all in range."""
    if not pages:
        raise BadRequestError(f"No {what} were given.")
    count = session.page_count
    bad = [index for index in pages if not 0 <= index < count]
    if bad:
        raise BadRequestError(f"Page index {bad[0]} is out of range (0 to {count - 1}).")
    return sorted(set(pages))


def _structural(session: Session, name: str, change: Any) -> dict[str, Any]:
    """Runs ``change()`` as one undoable structural step."""
    with session.edit(name) as step:
        step.structure = True
        change()
        session.doc._reset_page_refs()
    return session.mutated([], structure=True)


def open_pdf(path: str, password: str | None = None) -> pymupdf.Document:
    """Opens a PDF file that is not a session (inserting, merging). Errors
    name the file in ``path``."""
    try:
        with open(path, "rb") as handle:
            data = handle.read()
    except FileNotFoundError:
        raise FileNotFound(path) from None
    except OSError as exc:
        if os.path.isdir(path):
            raise FileNotFound(path) from None
        raise FileUnreadableError(path, exc.strerror or type(exc).__name__) from None
    try:
        doc = pymupdf.open(stream=data, filetype="pdf")
    except Exception:
        raise InvalidPdfError(f"{os.path.basename(path)} is not a PDF or is damaged.").with_details(
            path=path
        ) from None
    try:
        if not doc.is_pdf or doc.page_count < 1:
            raise InvalidPdfError(f"{os.path.basename(path)} has no pages.").with_details(path=path)
        if doc.needs_pass:
            if not password:
                raise PasswordRequiredError().with_details(path=path)
            if not doc.authenticate(password):
                raise PasswordIncorrectError().with_details(path=path)
    except Exception:
        doc.close()
        raise
    return doc


def _pick(doc: pymupdf.Document, pages: list[int] | None, path: str) -> None:
    """Reduces ``doc`` (a throwaway document) to ``pages``, in that order."""
    if pages is None:
        return
    if not pages:
        raise BadRequestError(f"No pages of {os.path.basename(path)} were chosen.")
    bad = [index for index in pages if not 0 <= index < doc.page_count]
    if bad:
        raise BadRequestError(
            f"{os.path.basename(path)} has no page {bad[0] + 1} (it has {doc.page_count})."
        ).with_details(path=path)
    if list(pages) != list(range(doc.page_count)):
        doc.select(list(pages))


def _toc_entries(doc: pymupdf.Document, offset: int) -> list[list[Any]]:
    """``doc``'s outline with its pages moved down by ``offset``; entries
    without a target are dropped and levels repaired so the result is valid."""
    entries: list[list[Any]] = []
    level = 0
    for item_level, title, page in doc.get_toc(simple=True):
        if page < 1:
            continue
        item_level = min(item_level, level + 1)
        entries.append([item_level, title, page + offset])
        level = item_level
    return entries


# --- In-document operations ---------------------------------------------------


def rotate_pages(session: Session, pages: list[int] | None, degrees: int) -> dict[str, Any]:
    """Rotates pages by a multiple of 90 degrees (positive is clockwise).

    ``pages`` are 0-based indexes; ``None`` means every page. Returns the
    standard mutation response, whose ``pages`` carry the new sizes.
    """
    if degrees % 90 != 0:
        raise BadRequestError("Pages can only be rotated in steps of 90 degrees.")

    with session.lock:
        targets = sorted(set(pages)) if pages is not None else list(range(session.page_count))
        # Validate everything before changing anything.
        for index in targets:
            session.page(index)
        if degrees % 360 == 0 or not targets:
            return session.unchanged()

        with session.edit("Rotate") as step:
            for index in targets:
                page = session.page(index)
                page.set_rotation((page.rotation + degrees) % 360)
                step.pages.add(index)
        return session.mutated(step.pages)


def reorder_pages(session: Session, order: list[int]) -> dict[str, Any]:
    """Puts the pages in ``order``, a permutation of all page indexes."""
    with session.lock:
        count = session.page_count
        if sorted(order) != list(range(count)):
            raise BadRequestError(
                f"The new order must list every page index (0 to {count - 1}) exactly once."
            )
        if order == list(range(count)):
            return session.unchanged()
        return _structural(session, "Move Pages", lambda: session.doc.select(order))


def delete_pages(session: Session, pages: list[int]) -> dict[str, Any]:
    with session.lock:
        doomed = set(_check_indexes(session, pages))
        count = session.page_count
        if len(doomed) >= count:
            raise BadRequestError("A document must keep at least one page.")
        keep = [index for index in range(count) if index not in doomed]
        name = "Delete Page" if len(doomed) == 1 else "Delete Pages"
        return _structural(session, name, lambda: session.doc.select(keep))


def duplicate_pages(session: Session, pages: list[int]) -> dict[str, Any]:
    """Puts a full copy (content and annotations) after each page."""
    with session.lock:
        targets = _check_indexes(session, pages)
        doc = session.doc

        def change() -> None:
            # Last first, so the indexes still to do do not move.
            for index in reversed(targets):
                after = index + 1
                doc.fullcopy_page(index, after if after < doc.page_count else -1)

        name = "Duplicate Page" if len(targets) == 1 else "Duplicate Pages"
        return _structural(session, name, change)


def insert_blank_pages(
    session: Session,
    at: int,
    count: int = 1,
    width: float | None = None,
    height: float | None = None,
) -> dict[str, Any]:
    """Inserts ``count`` empty pages before index ``at`` (``pageCount``
    appends). The size defaults to that of the page at ``at`` (or the last
    page when appending), as displayed."""
    with session.lock:
        total = session.page_count
        if not 0 <= at <= total:
            raise BadRequestError(f"Pages can be inserted at 0 to {total}, not {at}.")
        if not 1 <= count <= MAX_BLANK_PAGES:
            raise BadRequestError(f"Between 1 and {MAX_BLANK_PAGES} pages can be inserted.")
        neighbour = session.page(min(at, total - 1)).rect
        width = neighbour.width if width is None else width
        height = neighbour.height if height is None else height
        if not (1 <= width <= MAX_PAGE_SIDE and 1 <= height <= MAX_PAGE_SIDE):
            raise BadRequestError(f"Page sides must be between 1 and {MAX_PAGE_SIDE} points.")
        doc = session.doc

        def change() -> None:
            for _ in range(count):
                compat.insert_blank_page(doc, at, width, height)

        name = "Insert Page" if count == 1 else "Insert Pages"
        return _structural(session, name, change)


def insert_pdf_file(
    session: Session,
    path: str,
    at: int,
    password: str | None = None,
    from_pages: list[int] | None = None,
) -> dict[str, Any]:
    """Inserts the pages of another PDF (or ``from_pages`` of it, in that
    order) before index ``at``, with their annotations and links."""
    path = os.path.abspath(path)
    with session.lock:
        total = session.page_count
        if not 0 <= at <= total:
            raise BadRequestError(f"Pages can be inserted at 0 to {total}, not {at}.")
        source = open_pdf(path, password)
        try:
            _pick(source, from_pages, path)
            doc = session.doc
            return _structural(
                session,
                "Insert Pages",
                lambda: compat.insert_pdf(doc, source, start_at=at),
            )
        finally:
            source.close()


# --- New files ------------------------------------------------------------------


def extract_pages(session: Session, pages: list[int], out_path: str) -> dict[str, Any]:
    """Writes ``pages`` (in the order given) to a new file. The open document
    is unchanged; an encrypted document's encryption is kept."""
    target = os.path.abspath(out_path)
    with session.lock:
        if os.path.normcase(target) == os.path.normcase(session.path):
            raise BadRequestError("Choose a different file than the open document.")
        if not pages:
            raise BadRequestError("No pages were given.")
        _check_indexes(session, pages)
        check_target(target)
        copy = open_copy(session)
        try:
            copy.select(list(pages))
            size = write_document(copy, target)
        finally:
            copy.close()
    return {
        "path": target,
        "fileName": os.path.basename(target),
        "pageCount": len(pages),
        "size": size,
    }


def split_parts(
    session: Session,
    mode: SplitMode,
    ranges: list[list[int]] | None = None,
    every: int | None = None,
) -> list[dict[str, Any]]:
    """The parts a split produces: ``[{pages, title}]``. Call with the lock
    held."""
    count = session.page_count
    if mode == "ranges":
        if not ranges:
            raise BadRequestError("No page ranges were given.")
        parts = []
        for part in ranges:
            parts.append({"pages": list(part), "title": None})
            if not part:
                raise BadRequestError("A page range is empty.")
            _check_indexes(session, part)
        return parts
    if mode == "every":
        if not every or every < 1:
            raise BadRequestError("Give the number of pages per file (1 or more).")
        return [
            {"pages": list(range(start, min(start + every, count))), "title": None}
            for start in range(0, count, every)
        ]
    # Bookmarks: a new part starts at every top-level outline entry.
    starts: list[tuple[int, str]] = []
    for level, title, page in session.doc.get_toc(simple=True):
        if level != 1 or page < 1:
            continue
        index = page - 1
        if starts and index <= starts[-1][0]:
            continue  # same page as (or before) the previous part's start
        starts.append((index, title))
    if not starts:
        raise BadRequestError("The document has no top-level bookmarks to split at.")
    parts = []
    if starts[0][0] > 0:
        parts.append({"pages": list(range(0, starts[0][0])), "title": None})
    for number, (start, title) in enumerate(starts):
        end = starts[number + 1][0] if number + 1 < len(starts) else count
        parts.append({"pages": list(range(start, end)), "title": title})
    return parts


_UNSAFE = re.compile(r'[<>:"/\\|?*\x00-\x1f]+')


def _safe_name(text: str) -> str:
    name = _UNSAFE.sub("_", text).strip().strip(".")
    return name[:150] or "part"


def part_file_names(template: str, stem: str, parts: list[dict[str, Any]]) -> list[str]:
    """File names for split parts. ``template`` tokens: ``{name}`` (the
    document's file name without extension), ``{n}`` (part number, padded),
    ``{start}`` / ``{end}`` (first and last page, 1-based) and ``{title}``
    (the bookmark title, or "Part n")."""
    width = len(str(len(parts)))
    names: list[str] = []
    seen: set[str] = set()
    for number, part in enumerate(parts, start=1):
        pages = part["pages"]
        values = {
            "name": stem,
            "n": str(number).zfill(width),
            "start": str(min(pages) + 1),
            "end": str(max(pages) + 1),
            "title": part["title"] or f"Part {number}",
        }
        text = re.sub(r"\{(\w+)\}", lambda m, v=values: v.get(m.group(1), m.group(0)), template)
        base = _safe_name(text)
        if base.lower().endswith(".pdf"):
            base = base[:-4]
        candidate, suffix = base, 2
        while candidate.lower() in seen:
            candidate = f"{base} ({suffix})"
            suffix += 1
        seen.add(candidate.lower())
        names.append(candidate + ".pdf")
    return names


def split_document(
    session: Session,
    mode: SplitMode,
    out_dir: str,
    name_template: str = "{name}-{n}",
    *,
    ranges: list[list[int]] | None = None,
    every: int | None = None,
    overwrite: bool = False,
) -> dict[str, Any]:
    """Writes the parts of the document to ``out_dir``. Returns
    ``{files: [{path, fileName, pageCount, title}]}``."""
    folder = os.path.abspath(out_dir)
    if not os.path.isdir(folder):
        raise EngineError("folder_not_found", f"The folder does not exist: {folder}", 404)
    if not name_template.strip():
        raise BadRequestError("The file name pattern is empty.")
    with session.lock:
        parts = split_parts(session, mode, ranges, every)
        stem = os.path.splitext(os.path.basename(session.path))[0]
        targets = [
            os.path.join(folder, name) for name in part_file_names(name_template, stem, parts)
        ]
        own = os.path.normcase(session.path)
        if any(os.path.normcase(target) == own for target in targets):
            raise BadRequestError(
                "A part would replace the open document; change the name pattern."
            )
        existing = [target for target in targets if os.path.exists(target)]
        if existing and not overwrite:
            raise FilesExistError(existing)
        for target in targets:
            check_target(target)

        data = session.history.serialise()
        files = []
        for part, target in zip(parts, targets, strict=True):
            copy = open_copy(session, data)
            try:
                copy.select(part["pages"])
                write_document(copy, target)
            finally:
                copy.close()
            files.append(
                {
                    "path": target,
                    "fileName": os.path.basename(target),
                    "pageCount": len(part["pages"]),
                    "title": part["title"],
                }
            )
    return {"files": files}


def merge_files(inputs: list[dict[str, Any]], out_path: str, *, lock: Any) -> dict[str, Any]:
    """Combines ``inputs`` (``{path, password?, pages?}``) into a new file at
    ``out_path``, keeping each file's outline. ``lock`` is the PyMuPDF lock."""
    if not inputs:
        raise BadRequestError("No files to merge.")
    target = os.path.abspath(out_path)
    check_target(target)
    sources = [os.path.abspath(item["path"]) for item in inputs]
    if any(os.path.normcase(source) == os.path.normcase(target) for source in sources):
        raise BadRequestError("The merged file cannot replace one of the files being merged.")
    with lock:
        merged = pymupdf.open()
        try:
            toc: list[list[Any]] = []
            for item, path in zip(inputs, sources, strict=True):
                source = open_pdf(path, item.get("password"))
                try:
                    _pick(source, item.get("pages"), path)
                    offset = merged.page_count
                    toc.extend(_toc_entries(source, offset))
                    merged.insert_pdf(source)
                finally:
                    source.close()
            if toc:
                merged.set_toc(toc)
            size = write_document(merged, target)
            page_count = merged.page_count
        finally:
            merged.close()
    return {
        "path": target,
        "fileName": os.path.basename(target),
        "pageCount": page_count,
        "size": size,
    }
