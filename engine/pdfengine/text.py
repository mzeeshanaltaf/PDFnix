"""Text extraction and search.

PyMuPDF reports text positions in the page's *unrotated* space. The API works
in the displayed (rotated) space, so everything leaving this module is passed
through ``page.rotation_matrix``.
"""

import math
from collections.abc import Callable
from typing import Any

import pymupdf

from .sessions import Session
from .textpages import text_page

# Ligatures are expanded ("ﬁ" becomes "fi") so copied text and search behave
# as a reader expects. The same flags are used for the text layer and for
# search, so the two always agree.
TEXT_FLAGS = (
    pymupdf.TEXT_PRESERVE_WHITESPACE
    | pymupdf.TEXT_MEDIABOX_CLIP
    | pymupdf.TEXT_CID_FOR_UNKNOWN_UNICODE
)

MAX_SEARCH_HITS = 5000
SNIPPET_BEFORE = 40
SNIPPET_AFTER = 60


class SearchCancelled(Exception):
    """The client went away while a search was running."""


def _rect(rect: pymupdf.Rect) -> list[float]:
    return [round(rect.x0, 2), round(rect.y0, 2), round(rect.x1, 2), round(rect.y1, 2)]


def _angle(direction: tuple[float, float], matrix: pymupdf.Matrix) -> float:
    """Direction of a line of text on the displayed page, in degrees.

    0 reads left to right, 90 top to bottom, 180 upside down, 270 bottom to top.
    """
    # Only the rotation part of the matrix applies to a direction.
    dx = direction[0] * matrix.a + direction[1] * matrix.c
    dy = direction[0] * matrix.b + direction[1] * matrix.d
    return round(math.degrees(math.atan2(dy, dx)) % 360, 1) % 360


def page_text(session: Session, index: int) -> dict[str, Any]:
    """Lines and words of a page with their boxes, in reading order."""
    with session.lock:
        page = session.page(index)
        matrix = page.rotation_matrix
        textpage = text_page(page, TEXT_FLAGS)
        words = page.get_text("words", textpage=textpage)
        layout = page.get_text("dict", textpage=textpage)

        directions: dict[tuple[int, int], tuple[float, float]] = {}
        for block in layout["blocks"]:
            if block["type"] != 0:
                continue
            for line_no, line in enumerate(block["lines"]):
                directions[(block["number"], line_no)] = line["dir"]

        lines: list[dict[str, Any]] = []
        current_key: tuple[int, int] | None = None
        current_box: pymupdf.Rect | None = None
        for x0, y0, x1, y1, text, block_no, line_no, _word_no in words:
            key = (block_no, line_no)
            box = pymupdf.Rect(x0, y0, x1, y1) * matrix
            if key != current_key:
                if current_box is not None:
                    lines[-1]["bbox"] = _rect(current_box)
                lines.append(
                    {
                        "bbox": [],
                        "angle": _angle(directions.get(key, (1.0, 0.0)), matrix),
                        "words": [],
                    }
                )
                current_key = key
                current_box = pymupdf.Rect(box)
            else:
                current_box |= box
            lines[-1]["words"].append({"text": text, "bbox": _rect(box)})
        if current_box is not None:
            lines[-1]["bbox"] = _rect(current_box)

        return {"lines": lines}


def _fold(char: str) -> str:
    """Case-folds one character without ever changing the length of the text."""
    folded = char.casefold()
    if len(folded) == 1:
        return folded
    lowered = char.lower()
    return lowered if len(lowered) == 1 else char


def _fold_text(text: str) -> str:
    return "".join(_fold(char) for char in text)


def _is_word_char(char: str) -> bool:
    return char.isalnum() or char == "_"


def _quad(rect: pymupdf.Rect, matrix: pymupdf.Matrix) -> list[float]:
    """The rectangle's corners (upper-left, upper-right, lower-left, lower-right
    relative to the text) on the displayed page."""
    values: list[float] = []
    for point in (rect.tl, rect.tr, rect.bl, rect.br):
        moved = point * matrix
        values.extend((round(moved.x, 2), round(moved.y, 2)))
    return values


