"""Sample PDFs for the end-to-end tests (run by global-setup.ts with the
engine's Python): `python make_fixtures.py <folder>`.

- report.pdf  12 pages, "Chapter n" headings, an outline, the word
              "aardvark" on pages 3 and 9, a known sentence on page 1
- pages.pdf   3 pages that say "Alpha", "Bravo", "Charlie"
- form.pdf    a text field "Full name" and a checkbox "Agree"
- scan.pdf    one page that is only a picture of text (for OCR)
"""

import sys
from pathlib import Path

import pymupdf

SENTENCE = "The quick brown fox jumps over the lazy dog"


def report(path: Path) -> None:
    doc = pymupdf.open()
    toc = []
    for n in range(1, 13):
        page = doc.new_page(width=612, height=792)
        page.insert_text((72, 90), f"Chapter {n}", fontsize=24)
        y = 140
        lines = [
            SENTENCE if n == 1 else f"This is the body text of chapter {n}.",
            "A second line follows the first one on this page.",
        ]
        if n in (3, 9):
            lines.append("An aardvark appears on this page.")
        for line in lines:
            page.insert_text((72, y), line, fontsize=14)
            y += 28
        toc.append([1, f"Chapter {n}", n])
    doc.set_toc(toc)
    doc.save(path)


def pages(path: Path) -> None:
    doc = pymupdf.open()
    for word in ("Alpha", "Bravo", "Charlie"):
        doc.new_page(width=612, height=792).insert_text((72, 120), word, fontsize=48)
    doc.save(path)


def form(path: Path) -> None:
    doc = pymupdf.open()
    page = doc.new_page(width=612, height=792)
    page.insert_text((72, 90), "Application form", fontsize=20)
    name = pymupdf.Widget()
    name.field_type = pymupdf.PDF_WIDGET_TYPE_TEXT
    name.field_name = "fullName"
    name.field_label = "Full name"
    name.rect = pymupdf.Rect(72, 120, 360, 144)
    name.text_fontsize = 12
    page.add_widget(name)
    agree = pymupdf.Widget()
    agree.field_type = pymupdf.PDF_WIDGET_TYPE_CHECKBOX
    agree.field_name = "agree"
    agree.field_label = "Agree"
    agree.rect = pymupdf.Rect(72, 170, 90, 188)
    page.add_widget(agree)
    doc.save(path)


def scan(path: Path) -> None:
    source = pymupdf.open()
    page = source.new_page(width=612, height=792)
    page.insert_text((72, 120), "Invoice number 4471 for Rosalind", fontsize=22)
    page.insert_text((72, 180), SENTENCE, fontsize=16)
    picture = page.get_pixmap(dpi=200)
    doc = pymupdf.open()
    doc.new_page(width=612, height=792).insert_image(pymupdf.Rect(0, 0, 612, 792), pixmap=picture)
    doc.save(path)


def long_scan(path: Path) -> None:
    """30 picture-only pages: OCR takes long enough to be interrupted."""
    source = pymupdf.open()
    page = source.new_page(width=612, height=792)
    for line in range(20):
        page.insert_text((72, 90 + line * 32), f"Line {line + 1}: {SENTENCE}", fontsize=14)
    picture = page.get_pixmap(dpi=150)
    doc = pymupdf.open()
    for _ in range(30):
        doc.new_page(width=612, height=792).insert_image(
            pymupdf.Rect(0, 0, 612, 792), pixmap=picture
        )
    doc.save(path)


def corpus(folder: Path) -> None:
    """Malformed and unusual files (corpus/): each must open or be refused
    with a clear message, never crash the app or the engine."""
    folder.mkdir(exist_ok=True)
    report(folder / "_source.pdf")
    good = (folder / "_source.pdf").read_bytes()

    # Cross-reference offsets pointing nowhere: MuPDF repairs the file.
    damaged = bytearray(good)
    start = good.rindex(b"startxref") + len(b"startxref")
    damaged[start : start + 12] = b"\n 999999999\n"[: min(12, len(damaged) - start)]
    (folder / "damaged-xref.pdf").write_bytes(bytes(damaged))
    (folder / "truncated.pdf").write_bytes(good[: len(good) * 6 // 10])
    (folder / "not-a-pdf.pdf").write_bytes(b"This is a text file with a .pdf name.\r\n" * 20)
    (folder / "empty.pdf").write_bytes(b"")
    (folder / "_source.pdf").unlink()

    doc = pymupdf.open()
    doc.new_page(width=20, height=20).insert_text((2, 12), "tiny", fontsize=6)
    doc.new_page(width=14400, height=14400).insert_text((200, 400), "huge", fontsize=200)
    doc.new_page(width=2000, height=200).insert_text((20, 120), "very wide", fontsize=60)
    doc.save(folder / "page-sizes.pdf")

    doc = pymupdf.open()
    page = doc.new_page(width=612, height=792)
    page.insert_htmlbox(
        pymupdf.Rect(72, 72, 540, 400),
        '<p dir="rtl" style="font-size:20px">مرحبا بالعالم، هذا نص عربي.</p>'
        '<p dir="rtl" style="font-size:20px">שלום עולם, זה טקסט בעברית.</p>',
    )
    doc.save(folder / "right-to-left.pdf")

    doc = pymupdf.open()
    page = doc.new_page(width=612, height=792)
    shape = page.new_shape()
    for i in range(20_000):
        x = (i * 37) % 600
        y = (i * 53) % 780
        shape.draw_line((x, y), (x + (i % 13), y + (i % 17)))
    shape.finish(color=(0.2, 0.3, 0.6), width=0.3)
    shape.commit()
    doc.save(folder / "heavy-vectors.pdf")

    doc = pymupdf.open()
    doc.new_page(width=612, height=792).insert_text((72, 90), "Portfolio cover", fontsize=20)
    doc.embfile_add("notes.txt", b"embedded text file", filename="notes.txt")
    doc.embfile_add("inner.pdf", good, filename="inner.pdf")
    catalog = doc.pdf_catalog()
    doc.xref_set_key(catalog, "Collection", "<</Type/Collection/View/D>>")
    doc.save(folder / "portfolio.pdf")


def main() -> None:
    folder = Path(sys.argv[1])
    folder.mkdir(parents=True, exist_ok=True)
    for name, make in (
        ("report", report),
        ("pages", pages),
        ("form", form),
        ("scan", scan),
        ("long-scan", long_scan),
    ):
        make(folder / f"{name}.pdf")
    corpus(folder / "corpus")
    print(f"fixtures written to {folder}")


if __name__ == "__main__":
    main()
