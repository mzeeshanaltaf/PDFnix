"""Draws PDFnix's icons: `uv run --directory engine python ../scripts/make_icons.py`.

Writes
- build/icon.ico        application icon (16-256 px), used for PDFnix.exe,
                        the installer and the engine executable
- build/icon.png        512 px, for electron-builder
- build/pdf-file.ico    document icon for .pdf files associated with PDFnix
- resources/icon.png    256 px, the window icon in development
- src/renderer/src/assets/app-icon.png   128 px, for the About dialog

The artwork is drawn with PyMuPDF on a 256 x 256 point page and rendered at
each size; the smallest sizes use simpler drawings so they stay legible.
ICO entries up to 128 px are 32-bit bitmaps and the 256 px entry is PNG, the
layout every Windows tool accepts.
"""

import struct
from collections.abc import Callable
from pathlib import Path

import pymupdf

ROOT = Path(__file__).resolve().parent.parent
SIZES = [16, 20, 24, 32, 40, 48, 64, 96, 128, 256]

RED = (0xD7 / 255, 0x39 / 255, 0x2B / 255)
INK = (0x4A / 255, 0x4E / 255, 0x53 / 255)
FOLD = (0xF5 / 255, 0xC0 / 255, 0xB8 / 255)
WHITE = (1, 1, 1)
LINE = (0x9A / 255, 0xA0 / 255, 0xA6 / 255)
YELLOW = (0xFF / 255, 0xD5 / 255, 0x4A / 255)
OUTLINE = (0x80 / 255, 0x86 / 255, 0x8B / 255)
FOLD_GREY = (0xDA / 255, 0xDC / 255, 0xE0 / 255)

Draw = Callable[[pymupdf.Page, int], None]


def app_icon(page: pymupdf.Page, size: int) -> None:
    """Red rounded square with a white page; text lines, one highlighted, from 32 px."""
    shape = page.new_shape()
    inset = 8 if size >= 32 else 4
    shape.draw_rect(pymupdf.Rect(inset, inset, 256 - inset, 256 - inset), radius=0.2)
    shape.finish(fill=RED, color=None)
    # Page with a folded corner.
    left, top, right, bottom, fold = 66, 36, 190, 220, 40
    if size < 32:
        left, top, right, bottom, fold = 58, 30, 198, 226, 48
    shape.draw_polyline(
        [
            (left, top),
            (right - fold, top),
            (right, top + fold),
            (right, bottom),
            (left, bottom),
            (left, top),
        ]
    )
    shape.finish(fill=WHITE, color=None, closePath=True)
    shape.draw_polyline([(right - fold, top), (right - fold, top + fold), (right, top + fold)])
    shape.finish(fill=FOLD, color=None, closePath=True)
    if size >= 32:
        # Highlight behind the second line, then four lines of "text".
        shape.draw_rect(pymupdf.Rect(84, 108, 172, 132))
        shape.finish(fill=YELLOW, color=None)
        for y, end in ((92, 150), (120, 168), (148, 172), (176, 140)):
            shape.draw_line((92, y), (end, y))
            shape.finish(color=LINE if y != 120 else INK, width=10, lineCap=1)
    elif size >= 20:
        for y in (110, 150):
            shape.draw_line((88, y), (168, y))
            shape.finish(color=LINE, width=18, lineCap=1)
    shape.commit()


