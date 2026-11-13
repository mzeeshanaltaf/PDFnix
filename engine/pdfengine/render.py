"""Page rendering.

Pages are rendered to PNG, which is lossless and small for ordinary pages.
Pages that are mostly a picture (scans, photographs) compress badly as PNG, so
``format=auto`` sends those as JPEG instead.
"""

import math
from dataclasses import dataclass
from typing import Literal

import pymupdf

from .sessions import Session
from .textpages import image_rects

ImageFormat = Literal["auto", "png", "jpeg"]

# A single page image never exceeds this many pixels; beyond it the renderer
# scales the image with CSS.
MAX_PIXELS = 40_000_000
JPEG_QUALITY = 90
# A page counts as a picture when images cover at least this share of it.
PICTURE_COVERAGE = 0.6

MEDIA_TYPES = {"png": "image/png", "jpeg": "image/jpeg"}


@dataclass(frozen=True)
class RenderedPage:
    data: bytes
    media_type: str
    width: int
    height: int
    #: The scale actually used, after the pixel budget was applied.
    scale: float


def effective_scale(width_pt: float, height_pt: float, scale: float) -> float:
    """``scale`` limited so the image stays within the pixel budget."""
    area = width_pt * height_pt
    if area <= 0:
        return scale
    return min(scale, math.sqrt(MAX_PIXELS / area))


def _is_picture(page: pymupdf.Page) -> bool:
    page_area = page.rect.get_area()
    if page_area <= 0:
        return False
    covered = 0.0
    for rect in image_rects(page):
        covered += (rect & page.rect).get_area()
        if covered >= PICTURE_COVERAGE * page_area:
            return True
    return False


def render_page(
    session: Session, index: int, scale: float, image_format: ImageFormat = "auto"
) -> RenderedPage:
    """Renders page ``index`` at ``scale`` pixels per point."""
    with session.lock:
        page = session.page(index)
        rect = page.rect
        used = effective_scale(rect.width, rect.height, scale)
        chosen = image_format
        if chosen == "auto":
            chosen = "jpeg" if _is_picture(page) else "png"
        pixmap = page.get_pixmap(matrix=pymupdf.Matrix(used, used), alpha=False)
        if chosen == "jpeg":
            data = pixmap.tobytes("jpeg", jpg_quality=JPEG_QUALITY)
        else:
            data = pixmap.tobytes("png")
        return RenderedPage(data, MEDIA_TYPES[chosen], pixmap.width, pixmap.height, used)
