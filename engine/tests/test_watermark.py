"""Watermarks, headers, footers and page numbers."""

import math

import pymupdf
import pytest

from pdfengine.textpages import text_page
from pdfengine.watermark import substitute


@pytest.fixture
def mixed_pdf(tmp_path):
    """Four pages: A4 portrait, A4 landscape, A5, and A4 stored at 90°."""
    doc = pymupdf.open()
    for width, height in ((595, 842), (842, 595), (420, 595), (595, 842)):
        page = doc.new_page(width=width, height=height)
        page.insert_text((60, 120), f"Body {doc.page_count}", fontsize=12)
    doc[3].set_rotation(90)
    path = tmp_path / "mixed.pdf"
    doc.save(path)
    doc.close()
    return str(path)


def lines(app, doc_id, index):
    """[(text, displayed bbox, displayed angle ccw)] of a page."""
    session = app.state.sessions.get(doc_id)
    with session.lock:
        page = session.doc[index]
        matrix = page.rotation_matrix
        result = []
        for block in text_page(page, 0).extractDICT()["blocks"]:
            for line in block.get("lines", []):
                text = "".join(span["text"] for span in line["spans"])
                box = pymupdf.Rect(line["bbox"]) * matrix
                d = pymupdf.Point(line["dir"]) * matrix - pymupdf.Point(0, 0) * matrix
                angle = round(math.degrees(math.atan2(-d.y, d.x))) % 360
                result.append((text, box, angle))
        return result, page.rect


def find(app, doc_id, index, text):
    found, rect = lines(app, doc_id, index)
    matches = [line for line in found if text in line[0]]
    return matches, rect


def watermark(client, doc_id, **body):
    response = client.post(f"/v1/docs/{doc_id}/watermark", json={"kind": "text", **body})
    assert response.status_code == 200, response.text
    return response.json()


def header_footer(client, doc_id, **body):
    response = client.post(f"/v1/docs/{doc_id}/header-footer", json=body)
    assert response.status_code == 200, response.text
    return response.json()


# --- Watermark -----------------------------------------------------------------------------


def test_text_watermark_on_exactly_the_requested_pages(client, app, open_doc, mixed_pdf):
    doc_id = open_doc(mixed_pdf)["docId"]

    result = watermark(client, doc_id, text="DRAFT", pages=[0, 2])

    assert result["undoName"] == "Watermark"
    assert result["dirtyPages"] == [0, 2]
    assert [bool(find(app, doc_id, i, "DRAFT")[0]) for i in range(4)] == [True, False, True, False]


@pytest.mark.parametrize("index", [0, 1, 2, 3])
def test_watermark_is_centred_and_turned_on_every_kind_of_page(
    client, app, open_doc, mixed_pdf, index
):
    doc_id = open_doc(mixed_pdf)["docId"]

    watermark(client, doc_id, text="CONFIDENTIAL", fontSize=40, rotation=45)

    [(_, box, angle)], rect = find(app, doc_id, index, "CONFIDENTIAL")
    assert angle == 45
    # The turned text's box is centred on the page as displayed.
    assert (box.x0 + box.x1) / 2 == pytest.approx(rect.width / 2, abs=3)
    assert (box.y0 + box.y1) / 2 == pytest.approx(rect.height / 2, abs=3)


def test_horizontal_watermark_at_a_corner(client, app, open_doc, mixed_pdf):
    doc_id = open_doc(mixed_pdf)["docId"]

    watermark(client, doc_id, text="TOP", fontSize=20, rotation=0, position="top-right")

    for index in range(4):
        [(_, box, angle)], rect = find(app, doc_id, index, "TOP")
        assert angle == 0
        assert box.x1 == pytest.approx(rect.width - 36, abs=4)
        assert box.y0 == pytest.approx(36, abs=6)


def test_too_large_watermark_is_shrunk_to_fit(client, app, open_doc, mixed_pdf):
    doc_id = open_doc(mixed_pdf)["docId"]

    watermark(
        client, doc_id, text="A VERY LONG WATERMARK TEXT", fontSize=200, rotation=0, pages=[2]
    )

    [(_, box, _angle)], rect = find(app, doc_id, 2, "LONG")
    assert box.x0 >= -1 and box.x1 <= rect.width + 1


def test_watermark_opacity(client, app, open_doc, mixed_pdf):
    doc_id = open_doc(mixed_pdf)["docId"]

    watermark(
        client,
        doc_id,
        text="████",
        fontSize=60,
        rotation=0,
        color="#000000",
        opacity=0.25,
        pages=[0],
    )

    session = app.state.sessions.get(doc_id)
    with session.lock:
        page = session.doc[0]
        pixel = page.get_pixmap().pixel(int(page.rect.width / 2), int(page.rect.height / 2))
    # 25 % black over white is light grey.
    assert all(170 <= channel <= 210 for channel in pixel)


