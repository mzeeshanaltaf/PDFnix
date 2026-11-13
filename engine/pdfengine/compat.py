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
"""

import pymupdf
from pymupdf import mupdf

_original_have_operation = pymupdf.JM_have_operation


def _have_operation(pdf: mupdf.PdfDocument) -> int:
    try:
        return _original_have_operation(pdf)
    except mupdf.FzErrorArgument:
        # Only raised while an operation is open.
        return 1


def install() -> None:
    if pymupdf.JM_have_operation is not _have_operation:
        pymupdf.JM_have_operation = _have_operation


install()
