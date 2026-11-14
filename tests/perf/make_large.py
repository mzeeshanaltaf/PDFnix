"""A large PDF for the performance check: `python make_large.py <path> [pages]`.

Every page carries its own picture of random noise (JPEG, which compresses
noise badly), so the file is about half a gigabyte for 1,000 pages and no two
pages share data. Each page also has a line of text to search for.
"""

import os
import sys

import pymupdf

WIDTH, HEIGHT = 760, 980


def main() -> None:
    path = sys.argv[1]
    pages = int(sys.argv[2]) if len(sys.argv) > 2 else 1000
    if os.path.exists(path) and os.path.getsize(path) > 400_000_000:
        print(f"{path} exists ({os.path.getsize(path):,} bytes)")
        return
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    doc = pymupdf.open()
    for number in range(1, pages + 1):
        noise = pymupdf.Pixmap(pymupdf.csRGB, WIDTH, HEIGHT, os.urandom(WIDTH * HEIGHT * 3), 0)
        page = doc.new_page(width=612, height=792)
        page.insert_image(
            pymupdf.Rect(36, 72, 576, 756), stream=noise.tobytes("jpeg", jpg_quality=80)
        )
        page.insert_text((36, 50), f"Large file page {number}", fontsize=18)
    doc.save(path)
    print(f"{path}: {pages} pages, {os.path.getsize(path):,} bytes")


if __name__ == "__main__":
    main()