def _snippet(text: str, start: int, end: int) -> tuple[str, str]:
    """Context around ``text[start:end]``, cut at word boundaries where possible."""
    left = max(0, start - SNIPPET_BEFORE)
    before = text[left:start]
    if left > 0:
        space = before.find(" ")
        before = "…" + (before[space + 1 :] if 0 <= space < len(before) - 1 else before)
    right = min(len(text), end + SNIPPET_AFTER)
    after = text[end:right]
    if right < len(text):
        space = after.rfind(" ")
        after = (after[:space] if space > 0 else after) + "…"
    return before, after.rstrip()


def search_page(
    page: pymupdf.Page, index: int, needle: str, match_case: bool, whole_word: bool
) -> list[dict[str, Any]]:
    """All occurrences of ``needle`` (whitespace already normalised) on a page."""
    textpage = text_page(page, TEXT_FLAGS)

    # Cheap test first: most pages of a long document do not contain the query.
    plain = " ".join(page.get_text("text", textpage=textpage).split())
    if match_case:
        if needle not in plain:
            return []
    elif needle.casefold() not in plain.casefold():
        return []

    # Exact model: one entry per character, runs of whitespace and line ends
    # collapsed to a single space, each character with its box and line.
    chars: list[str] = []
    boxes: list[tuple[float, float, float, float] | None] = []
    line_of: list[int] = []
    line_no = 0
    for block in page.get_text("rawdict", textpage=textpage)["blocks"]:
        if block["type"] != 0:
            continue
        for line in block["lines"]:
            for span in line["spans"]:
                for char in span["chars"]:
                    value = char["c"][:1]
                    if not value or value.isspace():
                        if chars and chars[-1] != " ":
                            chars.append(" ")
                            boxes.append(None)
                            line_of.append(line_no)
                    else:
                        chars.append(value)
                        boxes.append(char["bbox"])
                        line_of.append(line_no)
            if chars and chars[-1] != " ":
                chars.append(" ")
                boxes.append(None)
                line_of.append(line_no)
            line_no += 1

    text = "".join(chars)
    haystack = text if match_case else _fold_text(text)
    target = needle if match_case else _fold_text(needle)
    matrix = page.rotation_matrix

    hits: list[dict[str, Any]] = []
    position = 0
    while (start := haystack.find(target, position)) != -1:
        end = start + len(target)
        if whole_word and (
            (start > 0 and _is_word_char(text[start - 1]) and _is_word_char(text[start]))
            or (end < len(text) and _is_word_char(text[end]) and _is_word_char(text[end - 1]))
        ):
            position = start + 1
            continue
        position = end

        quads: list[list[float]] = []
        box: pymupdf.Rect | None = None
        box_line = -1
        for offset in range(start, end):
            char_box = boxes[offset]
            if char_box is None:
                continue
            if box is None or line_of[offset] != box_line:
                if box is not None:
                    quads.append(_quad(box, matrix))
                box = pymupdf.Rect(char_box)
                box_line = line_of[offset]
            else:
                box |= pymupdf.Rect(char_box)
        if box is not None:
            quads.append(_quad(box, matrix))
        if not quads:
            continue

        before, after = _snippet(text, start, end)
        hits.append(
            {
                "page": index,
                "quads": quads,
                "before": before,
                "match": text[start:end],
                "after": after,
            }
        )
    return hits


def search_document(
    session: Session,
    query: str,
    match_case: bool = False,
    whole_word: bool = False,
    *,
    cancelled: Callable[[], bool] | None = None,
) -> dict[str, Any]:
    """Searches the whole document. Hits are in page order, then reading order."""
    needle = " ".join(query.split())
    hits: list[dict[str, Any]] = []
    truncated = False
    if needle:
        with session.lock:
            page_count = session.page_count
        for index in range(page_count):
            if cancelled is not None and cancelled():
                raise SearchCancelled()
            # The lock is taken per page so rendering is not held up for the
            # length of a whole search.
            with session.lock:
                if index >= session.page_count:
                    break
                hits.extend(search_page(session.page(index), index, needle, match_case, whole_word))
            if len(hits) >= MAX_SEARCH_HITS:
                truncated = len(hits) > MAX_SEARCH_HITS or index < page_count - 1
                del hits[MAX_SEARCH_HITS:]
                break
    return {"hits": hits, "truncated": truncated}
