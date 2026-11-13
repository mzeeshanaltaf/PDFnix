"""Editing page content: blocks, replacing and deleting text, images (phase 4)."""

import base64
import os

import pymupdf
import pytest

from pdfengine.textpages import content_image_rects, content_text_page

from .conftest import PAGE_HEIGHT, PAGE_WIDTH

GEORGIA = r"C:\Windows\Fonts\georgia.ttf"
RED = (255, 0, 0)
BLUE = (0, 0, 255)


def words_of(path, page_index):
    """Words of the saved file's page, displayed space."""
    with pymupdf.open(path) as doc:
        page = doc[page_index]
        matrix = page.rotation_matrix
        return [
            (word[4], pymupdf.Rect(word[:4]) * matrix)
            for word in content_text_page(page, 0).extractWORDS()
        ]


def text_of(path, page_index):
    return " ".join(word for word, _ in words_of(path, page_index))


def find_word(client, doc_id, page, word):
    """The displayed box of the first ``word`` on ``page``."""
    blocks = client.get(f"/v1/docs/{doc_id}/pages/{page}/blocks").json()["blocks"]
    for block in blocks:
        for line in block["lines"]:
            if any(word in span["text"] for span in line["spans"]):
                return block, line
    raise AssertionError(f"{word!r} not found")


def save(client, doc_id):
    response = client.post(f"/v1/docs/{doc_id}/save", json={})
    assert response.status_code == 200, response.text


def replace(client, doc_id, page, bbox, text, **extra):
    response = client.post(
        f"/v1/docs/{doc_id}/pages/{page}/text/replace", json={"bbox": bbox, "text": text, **extra}
    )
    assert response.status_code == 200, response.text
    return response.json()


