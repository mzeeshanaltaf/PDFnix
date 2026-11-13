"""The PyMuPDF workarounds in ``compat.py``."""

import pymupdf
import pytest
from pymupdf import mupdf

from pdfengine import compat


def journalled():
    doc = pymupdf.open()
    doc.new_page()
    doc = pymupdf.open(stream=doc.tobytes(), filetype="pdf")
    doc.journal_enable()
    return doc


def test_pymupdf_still_has_the_broken_operation_check():
    """When this fails, PyMuPDF has fixed ``JM_have_operation``: remove the
    wrapper in ``compat.py`` (and this test)."""
    doc = journalled()
    doc.journal_start_op("probe")
    pdf = pymupdf._as_pdf_document(doc)
    with pytest.raises(mupdf.FzErrorArgument):
        compat._original_have_operation(pdf)
    doc.journal_stop_op()


def test_html_box_can_be_inserted_inside_an_operation():
    doc = journalled()
    doc.journal_start_op("Insert")
    doc[0].insert_htmlbox(pymupdf.Rect(72, 72, 300, 200), "<p>Inside an operation</p>")
    doc.journal_stop_op()

    assert "Inside an operation" in doc[0].get_text()
    doc.journal_undo()
    assert doc[0].get_text().strip() == ""
    doc.journal_redo()
    assert "Inside an operation" in doc[0].get_text()
