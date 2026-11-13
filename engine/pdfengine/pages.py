"""Page operations. Phase 2 only has rotation; the rest arrives in phase 5."""

from typing import Any

from .errors import BadRequestError
from .sessions import Session, page_info


def rotate_pages(session: Session, pages: list[int] | None, degrees: int) -> dict[str, Any]:
    """Rotates pages by a multiple of 90 degrees (positive is clockwise).

    ``pages`` are 0-based indexes; ``None`` means every page. Returns the
    standard mutation response plus the new size of each rotated page.
    """
    if degrees % 90 != 0:
        raise BadRequestError("Pages can only be rotated in steps of 90 degrees.")

    with session.lock:
        targets = sorted(set(pages)) if pages is not None else list(range(session.page_count))
        # Validate everything before changing anything.
        loaded = [(index, session.page(index)) for index in targets]
        if degrees % 360 == 0 or not loaded:
            return {
                "revision": session.revision,
                "dirtyPages": [],
                "pageCount": session.page_count,
                "pages": [],
            }

        changed: list[dict[str, Any]] = []
        for index, page in loaded:
            page.set_rotation((page.rotation + degrees) % 360)
            changed.append({"index": index, **page_info(page)})

        response = session.mutated(targets)
        response["pages"] = changed
        return response