def png(width=20, height=10, alpha=True):
    """Left half red, right half blue; half transparent if ``alpha``."""
    samples = bytearray()
    for _y in range(height):
        for x in range(width):
            samples += bytes(RED if x < width // 2 else BLUE)
            if alpha:
                samples.append(128)
    return pymupdf.Pixmap(pymupdf.csRGB, width, height, bytes(samples), alpha).tobytes("png")


def insert(client, doc_id, page, rect, data, **extra):
    return client.post(
        f"/v1/docs/{doc_id}/pages/{page}/images",
        json={"rect": rect, "data": base64.b64encode(data).decode(), **extra},
    )


@pytest.fixture
def background_pdf(tmp_path):
    """Text over a full-page picture, plus a small logo."""
    doc = pymupdf.open()
    page = doc.new_page(width=PAGE_WIDTH, height=PAGE_HEIGHT)
    paper = pymupdf.Pixmap(pymupdf.csRGB, 8, 8, bytes([240, 230, 200] * 64), False)
    logo = pymupdf.Pixmap(pymupdf.csRGB, 8, 8, bytes([20, 20, 160] * 64), False)
    page.insert_image(page.rect, pixmap=paper, keep_proportion=False)
    page.insert_image(pymupdf.Rect(400, 60, 500, 160), pixmap=logo, keep_proportion=False)
    page.insert_text((72, 100), "Words over a picture", fontsize=12)
    path = tmp_path / "background.pdf"
    doc.save(path)
    doc.close()
    return str(path)


def font_pdf(tmp_path, subset):
    if not os.path.exists(GEORGIA):
        pytest.skip("Georgia is not installed")
    doc = pymupdf.open()
    page = doc.new_page(width=PAGE_WIDTH, height=PAGE_HEIGHT)
    page.insert_font(fontname="F1", fontfile=GEORGIA)
    page.insert_text((72, 100), "Georgia sample text", fontname="F1", fontsize=14)
    if subset:
        doc.subset_fonts()
    path = tmp_path / ("subset.pdf" if subset else "embedded.pdf")
    doc.save(path, garbage=3)
    doc.close()
    return str(path)


# --- Blocks ------------------------------------------------------------------


def test_blocks_list_text_and_images_of_the_page_content(client, open_doc, background_pdf):
    doc_id = open_doc(background_pdf)["docId"]
    client.post(
        f"/v1/docs/{doc_id}/annotations",
        json={
            "type": "freetext",
            "page": 0,
            "rect": [72, 300, 300, 340],
            "text": "Annotation text",
            "color": "#000000",
        },
    )

    body = client.get(f"/v1/docs/{doc_id}/pages/0/blocks").json()

    assert [block["text"] for block in body["blocks"]] == ["Words over a picture"]
    block = body["blocks"][0]
    assert block["angle"] == 0
    span = block["lines"][0]["spans"][0]
    assert span["size"] == 12 and span["color"] == "#000000"
    assert block["bbox"][0] == pytest.approx(72, abs=0.5)
    assert block["bbox"][1] < 100 < block["bbox"][3]
    rects = sorted(image["bbox"] for image in body["images"])
    assert rects == [[0, 0, PAGE_WIDTH, PAGE_HEIGHT], [400, 60, 500, 160]]


@pytest.mark.parametrize("page", [0, 1, 2, 3])
def test_block_boxes_are_in_displayed_space(client, open_doc, rotated_pdf, page):
    doc_id = open_doc(rotated_pdf)["docId"]
    hits = client.post(f"/v1/docs/{doc_id}/search", json={"query": "Heading"}).json()["hits"]
    quad = next(hit["quads"][0] for hit in hits if hit["page"] == page)

    block, _ = find_word(client, doc_id, page, "Heading")

    # The fixture's text turns with its page.
    assert block["angle"] == (0, 90, 180, 270)[page]
    x0, y0, x1, y1 = block["bbox"]
    assert x0 - 1 <= min(quad[0::2]) and max(quad[0::2]) <= x1 + 1
    assert y0 - 1 <= min(quad[1::2]) and max(quad[1::2]) <= y1 + 1


# --- Replacing and deleting text ---------------------------------------------


@pytest.mark.parametrize("page", [0, 1, 2, 3])
def test_replacing_text(client, open_doc, rotated_pdf, page):
    doc_id = open_doc(rotated_pdf)["docId"]
    _, line = find_word(client, doc_id, page, "quick")

    body = replace(client, doc_id, page, line["bbox"], "The slow green Turtle crawls home.")

    assert body["dirtyPages"] == [page]
    assert body["undoName"] == "Edit Text"
    assert body["substituted"] is False
    assert body["fontScale"] == 1
    save(client, doc_id)
    text = text_of(rotated_pdf, page)
    assert "quick" not in text and "Turtle" in text
    # Neighbouring lines are untouched.
    assert "Heading of page" in text and "fox foxes Foxtrot outfox" in text
    # The new line starts where the old one did and sits on the same band,
    # in the line's own reading direction (the fixture's text turns with the page).
    block, new = find_word(client, doc_id, page, "Turtle")
    assert len(block["lines"]) == 1
    old, now = line["bbox"], new["bbox"]
    start, across = {0: (0, (1, 3)), 90: (1, (0, 2)), 180: (2, (1, 3)), 270: (3, (0, 2))}[
        block["angle"]
    ]
    assert now[start] == pytest.approx(old[start], abs=2)
    assert now[across[0]] == pytest.approx(old[across[0]], abs=3)
    assert now[across[1]] == pytest.approx(old[across[1]], abs=3)


def test_replaced_text_keeps_size_and_colour(client, open_doc, tmp_path):
    doc = pymupdf.open()
    page = doc.new_page()
    page.insert_text((72, 100), "Coloured words here", fontsize=20, color=(0.8, 0, 0))
    path = str(tmp_path / "coloured.pdf")
    doc.save(path)
    doc_id = open_doc(path)["docId"]
    block, _ = find_word(client, doc_id, 0, "Coloured")

    replace(client, doc_id, 0, block["bbox"], "Changed words")

    after, _ = find_word(client, doc_id, 0, "Changed")
    span = after["lines"][0]["spans"][0]
    assert span["size"] == 20
    assert span["color"] == "#cc0000"


def test_replacing_text_over_a_picture_keeps_the_picture(client, open_doc, background_pdf):
    doc_id = open_doc(background_pdf)["docId"]
    block, _ = find_word(client, doc_id, 0, "Words")
    images_before = client.get(f"/v1/docs/{doc_id}/pages/0/blocks").json()["images"]

    replace(client, doc_id, 0, block["bbox"], "New words")

    body = client.get(f"/v1/docs/{doc_id}/pages/0/blocks").json()
    assert body["images"] == images_before
    save(client, doc_id)
    with pymupdf.open(background_pdf) as doc:
        pixmap = doc[0].get_pixmap()
        # Paper colour shows where the old words were and nothing was painted.
        assert pixmap.pixel(300, 96) == (240, 230, 200)
    assert text_of(background_pdf, 0) == "New words"


def test_deleting_text_leaves_no_remnant(client, open_doc, sample_pdf):
    doc_id = open_doc(sample_pdf)["docId"]
    block, line = find_word(client, doc_id, 0, "quick")

    body = client.post(
        f"/v1/docs/{doc_id}/pages/0/objects/delete", json={"bbox": line["bbox"], "kind": "text"}
    ).json()

    assert body["undoName"] == "Delete Text"
    save(client, doc_id)
    text = text_of(sample_pdf, 0)
    assert "quick" not in text and "lazy" not in text
    assert "Heading of page 1" in text and "fox foxes" in text


def test_replacing_with_nothing_deletes(client, open_doc, sample_pdf):
    doc_id = open_doc(sample_pdf)["docId"]
    _, line = find_word(client, doc_id, 0, "quick")

    body = replace(client, doc_id, 0, line["bbox"], "")

    assert body["undoName"] == "Delete Text"
    assert "font" not in body
    assert "quick" not in client.get(f"/v1/docs/{doc_id}/pages/0/text").text


def test_replacing_where_there_is_no_text(client, open_doc, sample_pdf):
    doc_id = open_doc(sample_pdf)["docId"]
    response = client.post(
        f"/v1/docs/{doc_id}/pages/0/text/replace", json={"bbox": [300, 600, 400, 700], "text": "x"}
    )
    assert response.status_code == 404
    assert client.get(f"/v1/docs/{doc_id}/state").json()["canUndo"] is False


def test_longer_text_grows_the_box_into_free_space(client, open_doc, tmp_path):
    doc = pymupdf.open()
    page = doc.new_page()
    page.insert_text((72, 100), "Short line", fontsize=12)
    path = str(tmp_path / "grow.pdf")
    doc.save(path)
    doc_id = open_doc(path)["docId"]
    block, _ = find_word(client, doc_id, 0, "Short")
    long_text = "A much longer sentence that cannot possibly fit on the short line " * 2

    body = replace(client, doc_id, 0, block["bbox"], long_text)

    assert body["fontScale"] == 1
    assert body["rect"][3] > block["bbox"][3] + 10
    blocks = client.get(f"/v1/docs/{doc_id}/pages/0/blocks").json()["blocks"]
    assert len(blocks[0]["lines"]) >= 2
    assert blocks[0]["lines"][0]["spans"][0]["size"] == 12


def test_longer_text_shrinks_when_there_is_no_room(client, open_doc, tmp_path):
    doc = pymupdf.open()
    page = doc.new_page()
    page.insert_text((72, 100), "Short line", fontsize=12)
    page.insert_text((72, 116), "Blocking line right below", fontsize=12)
    path = str(tmp_path / "shrink.pdf")
    doc.save(path)
    doc_id = open_doc(path)["docId"]
    _, line = find_word(client, doc_id, 0, "Short")

    body = replace(client, doc_id, 0, line["bbox"], "A considerably longer replacement text here")

    assert body["fontScale"] < 1
    text = client.get(f"/v1/docs/{doc_id}/pages/0/text").text
    assert "Blocking" in text and "replacement" in text


def test_style_can_be_overridden(client, open_doc, sample_pdf):
    doc_id = open_doc(sample_pdf)["docId"]
    _, line = find_word(client, doc_id, 0, "quick")

    replace(
        client,
        doc_id,
        0,
        line["bbox"],
        "Bold serif",
        fontFamily="serif",
        bold=True,
        fontSize=16,
        color="#0000FF",
    )

    _, after = find_word(client, doc_id, 0, "Bold")
    span = after["spans"][0]
    assert "Bold" in span["font"] and "Roman" in span["font"]
    assert span["size"] == 16 and span["color"] == "#0000ff"


def test_embedded_font_is_reused_when_it_has_the_glyphs(client, open_doc, tmp_path):
    doc_id = open_doc(font_pdf(tmp_path, subset=False))["docId"]
    block, _ = find_word(client, doc_id, 0, "Georgia")

    body = replace(client, doc_id, 0, block["bbox"], "Zany quiz")

    assert body["substituted"] is False
    assert body["font"] == "Georgia Regular"
    _, line = find_word(client, doc_id, 0, "Zany")
    assert "Georgia" in line["spans"][0]["font"]


def test_subset_font_falls_back_and_says_so(client, open_doc, tmp_path):
    doc_id = open_doc(font_pdf(tmp_path, subset=True))["docId"]
    block, _ = find_word(client, doc_id, 0, "Georgia")

    body = replace(client, doc_id, 0, block["bbox"], "Zany quiz")

    assert body["substituted"] is True
    assert body["font"].startswith("Serif")
    _, line = find_word(client, doc_id, 0, "Zany")
    assert "Roman" in line["spans"][0]["font"]


def test_standard_fonts_are_not_reported_as_substituted(client, open_doc, sample_pdf):
    doc_id = open_doc(sample_pdf)["docId"]
    _, line = find_word(client, doc_id, 0, "quick")
    assert replace(client, doc_id, 0, line["bbox"], "x")["substituted"] is False


def test_text_edits_undo_and_redo_after_save(client, open_doc, sample_pdf):
    doc_id = open_doc(sample_pdf)["docId"]
    _, line = find_word(client, doc_id, 0, "quick")
    replace(client, doc_id, 0, line["bbox"], "Replaced")
    save(client, doc_id)

    body = client.post(f"/v1/docs/{doc_id}/undo").json()

    assert body["undone"] == "Edit Text"
    text = client.get(f"/v1/docs/{doc_id}/pages/0/text").text
    assert "quick" in text and "Replaced" not in text
    client.post(f"/v1/docs/{doc_id}/redo")
    text = client.get(f"/v1/docs/{doc_id}/pages/0/text").text
    assert "quick" not in text and "Replaced" in text


# --- Images ------------------------------------------------------------------


@pytest.mark.parametrize("page", [0, 1, 2, 3])
def test_inserted_png_keeps_alpha_and_lands_at_the_rect(client, open_doc, rotated_pdf, page):
    doc_id = open_doc(rotated_pdf)["docId"]
    rect = [300, 400, 400, 450]

    response = insert(client, doc_id, page, rect, png())

    assert response.status_code == 200, response.text
    assert response.json()["undoName"] == "Image"
    images = client.get(f"/v1/docs/{doc_id}/pages/{page}/blocks").json()["images"]
    assert [image["bbox"] for image in images] == [pytest.approx(rect, abs=0.5)]
    save(client, doc_id)
    with pymupdf.open(rotated_pdf) as doc:
        xref = doc[page].get_images()[0][0]
        assert doc.extract_image(xref)["smask"] > 0
        pixmap = doc[page].get_pixmap()
        # Upright: red on the left, blue on the right, blended with white.
        left, right = pixmap.pixel(320, 425), pixmap.pixel(380, 425)
        assert left[0] > 200 and left[2] < 160
        assert right[2] > 200 and right[0] < 160


def test_image_rotation_is_clockwise(client, open_doc, sample_pdf):
    doc_id = open_doc(sample_pdf)["docId"]

    insert(client, doc_id, 0, [300, 400, 350, 500], png(alpha=False), rotation=90)

    save(client, doc_id)
    with pymupdf.open(sample_pdf) as doc:
        pixmap = doc[0].get_pixmap()
        # Turned clockwise, the left (red) half is on top.
        assert pixmap.pixel(325, 420) == RED
        assert pixmap.pixel(325, 480) == BLUE


def test_image_on_several_pages_is_one_step(client, open_doc, sample_pdf):
    doc_id = open_doc(sample_pdf)["docId"]

    body = insert(
        client, doc_id, 0, [500, 740, 560, 770], png(), pages=[1, 2], label="Initials"
    ).json()

    assert body["dirtyPages"] == [0, 1, 2]
    assert body["undoName"] == "Initials"
    for page in range(3):
        assert len(client.get(f"/v1/docs/{doc_id}/pages/{page}/blocks").json()["images"]) == 1
    client.post(f"/v1/docs/{doc_id}/undo")
    for page in range(3):
        assert client.get(f"/v1/docs/{doc_id}/pages/{page}/blocks").json()["images"] == []


def test_image_is_moved_onto_a_smaller_page(client, open_doc, tmp_path):
    doc = pymupdf.open()
    doc.new_page(width=600, height=800)
    doc.new_page(width=300, height=400)
    path = str(tmp_path / "sizes.pdf")
    doc.save(path)
    doc_id = open_doc(path)["docId"]

    insert(client, doc_id, 0, [500, 700, 580, 760], png(), pages=[1])

    images = client.get(f"/v1/docs/{doc_id}/pages/1/blocks").json()["images"]
    assert images[0]["bbox"] == pytest.approx([220, 340, 300, 400], abs=0.5)


def test_svg_is_inserted(client, open_doc, sample_pdf):
    doc_id = open_doc(sample_pdf)["docId"]
    svg = (
        b'<svg xmlns="http://www.w3.org/2000/svg" width="100" height="50">'
        b'<rect width="100" height="50" fill="#00ff00"/></svg>'
    )

    response = insert(client, doc_id, 0, [300, 400, 400, 450], svg)

    assert response.status_code == 200, response.text
    save(client, doc_id)
    with pymupdf.open(sample_pdf) as doc:
        assert doc[0].get_pixmap().pixel(350, 425) == (0, 255, 0)


def test_unsupported_images_are_refused(client, open_doc, sample_pdf):
    doc_id = open_doc(sample_pdf)["docId"]
    webp = base64.b64decode("UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==")

    response = insert(client, doc_id, 0, [1, 1, 50, 50], webp)

    assert response.status_code == 415
    assert response.json()["error"]["code"] == "unsupported_image"


def test_deleting_one_image_keeps_the_picture_under_it(client, open_doc, background_pdf):
    doc_id = open_doc(background_pdf)["docId"]

    body = client.post(
        f"/v1/docs/{doc_id}/pages/0/objects/delete",
        json={"bbox": [400, 60, 500, 160], "kind": "image"},
    ).json()

    assert body["undoName"] == "Delete Image"
    images = client.get(f"/v1/docs/{doc_id}/pages/0/blocks").json()["images"]
    assert [image["bbox"] for image in images] == [[0, 0, PAGE_WIDTH, PAGE_HEIGHT]]
    assert "picture" in client.get(f"/v1/docs/{doc_id}/pages/0/text").text
    client.post(f"/v1/docs/{doc_id}/undo")
    assert len(client.get(f"/v1/docs/{doc_id}/pages/0/blocks").json()["images"]) == 2


def test_deleting_an_image_on_a_rotated_page(client, open_doc, rotated_pdf):
    doc_id = open_doc(rotated_pdf)["docId"]
    insert(client, doc_id, 1, [300, 400, 400, 450], png())

    response = client.post(
        f"/v1/docs/{doc_id}/pages/1/objects/delete",
        json={"bbox": [300, 400, 400, 450], "kind": "image"},
    )

    assert response.status_code == 200, response.text
    assert client.get(f"/v1/docs/{doc_id}/pages/1/blocks").json()["images"] == []


def test_deleting_where_there_is_no_image(client, open_doc, sample_pdf):
    doc_id = open_doc(sample_pdf)["docId"]
    response = client.post(
        f"/v1/docs/{doc_id}/pages/0/objects/delete",
        json={"bbox": [10, 10, 50, 50], "kind": "image"},
    )
    assert response.status_code == 404


def test_image_insert_undoes_after_save(client, open_doc, sample_pdf):
    doc_id = open_doc(sample_pdf)["docId"]
    insert(client, doc_id, 0, [300, 400, 400, 450], png())
    save(client, doc_id)

    client.post(f"/v1/docs/{doc_id}/undo")

    assert client.get(f"/v1/docs/{doc_id}/pages/0/blocks").json()["images"] == []
    client.post(f"/v1/docs/{doc_id}/redo")
    assert len(client.get(f"/v1/docs/{doc_id}/pages/0/blocks").json()["images"]) == 1


# --- Fonts -------------------------------------------------------------------


def test_fonts_lists_built_in_and_document_fonts(client, open_doc, tmp_path):
    builtin = client.get("/v1/fonts").json()
    assert [font["id"] for font in builtin] == ["sans", "serif", "mono"]

    doc_id = open_doc(font_pdf(tmp_path, subset=True))["docId"]
    fonts = client.get("/v1/fonts", params={"doc": doc_id}).json()

    document = [font for font in fonts if font["kind"] == "document"]
    assert [(font["name"], font["subset"]) for font in document] == [("Georgia Regular", True)]


def test_content_text_page_works_on_rotated_pages_under_the_journal(rotated_pdf):
    with pymupdf.open(rotated_pdf) as doc:
        doc.journal_enable()
        for page in doc:
            assert "Heading" in content_text_page(page, 0).extractText()
            assert content_image_rects(page) == []
