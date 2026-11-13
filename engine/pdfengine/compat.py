"""Workarounds for the pinned PyMuPDF. Imported by the package, so they are in
place before any document is touched.

**Operation check.** Several PyMuPDF functions (``show_pdf_page`` and so
``insert_htmlbox``, ``insert_pdf``, ``insert_font``, ``update_object``,
``get_new_xref``) first make sure a journal operation is open by calling
``JM_have_operation``, which asks MuPDF for undo step 0. MuPDF refuses to
answer *while an operation is open* ("Can't undo/redo during an operation"), so
in PyMuPDF 2.1 these functions fail exactly when they are used correctly. The
wrapper treats that refusal as the answer it is: an operation is open.

Re-check on every PyMuPDF upgrade (``test_compat.py``); remove the wrapper once
PyMuPDF fixes the check.

**C++ helpers.** With ``g_use_extra`` on (the default), ``Document.insert_pdf``
and ``Document.new_page`` run compiled helpers that do their own operation
check, which the wrapper cannot reach, so both fail inside an operation.
``insert_pdf`` below switches to PyMuPDF's pure-Python path for the call;
``insert_blank_page`` builds the page with MuPDF's own calls. Both journal, undo
and redo correctly (``test_pages.py``).
"""

from collections.abc import Iterator
from contextlib import contextmanager
from typing import Any

import pymupdf
from pymupdf import mupdf

_original_have_operation = pymupdf.JM_have_operation


def _have_operation(pdf: mupdf.PdfDocument) -> int:
    try:
        return _original_have_operation(pdf)
    except mupdf.FzErrorArgument:
        # Only raised while an operation is open.
        return 1


@contextmanager
def _python_paths() -> Iterator[None]:
    """Makes PyMuPDF use its Python code instead of the C++ helpers. Call with
    the session lock held (``g_use_extra`` is a module global)."""
    previous = pymupdf.g_use_extra
    pymupdf.g_use_extra = False
    try:
        yield
    finally:
        pymupdf.g_use_extra = previous


def insert_pdf(doc: pymupdf.Document, source: pymupdf.Document, **options: Any) -> None:
    """``doc.insert_pdf(source, **options)`` that also works inside an operation."""
    with _python_paths():
        doc.insert_pdf(source, **options)


def insert_blank_page(doc: pymupdf.Document, at: int, width: float, height: float) -> None:
    """Inserts an empty page of ``width`` x ``height`` points before index
    ``at`` (``page_count`` appends). Works inside an operation."""
    pdf = pymupdf._as_pdf_document(doc)
    page = mupdf.pdf_add_page(
        pdf,
        mupdf.FzRect(0, 0, width, height),
        0,
        mupdf.pdf_new_dict(pdf, 1),
        mupdf.fz_new_buffer(0),
    )
    mupdf.pdf_insert_page(pdf, at if at < doc.page_count else -1, page)
    doc._reset_page_refs()


def install() -> None:
    if pymupdf.JM_have_operation is not _have_operation:
        pymupdf.JM_have_operation = _have_operation


install()