def test_watermark_under_the_content_is_hidden_by_opaque_content(client, app, open_doc, tmp_path):
    doc = pymupdf.open()
    page = doc.new_page(width=300, height=300)
    page.draw_rect(page.rect, color=None, fill=(1, 1, 1))  # opaque white page content
    path = tmp_path / "opaque.pdf"
    doc.save(path)
    doc_id = open_doc(str(path))["docId"]

    watermark(
        client,
        doc_id,
        text="████",
        fontSize=40,
        rotation=0,
        color="#000000",
        opacity=1,
        layer="under",
    )
    session = app.state.sessions.get(doc_id)
    with session.lock:
        under = session.doc[0].get_pixmap().pixel(150, 150)
    client.post(f"/v1/docs/{doc_id}/undo")
    watermark(
        client,
        doc_id,
        text="████",
        fontSize=40,
        rotation=0,
        color="#000000",
        opacity=1,
        layer="over",
    )
    with session.lock:
        over = session.doc[0].get_pixmap().pixel(150, 150)

    assert under == (255, 255, 255)
    assert over == (0, 0, 0)


def test_image_watermark(client, app, open_doc, mixed_pdf, tmp_path):
    picture = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, 200, 100), False)
    picture.set_rect(picture.irect, (0, 0, 255))
    image_path = tmp_path / "logo.png"
    picture.save(image_path)
    doc_id = open_doc(mixed_pdf)["docId"]

    watermark(
        client,
        doc_id,
        kind="image",
        imagePath=str(image_path),
        scale=0.5,
        rotation=0,
        opacity=1,
        pages=[1, 3],
    )

    session = app.state.sessions.get(doc_id)
    with session.lock:
        for index in (1, 3):
            page = session.doc[index]
            pixmap = page.get_pixmap()
            centre = pixmap.pixel(int(page.rect.width / 2), int(page.rect.height / 2))
            assert centre == (0, 0, 255), index
            # Half the page width: just inside and outside its left edge.
            left = page.rect.width / 4
            assert pixmap.pixel(int(left + 3), int(page.rect.height / 2)) == (0, 0, 255)
            assert pixmap.pixel(int(left - 3), int(page.rect.height / 2)) == (255, 255, 255)
        assert session.doc[0].get_pixmap().pixel(297, 421) == (255, 255, 255)


def test_watermark_rejects_bad_input(client, open_doc, mixed_pdf, tmp_path):
    doc_id = open_doc(mixed_pdf)["docId"]
    not_image = tmp_path / "x.png"
    not_image.write_bytes(b"not an image")

    url = f"/v1/docs/{doc_id}/watermark"
    assert client.post(url, json={"kind": "text", "text": "  "}).status_code == 400
    assert client.post(url, json={"kind": "text", "text": "X", "opacity": 0}).status_code == 400
    assert client.post(url, json={"kind": "image"}).status_code == 400
    assert client.post(url, json={"kind": "image", "imagePath": str(not_image)}).status_code == 415
    assert client.post(url, json={"kind": "text", "text": "X", "pages": [9]}).status_code == 400


def test_watermark_is_one_undo_step_also_after_saving(client, app, open_doc, mixed_pdf):
    doc_id = open_doc(mixed_pdf)["docId"]
    watermark(client, doc_id, text="DRAFT")
    client.post(f"/v1/docs/{doc_id}/save", json={})
    with pymupdf.open(mixed_pdf) as saved:
        assert all("DRAFT" in page.get_text() for page in saved)

    client.post(f"/v1/docs/{doc_id}/undo")

    assert not any(find(app, doc_id, i, "DRAFT")[0] for i in range(4))
    client.post(f"/v1/docs/{doc_id}/redo")
    assert all(find(app, doc_id, i, "DRAFT")[0] for i in range(4))


def test_watermark_twice_after_undo(client, app, open_doc, mixed_pdf):
    """A fresh source each time: no stale graft map after an undo."""
    doc_id = open_doc(mixed_pdf)["docId"]
    watermark(client, doc_id, text="ONE")
    client.post(f"/v1/docs/{doc_id}/undo")

    watermark(client, doc_id, text="TWO")

    assert find(app, doc_id, 0, "TWO")[0]
    assert not find(app, doc_id, 0, "ONE")[0]


def test_watermark_preview_leaves_the_document_alone(client, app, open_doc, mixed_pdf):
    doc_id = open_doc(mixed_pdf)["docId"]

    response = client.post(
        f"/v1/docs/{doc_id}/watermark/preview",
        json={"kind": "text", "text": "DRAFT", "page": 3, "previewScale": 0.5},
    )

    assert response.status_code == 200
    assert response.headers["content-type"] == "image/png"
    image = pymupdf.Pixmap(response.content)
    assert (image.width, image.height) == (421, 298)  # the 90° page, displayed, half size
    assert not find(app, doc_id, 3, "DRAFT")[0]
    assert client.get(f"/v1/docs/{doc_id}/state").json()["canUndo"] is False


