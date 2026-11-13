"""Document outline and properties."""

import os
import re
from datetime import datetime, timedelta, timezone
from typing import Any

import pymupdf

from .sessions import Session

_PDF_DATE = re.compile(
    r"^(?:D:)?(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?"
    r"(?:([Zz+\-])(?:(\d{2})'?(\d{2})?'?)?)?"
)

_PERMISSIONS = {
    "print": pymupdf.PDF_PERM_PRINT,
    "printHighQuality": pymupdf.PDF_PERM_PRINT_HQ,
    "modify": pymupdf.PDF_PERM_MODIFY,
    "copy": pymupdf.PDF_PERM_COPY,
    "annotate": pymupdf.PDF_PERM_ANNOTATE,
    "fillForms": pymupdf.PDF_PERM_FORM,
    "accessibility": pymupdf.PDF_PERM_ACCESSIBILITY,
    "assemble": pymupdf.PDF_PERM_ASSEMBLE,
}


def parse_pdf_date(value: str | None) -> str | None:
    """Turns a PDF date (``D:20240131120000+01'00'``) into ISO 8601, or None."""
    if not value:
        return None
    match = _PDF_DATE.match(value.strip())
    if not match:
        return None
    year, month, day, hour, minute, second, sign, off_hours, off_minutes = match.groups()
    try:
        moment = datetime(
            int(year),
            int(month or 1),
            int(day or 1),
            int(hour or 0),
            int(minute or 0),
            int(second or 0),
        )
        if sign:
            offset = timedelta(hours=int(off_hours or 0), minutes=int(off_minutes or 0))
            if sign == "-":
                offset = -offset
            moment = moment.replace(tzinfo=timezone(offset))
    except ValueError:
        return None
    return moment.isoformat()


def document_outline(session: Session) -> list[dict[str, Any]]:
    """The table of contents. ``page`` is a 0-based index, or None when the
    entry does not point into this document."""
    with session.lock:
        doc = session.doc
        page_count = doc.page_count
        entries = doc.get_toc(simple=True)
    outline: list[dict[str, Any]] = []
    for level, title, page_number, *_rest in entries:
        target = page_number - 1 if 1 <= page_number <= page_count else None
        outline.append({"title": str(title).strip(), "page": target, "level": max(1, int(level))})
    return outline


def document_info(session: Session) -> dict[str, Any]:
    with session.lock:
        doc = session.doc
        metadata = doc.metadata or {}
        permissions = doc.permissions
        first = doc[0].rect
        page_count = doc.page_count

    def text(key: str) -> str:
        return str(metadata.get(key) or "").strip()

    pdf_format = text("format")
    return {
        "path": session.path,
        "fileName": os.path.basename(session.path),
        "fileSize": session.file_size,
        "pageCount": page_count,
        "pdfVersion": pdf_format.removeprefix("PDF").strip() or None,
        "title": text("title"),
        "author": text("author"),
        "subject": text("subject"),
        "keywords": text("keywords"),
        "creator": text("creator"),
        "producer": text("producer"),
        "createdAt": parse_pdf_date(metadata.get("creationDate")),
        "modifiedAt": parse_pdf_date(metadata.get("modDate")),
        "isEncrypted": session.encrypted,
        "encryption": metadata.get("encryption") or None,
        "permissions": {name: bool(permissions & flag) for name, flag in _PERMISSIONS.items()},
        "pageSize": {"width": round(first.width, 3), "height": round(first.height, 3)},
    }
