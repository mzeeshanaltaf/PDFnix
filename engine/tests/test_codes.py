import numpy as np
import pymupdf
import pytest
import zxingcpp

from .conftest import build_sample

QR_TEXT = "https://example.com/bill?id=7409546"
QR_RECT = pymupdf.Rect(360, 600, 480, 720)


def code_image(
    content, fmt=zxingcpp.BarcodeFormat.QRCode, scale: int = 1, quiet: bool = False
) -> np.ndarray:
    """A code as a grey image, black modules 0, white 255. Without quiet zones
    the image is exactly the symbol, whose corners the engine reports; the white
    page around it serves as the quiet zone."""
    barcode = zxingcpp.create_barcode(content, fmt)
    return np.asarray(barcode.to_image(scale=scale, add_quiet_zones=quiet))


def png(image: np.ndarray) -> bytes:
    height, width = image.shape
    pixmap = pymupdf.Pixmap(pymupdf.csGRAY, width, height, image.tobytes(), False)
    return pixmap.tobytes("png")


def insert_code(page, rect, content, fmt=zxingcpp.BarcodeFormat.QRCode):
    page.insert_image(rect, stream=png(code_image(content, fmt, scale=8)))


def draw_code(page: pymupdf.Page, rect: pymupdf.Rect, content: str) -> None:
    """The code drawn as vector squares, the way many bills are produced."""
    image = code_image(content)
    rows, cols = image.shape
    size = rect.width / cols
    shape = page.new_shape()
    for y in range(rows):
        for x in range(cols):
            if image[y, x] < 128:
                x0, y0 = rect.x0 + x * size, rect.y0 + y * size
                shape.draw_rect(pymupdf.Rect(x0, y0, x0 + size, y0 + size))
    shape.finish(color=None, fill=(0, 0, 0), width=0)
    shape.commit()


def save(doc: pymupdf.Document, path) -> str:
    doc.save(path)
    doc.close()
    return str(path)


def codes_of(client, doc_id, page=0):
    response = client.get(f"/v1/docs/{doc_id}/pages/{page}/codes")
    assert response.status_code == 200, response.text
    return response.json()["codes"]


def near(rect, expected, slack=8.0) -> bool:
    return all(abs(a - b) <= slack for a, b in zip(rect, expected, strict=True))


def test_finds_a_qr_code_placed_as_an_image(client, open_doc, tmp_path):
    doc = build_sample(2)
    insert_code(doc[0], QR_RECT, QR_TEXT)
    doc_id = open_doc(save(doc, tmp_path / "qr.pdf"))["docId"]

    codes = codes_of(client, doc_id)

    assert len(codes) == 1
    code = codes[0]
    assert code["format"] == "QR Code"
    assert code["text"] == QR_TEXT
    assert code["binary"] is False
    assert len(code["quad"]) == 4
    assert near(code["rect"], list(QR_RECT)), code["rect"]


def test_finds_a_qr_code_drawn_as_vectors(client, open_doc, tmp_path):
    doc = build_sample(1)
    draw_code(doc[0], QR_RECT, QR_TEXT)
    doc_id = open_doc(save(doc, tmp_path / "vector.pdf"))["docId"]

    codes = codes_of(client, doc_id)

    assert [c["text"] for c in codes] == [QR_TEXT]
    assert near(codes[0]["rect"], list(QR_RECT)), codes[0]["rect"]


@pytest.mark.parametrize("rotation", [90, 180, 270])
def test_positions_are_in_the_displayed_space(client, open_doc, tmp_path, rotation):
    doc = build_sample(1)
    page = doc[0]
    insert_code(page, QR_RECT, QR_TEXT)
    page.set_rotation(rotation)
    displayed = QR_RECT * page.rotation_matrix
    doc_id = open_doc(save(doc, tmp_path / "rotated.pdf"))["docId"]

    codes = codes_of(client, doc_id)

    assert [c["text"] for c in codes] == [QR_TEXT]
    assert near(codes[0]["rect"], list(displayed)), (codes[0]["rect"], displayed)


def test_positions_follow_an_offset_crop_box(client, open_doc, tmp_path):
    doc = build_sample(1)
    page = doc[0]
    insert_code(page, QR_RECT, QR_TEXT)
    page.set_cropbox(pymupdf.Rect(50, 100, page.rect.x1, page.rect.y1))
    doc_id = open_doc(save(doc, tmp_path / "cropped.pdf"))["docId"]

    codes = codes_of(client, doc_id)

    assert near(codes[0]["rect"], [310, 500, 430, 620]), codes[0]["rect"]


def test_finds_barcodes_and_data_matrix(client, open_doc, tmp_path):
    doc = build_sample(1)
    page = doc[0]
    insert_code(page, pymupdf.Rect(72, 300, 372, 360), "NOV26-7409546", zxingcpp.Code128)
    insert_code(page, pymupdf.Rect(400, 300, 480, 380), "DM-1234", zxingcpp.DataMatrix)
    doc_id = open_doc(save(doc, tmp_path / "barcodes.pdf"))["docId"]

    codes = sorted(codes_of(client, doc_id), key=lambda c: c["format"])

    assert [(c["format"], c["text"]) for c in codes] == [
        ("Code 128", "NOV26-7409546"),
        ("Data Matrix", "DM-1234"),
    ]