def pdf_file_icon(page: pymupdf.Page, size: int) -> None:
    """A page with a folded corner and a red "PDF" band."""
    shape = page.new_shape()
    small = size < 32
    left, top, right, bottom, fold = (44, 12, 212, 244, 52) if not small else (36, 8, 220, 248, 60)
    stroke = 6 if not small else 14
    shape.draw_polyline(
        [
            (left, top),
            (right - fold, top),
            (right, top + fold),
            (right, bottom),
            (left, bottom),
            (left, top),
        ]
    )
    shape.finish(fill=WHITE, color=OUTLINE, width=stroke, closePath=True, lineJoin=1)
    shape.draw_polyline([(right - fold, top), (right - fold, top + fold), (right, top + fold)])
    shape.finish(fill=FOLD_GREY, color=OUTLINE, width=stroke, closePath=True, lineJoin=1)
    band = pymupdf.Rect(20, 132, 196, 204) if not small else pymupdf.Rect(12, 120, 204, 216)
    shape.draw_rect(band, radius=0.12)
    shape.finish(fill=RED, color=None)
    if not small:
        for y in (56, 84, 108):
            shape.draw_line((76, y), (160 if y != 56 else 128, y))
            shape.finish(color=LINE, width=9, lineCap=1)
        for y in (226,):
            shape.draw_line((76, y), (180, y))
            shape.finish(color=LINE, width=9, lineCap=1)
    shape.commit()
    if not small:
        # "PDF" in white bold, centred in the band.
        font = pymupdf.Font("hebo")
        fontsize = 50
        width = font.text_length("PDF", fontsize=fontsize)
        x = band.x0 + (band.width - width) / 2
        y = band.y0 + band.height / 2 + fontsize * 0.36
        page.insert_text((x, y), "PDF", fontname="hebo", fontsize=fontsize, color=WHITE)


def render(draw: Draw, size: int) -> pymupdf.Pixmap:
    doc = pymupdf.open()
    page = doc.new_page(width=256, height=256)
    draw(page, size)
    return page.get_pixmap(matrix=pymupdf.Matrix(size / 256, size / 256), alpha=True)


def straight_bgra(pix: pymupdf.Pixmap) -> bytes:
    """Bottom-up BGRA rows with straight (not premultiplied) alpha."""
    data = pix.samples
    rows = []
    for y in range(pix.height - 1, -1, -1):
        row = bytearray()
        for x in range(pix.width):
            i = (y * pix.width + x) * 4
            r, g, b, a = data[i], data[i + 1], data[i + 2], data[i + 3]
            if 0 < a < 255:
                r, g, b = (min(255, round(c * 255 / a)) for c in (r, g, b))
            row += bytes((b, g, r, a))
        rows.append(bytes(row))
    return b"".join(rows)


def bmp_entry(pix: pymupdf.Pixmap) -> bytes:
    width, height = pix.width, pix.height
    header = struct.pack("<IiiHHIIiiII", 40, width, height * 2, 1, 32, 0, 0, 0, 0, 0, 0)
    mask_row = ((width + 31) // 32) * 4
    return header + straight_bgra(pix) + bytes(mask_row * height)


def write_ico(path: Path, draw: Draw) -> None:
    entries = []
    for size in SIZES:
        pix = render(draw, size)
        data = pix.tobytes("png") if size >= 256 else bmp_entry(pix)
        entries.append((size, data))
    offset = 6 + 16 * len(entries)
    directory = b""
    for size, data in entries:
        dim = 0 if size >= 256 else size
        directory += struct.pack("<BBBBHHII", dim, dim, 0, 0, 1, 32, len(data), offset)
        offset += len(data)
    path.write_bytes(
        struct.pack("<HHH", 0, 1, len(entries)) + directory + b"".join(d for _, d in entries)
    )
    print(f"{path.relative_to(ROOT)}: {len(entries)} sizes, {path.stat().st_size:,} bytes")


def write_png(path: Path, draw: Draw, size: int) -> None:
    render(draw, size).save(str(path))
    print(f"{path.relative_to(ROOT)}: {size} px")


def main() -> None:
    write_ico(ROOT / "build" / "icon.ico", app_icon)
    write_png(ROOT / "build" / "icon.png", app_icon, 512)
    write_ico(ROOT / "build" / "pdf-file.ico", pdf_file_icon)
    write_png(ROOT / "resources" / "icon.png", app_icon, 256)
    write_png(ROOT / "src" / "renderer" / "src" / "assets" / "app-icon.png", app_icon, 128)


if __name__ == "__main__":
    main()
