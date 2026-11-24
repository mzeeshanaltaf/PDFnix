"""A document's text as plain text, for the AI assistant's context.

Built from ``textpages.content_text_page``, which is safe with the journal on
and at every rotation (``page.get_text`` is not: it turns rotated pages back to
0 degrees for a moment, which the journal refuses). Only the page's own content
is read, so comments, free text and other annotation text are left out.

Blocks come in MuPDF's reading order; the lines of a block are joined with a
line break and blocks with a blank line.
"""

from typing import Any

from .errors import BadRequestError
from .sessions import Session
from .text import TEXT_FLAGS
from .textpages import content_text_page

#: The most text one request returns (the app sends at most 2 MB to the model).
MAX_CHARS = 2_000_000


def page_plain_text(session: Session, index: int) -> str:
    """The text of one page. Takes the lock for this page only."""
    with session.lock:
        page = session.page(index)
        textpage = content_text_page(page, TEXT_FLAGS)
        blocks = textpage.extractBLOCKS()
    parts = []
    for block in blocks:
        if block[6] != 0:  # not a text block
            continue
        lines = [line.rstrip() for line in str(block[4]).splitlines()]
        text = "\n".join(line for line in lines if line.strip())
        if text:
            parts.append(text)
    return "\n\n".join(parts)


def plain_text(
    session: Session, first: int, last: int | None, max_chars: int = MAX_CHARS
) -> dict[str, Any]:
    """Pages ``first``..``last`` (inclusive, 0-based) as plain text.

    Stops at a page boundary before ``max_chars`` would be exceeded and says
    so with ``truncated``. The first page is always included, cut to
    ``max_chars`` if it is longer on its own.
    """
    page_count = session.page_count
    if last is None:
        last = page_count - 1
    if not 0 <= first <= last < page_count:
        raise BadRequestError(
            f"Pages {first} to {last} are not a range of this document (0 to {page_count - 1})."
        )
    if not 1 <= max_chars <= MAX_CHARS:
        raise BadRequestError(f"maxChars must be between 1 and {MAX_CHARS}.")

    pages: list[dict[str, Any]] = []
    used = 0
    truncated = False
    for index in range(first, last + 1):
        text = page_plain_text(session, index)
        if used + len(text) > max_chars:
            truncated = True
            if not pages:
                pages.append({"index": index, "text": text[:max_chars]})
            break
        pages.append({"index": index, "text": text})
        used += len(text)
    return {"pages": pages, "pageCount": page_count, "truncated": truncated}