def test_finds_a_small_code_inside_a_photo(client, open_doc, tmp_path):
    """A code too small for the first pass is found by the second, sharper one."""
    rng = np.random.default_rng(7)
    photo = rng.integers(150, 230, size=(1200, 1600), dtype=np.uint8)
    small = code_image("meter 3-100499", scale=3, quiet=True)
    photo[500 : 500 + small.shape[0], 700 : 700 + small.shape[1]] = small
    doc = pymupdf.open()
    page = doc.new_page(width=595, height=842)
    page.insert_image(pymupdf.Rect(100, 100, 500, 400), stream=png(photo))
    doc_id = open_doc(save(doc, tmp_path / "photo.pdf"))["docId"]

    codes = codes_of(client, doc_id)

    assert [c["text"] for c in codes] == ["meter 3-100499"]


@pytest.mark.parametrize("rotation", [0, 90])
def test_finds_a_thin_barcode_image_next_to_a_qr_code(client, open_doc, tmp_path, rotation):
    """Like a LESCO bill: a QR code, and a generated barcode image whose bars
    are one pixel wide and come out at about 0.66 pt each, in an image whose
    blank right part reaches past the page's edge. The QR code is found in the
    first pass; the barcode needs the per-picture pass, which must also see
    pictures that overhang the page."""
    content = "L000066g8kooNWe3gWt5rKe0SG[ABQRBQ30o#"
    bars = code_image(content, zxingcpp.Code128, quiet=True)[:1, :]
    bars = np.pad(bars, ((0, 0), (0, 2 * bars.shape[1])), constant_values=255)
    bars = np.ascontiguousarray(np.repeat(bars, 35, axis=0))
    width = bars.shape[1] * 0.66
    doc = build_sample(1)
    page = doc[0]
    assert 260 + width > page.rect.width  # the image overhangs the page
    insert_code(page, QR_RECT, QR_TEXT)
    bar_rect = pymupdf.Rect(260, 760, 260 + width, 783)
    page.insert_image(bar_rect, stream=png(bars), keep_proportion=False)
    page.set_rotation(rotation)
    start = pymupdf.Point(260, 771.5) * page.rotation_matrix
    doc_id = open_doc(save(doc, tmp_path / "bill.pdf"))["docId"]

    codes = {c["format"]: c for c in codes_of(client, doc_id)}

    assert set(codes) == {"QR Code", "Code 128"}
    code = codes["Code 128"]
    assert code["text"] == content
    x0, y0, x1, y1 = code["rect"]
    assert x0 - 12 <= start.x <= x1 + 12 and y0 - 12 <= start.y <= y1 + 12, (code["rect"], start)


@pytest.mark.parametrize("rotation", [90, 270])
def test_codes_in_pictures_on_rotated_pages(client, open_doc, tmp_path, rotation):
    rng = np.random.default_rng(3)
    photo = rng.integers(150, 230, size=(1200, 1600), dtype=np.uint8)
    small = code_image("meter 3-100499", scale=3, quiet=True)
    photo[500 : 500 + small.shape[0], 700 : 700 + small.shape[1]] = small
    doc = pymupdf.open()
    page = doc.new_page(width=595, height=842)
    page.insert_image(pymupdf.Rect(100, 100, 500, 400), stream=png(photo))
    page.set_rotation(rotation)
    # Where the code sits in the photo, in unrotated page points (photo: 4 px per pt).
    placed = pymupdf.Rect(
        100 + 700 / 4,
        100 + 500 / 4,
        100 + (700 + small.shape[1]) / 4,
        100 + (500 + small.shape[0]) / 4,
    )
    displayed = placed * page.rotation_matrix
    doc_id = open_doc(save(doc, tmp_path / "rotated-photo.pdf"))["docId"]

    codes = codes_of(client, doc_id)

    assert [c["text"] for c in codes] == ["meter 3-100499"]
    assert near(codes[0]["rect"], list(displayed), slack=6), (codes[0]["rect"], displayed)


def test_binary_content_is_given_as_hex(client, open_doc, tmp_path):
    doc = build_sample(1)
    insert_code(doc[0], QR_RECT, b"\x00\x01\xff\x10")
    doc_id = open_doc(save(doc, tmp_path / "binary.pdf"))["docId"]

    codes = codes_of(client, doc_id)

    assert codes[0]["binary"] is True
    assert codes[0]["text"] == "00 01 ff 10"


def test_text_page_has_no_codes(client, open_doc, sample_pdf):
    doc_id = open_doc(sample_pdf)["docId"]

    assert codes_of(client, doc_id, page=1) == []


def test_codes_page_out_of_range(client, open_doc, sample_pdf):
    doc_id = open_doc(sample_pdf)["docId"]

    assert client.get(f"/v1/docs/{doc_id}/pages/9/codes").status_code == 404
    assert client.get("/v1/docs/nope/pages/0/codes").status_code == 404
