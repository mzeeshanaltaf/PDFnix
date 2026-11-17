"""Hyperlinks on a page.

Two kinds reach the viewer: links to a web address (``uri``) and links to
another page of the same document (``page``). Links that launch programs or
open other files are left out on purpose: a PDF must not be able to start
anything on the user's machine. Whether a web address is safe to open is
decided again by the app before it opens it.

Unlike text, link boxes come from PyMuPDF already in the displayed (rotated)
space, so they need no ``rotation_matrix``. That holds for a freshly loaded
page; a ``Page`` object kept across ``set_rotation`` reports stale boxes, which
is why the page is loaded per request (``session.page`` does that).
"""

from typing import Any

import pymupdf

from .sessions import Session

#: Longer addresses are not real links; they are left out.
MAX_URI_LENGTH = 4096


def _rect(rect: pymupdf.Rect) -> list[float]:
    return [round(rect.x0, 2), round(rect.y0, 2), round(rect.x1, 2), round(rect.y1, 2)]


def page_links(session: Session, index: int) -> dict[str, Any]:
    """The clickable links of a page, in the displayed (rotated) space."""
    with session.lock:
        page = session.page(index)
        bounds = page.rect
        page_count = session.doc.page_count
        raw = page.get_links()

    links: list[dict[str, Any]] = []
    for link in raw:
        area = pymupdf.Rect(link.get("from") or pymupdf.Rect()) & bounds
        if area.is_empty or area.is_infinite:
            continue
        kind = link.get("kind")
        if kind == pymupdf.LINK_URI:
            uri = str(link.get("uri") or "").strip()
            if not uri or len(uri) > MAX_URI_LENGTH:
                continue
            links.append({"rect": _rect(area), "kind": "uri", "uri": uri, "page": None})
        elif kind in (pymupdf.LINK_GOTO, pymupdf.LINK_NAMED):
            target = link.get("page")
            if not isinstance(target, int) or not 0 <= target < page_count:
                continue
            links.append({"rect": _rect(area), "kind": "page", "uri": None, "page": target})
    return {"links": links}
