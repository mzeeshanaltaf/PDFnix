"""Text pages that never change the document.

PyMuPDF's ``Page.get_textpage`` (and everything built on it: ``get_text``
without a ``textpage``, ``search_for``, ``get_image_info``, ``get_texttrace``)
sets a rotated page's rotation to 0 for a moment and back again. With the
journal enabled, that is a change outside an operation and MuPDF refuses it.
These helpers build the text page with a derotation matrix instead, which gives
the same result (checked at 0, 90, 180 and 270 degrees and with offset crop
boxes) without touching the page.

Use them for every text or image query on a page.
"""

import weakref

import pymupdf
from pymupdf import mupdf


def text_page(page: pymupdf.Page, flags: int) -> pymupdf.TextPage:
    """The page's text in *unrotated* coordinates, as ``page.get_textpage``
    would return it."""
    matrix = page.derotation_matrix
    # The clip is the page's area in the space the text lands in. Without it
    # MuPDF clips to the rotated bounds and loses text on 90/270 degree pages.
    clip = page.rect * matrix
    textpage = pymupdf.TextPage(page._get_textpage(clip, flags, matrix))
    textpage.parent = weakref.proxy(page)
    return textpage


def content_text_page(page: pymupdf.Page, flags: int, *, derotate: bool = True) -> pymupdf.TextPage:
    """Like ``text_page``, but only the page's own content: no annotation
    appearances (free text, stamps…), which cannot be edited as page content.

    With ``derotate=False`` the coordinates are in the displayed space.
    """
    fz_page = page.this if isinstance(page.this, mupdf.FzPage) else page.this.super()
    if derotate:
        matrix = page.derotation_matrix
        clip = page.rect * matrix
    else:
        matrix = pymupdf.Identity
        clip = page.rect
    stext = mupdf.FzStextPage(mupdf.FzRect(clip.x0, clip.y0, clip.x1, clip.y1))
    device = mupdf.fz_new_stext_device(stext, mupdf.FzStextOptions(flags))
    mupdf.fz_run_page_contents(fz_page, device, mupdf.FzMatrix(*tuple(matrix)), mupdf.FzCookie())
    mupdf.fz_close_device(device)
    textpage = pymupdf.TextPage(stext)
    textpage.parent = weakref.proxy(page)
    return textpage


def content_image_rects(page: pymupdf.Page) -> list[pymupdf.Rect]:
    """Where the page content draws images, displayed space (no annotations)."""
    textpage = content_text_page(page, pymupdf.TEXT_PRESERVE_IMAGES, derotate=False)
    return [pymupdf.Rect(block[:4]) for block in textpage.extractBLOCKS() if block[6] == 1]


def image_rects(page: pymupdf.Page) -> list[pymupdf.Rect]:
    """Where images are drawn on the page, in the displayed (rotated) space."""
    textpage = pymupdf.TextPage(page._get_textpage(None, pymupdf.TEXT_PRESERVE_IMAGES, None))
    textpage.parent = weakref.proxy(page)
    return [pymupdf.Rect(block[:4]) for block in textpage.extractBLOCKS() if block[6] == 1]


def has_text(page: pymupdf.Page) -> bool:
    return bool(text_page(page, 0).extractText().strip())
