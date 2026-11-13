"""Page operations. Phase 2 only has rotation; the rest arrives in phase 5."""

from typing import Any

from .errors import BadRequestError
from .sessions import Session


def rotate_pages(session: Session, pages: list[int] | None, degrees: int) -> dict[str, Any]:
    """Rotates pages by a multiple of 90 degrees (positive is clockwise).

    ``pages`` are 0-based indexes; ``None`` means every page. Returns the
    standard mutation response, whose ``pages`` carry the new sizes.
    """
    if degrees % 90 != 0:
        raise BadRequestError("Pages can only be rotated in steps of 90 degrees.")

    with session.lock:
        targets = sorted(set(pages)) if pages is not None else list(range(session.page_count))
        # Validate everything before changing anything.
        for index in targets:
            session.page(index)
        if degrees % 360 == 0 or not targets:
            return {
                "revision": session.revision,
                "dirtyPages": [],
                "pageCount": session.page_count,
                "pages": [],
                **session.history.state(),
            }

        with session.edit("Rotate") as step:
            for index in targets:
                page = session.page(index)
                page.set_rotation((page.rotation + degrees) % 360)
                step.pages.add(index)
        return session.mutated(step.pages)
