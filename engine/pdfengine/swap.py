"""Applying a processed copy of a document to the open document as one undo step.

A job such as Compress works on a copy of the document in a child process.
The copy is made with ``History.serialise`` (no renumbering), so an object has
the same number in the copy as in the open document. The child records every
object before it changes the copy (``ObjectSnapshot``), compares afterwards
(``changed_objects``) and saves the copy without renumbering. The engine then
copies just those objects into the open document inside one journal
operation (``apply_objects``).

How each object is written matters for undo (STATUS.md, Verified facts):
``Document.update_object`` on an existing object records nothing in the
journal, so existing dictionaries are changed key by key (``pdf_dict_put`` /
``pdf_dict_del``, which the journal records); new objects are created with
``get_new_xref`` (recorded as new, removed by undo) and then filled; stream
data is replaced with ``pdf_update_stream``, which the journal also records.

MuPDF caches decoded images and fonts by object. After objects change in
place, and again after undoing or redoing such a step, the cache is emptied
(``Step.purge``) so nothing stale is drawn.
"""

import hashlib
from typing import Any

import pymupdf
from pymupdf import mupdf

from .errors import EngineError
from .sessions import Session


class ObjectSnapshot:
    """Fingerprints of every object of a document."""

    def __init__(self, doc: pymupdf.Document) -> None:
        self.length = doc.xref_length()
        self._prints = [_fingerprint(doc, xref) for xref in range(self.length)]

    def changed(self, doc: pymupdf.Document) -> list[int]:
        """Objects of ``doc`` that differ from the snapshot, or are new."""
        changed = []
        for xref in range(1, doc.xref_length()):
            now = _fingerprint(doc, xref)
            if now is None:
                continue  # free or deleted: unreferenced, gone with the next save
            if xref >= self.length or self._prints[xref] != now:
                changed.append(xref)
        return changed


def _fingerprint(doc: pymupdf.Document, xref: int) -> tuple[str, bytes | None] | None:
    if xref == 0:
        return None
    try:
        source = doc.xref_object(xref, compressed=True)
    except Exception:
        return None
    if source == "null":
        return None
    stream = None
    if doc.xref_is_stream(xref):
        stream = hashlib.blake2b(doc.xref_stream_raw(xref) or b"", digest_size=16).digest()
    return source, stream


def apply_objects(
    session: Session,
    source: pymupdf.Document,
    changed: list[int],
    name: str,
    *,
    expected_revision: int,
) -> dict[str, Any]:
    """Copies the ``changed`` objects of ``source`` (a processed copy of the
    session's document) into the document as one undo step named ``name``.
    Every page is marked dirty. Raises ``DocumentChangedError`` if the
    document's revision is no longer ``expected_revision``."""
    from .jobs import DocumentChangedError

    with session.lock:
        if session.revision != expected_revision:
            raise DocumentChangedError()
        doc = session.doc
        pdf = pymupdf._as_pdf_document(doc)
        base_length = doc.xref_length()
        with session.edit(name) as step:
            step.purge = True
            while doc.xref_length() < source.xref_length():
                doc.get_new_xref()
            for xref in changed:
                text = source.xref_object(xref, compressed=True)
                target = mupdf.pdf_load_object(pdf, xref)
                if xref >= base_length or mupdf.pdf_is_null(target):
                    # A new object: created inside this step, so undo removes it.
                    doc.update_object(xref, text)
                else:
                    _replace(pdf, target, mupdf.pdf_load_object(_as_pdf(source), xref), xref)
                if source.xref_is_stream(xref):
                    data = source.xref_stream_raw(xref) or b""
                    mupdf.pdf_update_stream(
                        pdf,
                        mupdf.pdf_load_object(pdf, xref),
                        mupdf.fz_new_buffer_from_copied_data(data),
                        1,
                    )
            doc._reset_page_refs()
            step.pages.update(range(doc.page_count))
        purge_cache()
        return session.mutated(step.pages)


def _as_pdf(doc: pymupdf.Document) -> mupdf.PdfDocument:
    return pymupdf._as_pdf_document(doc)


def _replace(pdf: mupdf.PdfDocument, target: Any, new: Any, xref: int) -> None:
    """Makes the existing object ``target`` equal to ``new`` (an object of
    another document with the same numbering), recording the change in the
    journal."""
    if mupdf.pdf_is_dict(target) and mupdf.pdf_is_dict(new):
        wanted = {
            mupdf.pdf_to_name(mupdf.pdf_dict_get_key(new, i))
            for i in range(mupdf.pdf_dict_len(new))
        }
        for i in reversed(range(mupdf.pdf_dict_len(target))):
            key = mupdf.pdf_dict_get_key(target, i)
            if mupdf.pdf_to_name(key) not in wanted:
                mupdf.pdf_dict_del(target, key)
        for i in range(mupdf.pdf_dict_len(new)):
            key = mupdf.pdf_new_name(mupdf.pdf_to_name(mupdf.pdf_dict_get_key(new, i)))
            mupdf.pdf_dict_put(target, key, _import(pdf, mupdf.pdf_dict_get_val(new, i)))
    elif mupdf.pdf_is_array(target) and mupdf.pdf_is_array(new):
        while mupdf.pdf_array_len(target) > 0:
            mupdf.pdf_array_delete(target, mupdf.pdf_array_len(target) - 1)
        for i in range(mupdf.pdf_array_len(new)):
            mupdf.pdf_array_push(target, _import(pdf, mupdf.pdf_array_get(new, i)))
    else:
        raise EngineError(
            "apply_failed",
            f"Object {xref} could not be updated (unsupported kind of object).",
            500,
        )


def _import(pdf: mupdf.PdfDocument, value: Any) -> Any:
    """``value`` (from the processed copy) as an object of ``pdf``. Indirect
    references keep their numbers, which mean the same objects in both."""
    if mupdf.pdf_is_indirect(value):
        return mupdf.pdf_new_indirect(pdf, mupdf.pdf_to_num(value), 0)
    if mupdf.pdf_is_dict(value):
        result = mupdf.pdf_new_dict(pdf, mupdf.pdf_dict_len(value))
        for i in range(mupdf.pdf_dict_len(value)):
            key = mupdf.pdf_new_name(mupdf.pdf_to_name(mupdf.pdf_dict_get_key(value, i)))
            mupdf.pdf_dict_put(result, key, _import(pdf, mupdf.pdf_dict_get_val(value, i)))
        return result
    if mupdf.pdf_is_array(value):
        result = mupdf.pdf_new_array(pdf, mupdf.pdf_array_len(value))
        for i in range(mupdf.pdf_array_len(value)):
            mupdf.pdf_array_push(result, _import(pdf, mupdf.pdf_array_get(value, i)))
        return result
    # Names, numbers, strings, booleans and null are not tied to a document.
    return value


def purge_cache() -> None:
    """Empties MuPDF's cache of decoded images and fonts."""
    pymupdf.TOOLS.store_shrink(100)