# --- Header and footer ------------------------------------------------------------------------


def test_tokens():
    assert substitute("Page {page} of {pages}", 3, 9, "2026-11-13", "a.pdf") == "Page 3 of 9"
    assert substitute("{filename} {date}", 1, 1, "13 Nov", "a.pdf") == "a.pdf 13 Nov"
    assert substitute("{unknown} {page", 1, 1, "", "") == "{unknown} {page"


def test_page_numbers_on_exactly_the_requested_pages(client, app, open_doc, mixed_pdf):
    doc_id = open_doc(mixed_pdf)["docId"]

    result = header_footer(
        client, doc_id, footer={"center": "Page {page} of {pages}"}, pages=[1, 2, 3], startNumber=1
    )

    assert result["undoName"] == "Header & Footer"
    assert not find(app, doc_id, 0, "Page ")[0]
    for index, label in ((1, "Page 1 of 3"), (2, "Page 2 of 3"), (3, "Page 3 of 3")):
        matches, _rect = find(app, doc_id, index, label)
        assert len(matches) == 1, index


def test_start_number(client, app, open_doc, mixed_pdf):
    doc_id = open_doc(mixed_pdf)["docId"]

    header_footer(client, doc_id, footer={"right": "{page}/{pages}"}, startNumber=10)

    assert find(app, doc_id, 0, "10/13")[0]
    assert find(app, doc_id, 3, "13/13")[0]


@pytest.mark.parametrize("index", [0, 1, 2, 3])
def test_header_and_footer_positions_on_every_kind_of_page(client, app, open_doc, mixed_pdf, index):
    doc_id = open_doc(mixed_pdf)["docId"]

    header_footer(
        client,
        doc_id,
        header={"left": "LEFT-H", "right": "RIGHT-H"},
        footer={"center": "MID-F"},
        fontSize=10,
    )

    found, rect = lines(app, doc_id, index)
    by_text = {text: (box, angle) for text, box, angle in found}
    left, right, mid = by_text["LEFT-H"], by_text["RIGHT-H"], by_text["MID-F"]
    assert left[1] == right[1] == mid[1] == 0  # upright as displayed
    assert left[0].x0 == pytest.approx(54, abs=1)
    assert right[0].x1 == pytest.approx(rect.width - 54, abs=1)
    assert left[0].y0 == pytest.approx(36, abs=3)
    assert (mid[0].x0 + mid[0].x1) / 2 == pytest.approx(rect.width / 2, abs=1)
    assert mid[0].y1 == pytest.approx(rect.height - 36, abs=4)


def test_filename_and_date_tokens(client, app, open_doc, mixed_pdf):
    doc_id = open_doc(mixed_pdf)["docId"]

    header_footer(
        client, doc_id, header={"center": "{filename} — {date}"}, date="13 November 2026", pages=[0]
    )

    assert find(app, doc_id, 0, "mixed.pdf — 13 November 2026")[0]


def test_text_beyond_latin_1_uses_the_fallback(client, app, open_doc, mixed_pdf):
    doc_id = open_doc(mixed_pdf)["docId"]

    header_footer(client, doc_id, footer={"center": "页 {page} Ω"}, pages=[0, 3])

    for index in (0, 3):
        [(_, box, angle)], rect = find(app, doc_id, index, "Ω")
        assert angle == 0
        assert (box.x0 + box.x1) / 2 == pytest.approx(rect.width / 2, abs=3)
        assert box.y1 <= rect.height - 30


def test_header_footer_needs_some_text(client, open_doc, mixed_pdf):
    doc_id = open_doc(mixed_pdf)["docId"]

    response = client.post(f"/v1/docs/{doc_id}/header-footer", json={"header": {"left": " "}})

    assert response.status_code == 400


def test_header_footer_undo_after_saving(client, app, open_doc, mixed_pdf):
    doc_id = open_doc(mixed_pdf)["docId"]
    header_footer(client, doc_id, footer={"center": "Page {page}"})
    client.post(f"/v1/docs/{doc_id}/save", json={})

    client.post(f"/v1/docs/{doc_id}/undo")

    assert not find(app, doc_id, 0, "Page 1")[0]
    client.post(f"/v1/docs/{doc_id}/redo")
    assert find(app, doc_id, 0, "Page 1")[0]


def test_header_footer_preview(client, app, open_doc, mixed_pdf):
    doc_id = open_doc(mixed_pdf)["docId"]

    response = client.post(
        f"/v1/docs/{doc_id}/header-footer/preview",
        json={"footer": {"center": "Page {page} of {pages}"}, "page": 2, "pages": [1, 2]},
    )

    assert response.status_code == 200
    image = pymupdf.Pixmap(response.content)
    assert (image.width, image.height) == (420, 595)
    assert not find(app, doc_id, 2, "Page")[0]
