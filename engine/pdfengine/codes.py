"""QR codes and barcodes on a page.

The page is rendered to a grey bitmap and decoded with zxing-cpp, so codes
drawn as vectors, placed as images or captured in a scan are all found the
same way.

1. The whole page at 144 dpi finds vector codes and codes of ordinary size.
2. Then each picture on the page (scans, photographs, barcode images) that is
   not itself one of the codes already found is rendered on its own at up to
   432 dpi. Codes in pictures are often small, and generated barcodes are
   often images with bars one pixel wide, which blur at moderate scales: a
   LESCO bill's Code 128 strip (1326 px over 874 pt) was missed at 2× and 4×
   and read at 3× and 6×.

Rendering needs the PyMuPDF lock; decoding does not (zxing-cpp releases the
GIL), so the lock is released while zxing-cpp works and page renders for the
viewer are not held up.

Pixmaps are rendered in the displayed (rotated) space with its origin at the
top left of ``page.rect``, so positions are (pixmap origin + pixel) divided by
the scale: the same space as links and words.
"""

import math
from typing import Any

import numpy as np
import pymupdf
import zxingcpp

from .sessions import Session
from .textpages import image_rects

#: First pass: pixels per point (144 dpi).
PAGE_SCALE = 2.0
#: Second pass, per picture (432 dpi), lowered for large pictures.
PICTURE_SCALE = 6.0
#: No single render is larger than this many pixels.
MAX_PIXELS = 16_000_000
#: Pictures smaller than this (in points) cannot hold a readable code.
MIN_PICTURE_SIDE = 10.0
MIN_PICTURE_AREA = 300.0
#: At most this many pictures per page are searched, largest first.
MAX_PICTURES = 12
#: A picture this much covered by codes already found is one of those codes.
COVERED = 0.6
#: Longer contents are cut; nothing that long is meant to be read on screen.
MAX_TEXT = 8192

#: ITF and Codabar are left out: they find false codes in ordinary text.
FORMATS = (
    zxingcpp.BarcodeFormat.QRCode,
    zxingcpp.BarcodeFormat.MicroQRCode,
    zxingcpp.BarcodeFormat.RMQRCode,
    zxingcpp.BarcodeFormat.DataMatrix,
    zxingcpp.BarcodeFormat.Aztec,
    zxingcpp.BarcodeFormat.PDF417,
    zxingcpp.BarcodeFormat.Code128,
    zxingcpp.BarcodeFormat.Code39,
    zxingcpp.BarcodeFormat.EAN13,
    zxingcpp.BarcodeFormat.EAN8,
    zxingcpp.BarcodeFormat.UPCA,
    zxingcpp.BarcodeFormat.UPCE,
)


class _Render:
    """A grey render of (part of) a page and how to map it back to points."""

    def __init__(self, page: pymupdf.Page, scale: float, clip: pymupdf.Rect | None) -> None:
        area = (clip or page.rect).get_area()
        if area > 0:
            scale = min(scale, math.sqrt(MAX_PIXELS / area))
        pixmap = page.get_pixmap(
            matrix=pymupdf.Matrix(scale, scale),
            colorspace=pymupdf.csGRAY,
            alpha=False,
            clip=clip,
        )
        rows = np.frombuffer(pixmap.samples, dtype=np.uint8).reshape(pixmap.height, pixmap.stride)
        # A copy, so the image no longer depends on the pixmap's memory.
        self.image = np.ascontiguousarray(rows[:, : pixmap.width])
        self.scale = scale
        self.x0, self.y0 = pixmap.x, pixmap.y


def _decode(render: _Render, bounds: pymupdf.Rect) -> list[dict[str, Any]]:
    codes: list[dict[str, Any]] = []
    for found in zxingcpp.read_barcodes(render.image, formats=FORMATS):
        if not found.valid:
            continue
        binary = found.content_type == zxingcpp.ContentType.Binary
        text = (found.bytes.hex(" ") if binary else found.text)[:MAX_TEXT]
        position = found.position
        corners = (
            position.top_left,
            position.top_right,
            position.bottom_right,
            position.bottom_left,
        )
        quad = [
            [
                round((render.x0 + p.x) / render.scale, 2),
                round((render.y0 + p.y) / render.scale, 2),
            ]
            for p in corners
        ]
        xs = [x for x, _ in quad]
        ys = [y for _, y in quad]
        rect = pymupdf.Rect(min(xs), min(ys), max(xs), max(ys)) & bounds
        codes.append(
            {
                "format": str(found.format),
                "text": text,
                "binary": binary,
                "quad": quad,
                "rect": [round(value, 2) for value in rect],
            }
        )
    return codes


def _pictures(page: pymupdf.Page) -> list[pymupdf.Rect]:
    """The visible parts of the page's pictures worth searching, largest first."""
    bounds = page.rect
    pictures = []
    # Overhanging pictures too: a bill's barcode image may be wider than the page.
    for rect in image_rects(page, overhanging=True):
        visible = rect & bounds
        if visible.is_empty or visible.is_infinite:
            continue
        if min(visible.width, visible.height) < MIN_PICTURE_SIDE:
            continue
        if visible.get_area() < MIN_PICTURE_AREA:
            continue
        pictures.append(visible)
    pictures.sort(key=lambda rect: rect.get_area(), reverse=True)
    return pictures[:MAX_PICTURES]


def _covered(picture: pymupdf.Rect, codes: list[dict[str, Any]]) -> bool:
    inside = sum((pymupdf.Rect(code["rect"]) & picture).get_area() for code in codes)
    return inside >= COVERED * picture.get_area()


def page_codes(session: Session, index: int) -> dict[str, Any]:
    """The QR codes and barcodes on a page, in the displayed (rotated) space."""
    with session.lock:
        page = session.page(index)
        bounds = pymupdf.Rect(page.rect)
        render = _Render(page, PAGE_SCALE, None)
        pictures = _pictures(page)

    codes: list[dict[str, Any]] = []
    seen: set[tuple[str, str]] = set()

    def add(found: list[dict[str, Any]]) -> None:
        for code in found:
            key = (code["format"], code["text"])
            if key not in seen:
                seen.add(key)
                codes.append(code)

    add(_decode(render, bounds))
    for picture in pictures:
        if _covered(picture, codes):
            continue
        with session.lock:
            render = _Render(session.page(index), PICTURE_SCALE, picture)
        add(_decode(render, bounds))
    return {"codes": codes}
