"""Free text, shape and ink annotations (phase 4)."""

import pymupdf
import pytest

from pdfengine.textpages import text_page

RED = "#ff0000"
BLUE = "#0000ff"


def create(client, doc_id, **body):
    response = client.post(f"/v1/docs/{doc_id}/annotations", json=body)
    assert response.status_code == 200, response.text
    return response.json()


def patch(client, doc_id, annot_id, **body):
    response = client.patch(f"/v1/docs/{doc_id}/annotations/{annot_id}", json=body)
    assert response.status_code == 200, response.text
    return response.json()


def listing(client, doc_id, page=None):
    params = {} if page is None else {"page": page}
    return client.get(f"/v1/docs/{doc_id}/annotations", params=params).json()


def inside(rect, outer, slack=0.0):
    return (
        rect[0] >= outer[0] - slack
        and rect[1] >= outer[1] - slack
        and rect[2] <= outer[2] + slack
        and rect[3] <= outer[3] + slack
    )


SHAPES = [
    {"type": "square", "rect": [100, 200, 200, 260]},
    {"type": "circle", "rect": [100, 200, 200, 260]},
    {"type": "line", "points": [[100, 200], [200, 260]], "arrowEnd": True},
    {"type": "ink", "strokes": [[[100, 200], [150, 240], [200, 260]], [[110, 250], [120, 255]]]},
]


@pytest.mark.parametrize("shape", SHAPES, ids=lambda s: s["type"])
@pytest.mark.parametrize("page", [0, 1, 2, 3])
def test_shapes_are_drawn_where_asked_on_rotated_pages(client, open_doc, rotated_pdf, shape, page):
    doc_id = open_doc(rotated_pdf)["docId"]

    body = create(client, doc_id, page=page, color=RED, width=2, **shape)

    annotation = body["annotation"]
    assert annotation["type"] == shape["type"]
    assert annotation["color"] == RED
    assert annotation["width"] == 2
    # Drawn bounds are the requested geometry plus the stroke (and arrow head).
    rect = annotation["rect"]
    assert inside([100, 200, 200, 260], rect, slack=0.5)
    assert inside(rect, [100, 200, 200, 260], slack=12)
    assert body["dirtyPages"] == [page]
    assert body["undoName"] in ("Rectangle", "Ellipse", "Line", "Drawing")


def test_shape_style_is_described(client, open_doc, sample_pdf):
    doc_id = open_doc(sample_pdf)["docId"]

    square = create(
        client,
        doc_id,
        type="square",
        page=0,
        rect=[50, 50, 150, 100],
        color=RED,
        fill=BLUE,
        width=3,
        opacity=0.5,
    )["annotation"]
    line = create(
        client,
        doc_id,
        type="line",
        page=0,
        points=[[50, 300], [250, 300]],
        color=BLUE,
        arrowStart=True,
        arrowEnd=False,
    )["annotation"]

    assert square["fill"] == BLUE
    assert square["width"] == 3
    assert square["opacity"] == 0.5
    assert line["points"] == [[50, 300], [250, 300]]
    assert line["arrowStart"] is True and line["arrowEnd"] is False
    assert line["fill"] is None


def test_restyling_a_shape(client, open_doc, sample_pdf):
    doc_id = open_doc(sample_pdf)["docId"]
    square = create(
        client, doc_id, type="square", page=0, rect=[50, 50, 150, 100], color=RED, fill=BLUE
    )["annotation"]

    body = patch(client, doc_id, square["annotId"], fill=None, width=5, color=BLUE)

    changed = body["annotation"]
    assert changed["annotId"] == square["annotId"]
    assert changed["fill"] is None
    assert changed["width"] == 5
    assert changed["color"] == BLUE
    assert body["undoName"] == "Edit Annotation"


@pytest.mark.parametrize("shape", SHAPES, ids=lambda s: s["type"])
@pytest.mark.parametrize("page", [0, 1])
def test_moving_and_resizing_shapes(client, open_doc, rotated_pdf, shape, page):
    doc_id = open_doc(rotated_pdf)["docId"]
    created = create(client, doc_id, page=page, color=RED, width=2, **shape)["annotation"]
    x0, y0, x1, y1 = created["rect"]

    shifted = [x0 + 40, y0 + 30, x1 + 40, y1 + 30]
    moved = patch(client, doc_id, created["annotId"], rect=shifted)
    assert moved["undoName"] == "Move"
    assert moved["annotation"]["rect"] == pytest.approx(shifted, abs=0.1)

    target = [300, 300, 300 + (x1 - x0) * 2, 300 + (y1 - y0) * 1.5]
    resized = patch(client, doc_id, created["annotId"], rect=target)
    assert resized["undoName"] == "Resize"
    assert resized["annotation"]["rect"] == pytest.approx(target, abs=1.0)

    client.post(f"/v1/docs/{doc_id}/undo")
    client.post(f"/v1/docs/{doc_id}/undo")
    assert listing(client, doc_id, page)[0]["rect"] == pytest.approx(created["rect"], abs=0.05)


def test_moving_keeps_a_shape_on_the_page(client, open_doc, sample_pdf):
    doc_id = open_doc(sample_pdf)["docId"]
    created = create(client, doc_id, type="square", page=0, rect=[50, 50, 150, 100], color=RED)[
        "annotation"
    ]
    x0, y0, x1, y1 = created["rect"]

    off_page = [-500, -500, -500 + x1 - x0, -500 + y1 - y0]
    body = patch(client, doc_id, created["annotId"], rect=off_page)

    assert body["annotation"]["rect"][:2] == pytest.approx([0, 0], abs=0.05)


def spans_of(path_or_doc, page_index):
    doc = path_or_doc if isinstance(path_or_doc, pymupdf.Document) else pymupdf.open(path_or_doc)
    page = doc[page_index]
    result = []
    for block in text_page(page, 0).extractDICT()["blocks"]:
        for line in block["lines"]:
            vector = pymupdf.Point(line["dir"]) * pymupdf.Matrix(page.rotation)
            for span in line["spans"]:
                bbox = pymupdf.Rect(span["bbox"]) * page.rotation_matrix
                result.append((span["text"], span, bbox, (round(vector.x), round(vector.y))))
    return result


@pytest.mark.parametrize("page", [0, 1, 2, 3])
def test_free_text_reads_left_to_right_on_rotated_pages(client, open_doc, rotated_pdf, page):
    doc_id = open_doc(rotated_pdf)["docId"]

    body = create(
        client,
        doc_id,
        type="freetext",
        page=page,
        rect=[100, 400, 300, 440],
        text="Boxed words",
        color=BLUE,
        fontSize=14,
        bold=True,
        author="Ada",
    )

    annotation = body["annotation"]
    assert annotation["type"] == "freetext"
    assert annotation["text"] == annotation["contents"] == "Boxed words"
    assert annotation["color"] == BLUE
    assert annotation["fontSize"] == 14 and annotation["bold"] is True
    assert annotation["fontFamily"] == "sans" and annotation["align"] == "left"
    assert annotation["rotation"] == 0
    assert annotation["rect"] == pytest.approx([100, 400, 300, 440], abs=0.05)
    assert body["undoName"] == "Text Box"

    client.post(f"/v1/docs/{doc_id}/save", json={})
    hits = [s for s in spans_of(rotated_pdf, page) if "Boxed" in s[0]]
    assert hits, "the text box's text is drawn"
    _, span, bbox, direction = hits[0]
    assert direction == (1, 0)
    assert "Bold" in span["font"]
    # A span's box reaches up to the font's ascender, slightly above the glyphs.
    assert bbox.x0 >= 99 and bbox.y0 >= 397 and bbox.x1 <= 301 and bbox.y1 <= 441


def test_free_text_rotation_is_clockwise(client, open_doc, sample_pdf):
    doc_id = open_doc(sample_pdf)["docId"]

    annotation = create(
        client,
        doc_id,
        type="freetext",
        page=0,
        rect=[100, 100, 140, 300],
        text="Downwards",
        color=BLUE,
        rotation=90,
    )["annotation"]

    assert annotation["rotation"] == 90
    client.post(f"/v1/docs/{doc_id}/save", json={})
    hits = [s for s in spans_of(sample_pdf, 0) if "Downwards" in s[0]]
    assert hits[0][3] == (0, 1)


def test_editing_free_text_keeps_its_id(client, open_doc, sample_pdf):
    doc_id = open_doc(sample_pdf)["docId"]
    created = create(
        client,
        doc_id,
        type="freetext",
        page=0,
        rect=[100, 100, 300, 140],
        text="First",
        color=BLUE,
        author="Ada",
    )["annotation"]

    body = patch(
        client,
        doc_id,
        created["annotId"],
        text="Second\nline",
        fontFamily="serif",
        fontSize=18,
        align="center",
        italic=True,
        color=RED,
        fill="#ffff00",
    )

    edited = body["annotation"]
    assert edited["annotId"] == created["annotId"]
    assert edited["text"] == "Second\nline"
    assert (edited["fontFamily"], edited["fontSize"], edited["align"]) == ("serif", 18, "center")
    assert edited["italic"] is True and edited["bold"] is False
    assert edited["color"] == RED and edited["fill"] == "#ffff00"
    assert edited["author"] == "Ada"
    assert edited["rect"] == created["rect"]

    resized = patch(client, doc_id, created["annotId"], rect=[50, 50, 400, 200])["annotation"]
    assert resized["rect"] == pytest.approx([50, 50, 400, 200], abs=0.05)
    assert resized["text"] == "Second\nline" and resized["fontSize"] == 18

    client.post(f"/v1/docs/{doc_id}/undo")
    client.post(f"/v1/docs/{doc_id}/undo")
    assert listing(client, doc_id, 0)[0]["text"] == "First"


def test_free_text_needs_text(client, open_doc, sample_pdf):
    doc_id = open_doc(sample_pdf)["docId"]
    response = client.post(
        f"/v1/docs/{doc_id}/annotations",
        json={"type": "freetext", "page": 0, "rect": [1, 1, 50, 50], "text": "  ", "color": RED},
    )
    assert response.status_code == 400


def test_only_text_boxes_take_text_style(client, open_doc, sample_pdf):
    doc_id = open_doc(sample_pdf)["docId"]
    square = create(client, doc_id, type="square", page=0, rect=[1, 1, 50, 50], color=RED)
    response = client.patch(
        f"/v1/docs/{doc_id}/annotations/{square['annotation']['annotId']}", json={"fontSize": 20}
    )
    assert response.status_code == 400


def test_shapes_survive_save_and_reopen(client, open_doc, sample_pdf):
    doc_id = open_doc(sample_pdf)["docId"]
    for shape in SHAPES:
        create(client, doc_id, page=0, color=RED, **shape)
    create(
        client,
        doc_id,
        type="freetext",
        page=0,
        rect=[300, 500, 500, 540],
        text="Saved text",
        color=BLUE,
        fontFamily="mono",
    )
    before = listing(client, doc_id, 0)

    client.post(f"/v1/docs/{doc_id}/save", json={})
    client.delete(f"/v1/docs/{doc_id}")
    reopened = open_doc(sample_pdf)["docId"]
    after = listing(client, reopened, 0)

    assert [a["type"] for a in after] == ["square", "circle", "line", "ink", "freetext"]
    for old, new in zip(before, after, strict=True):
        assert new["rect"] == pytest.approx(old["rect"], abs=0.05)
        assert new["color"] == old["color"]
    assert after[-1]["text"] == "Saved text" and after[-1]["fontFamily"] == "mono"
    with pymupdf.open(sample_pdf) as doc:
        kinds = [annot.type[1] for annot in doc[0].annots()]
    assert kinds == ["Square", "Circle", "Line", "Ink", "FreeText"]


def test_each_creation_is_one_undo_step_that_redoes(client, open_doc, sample_pdf):
    doc_id = open_doc(sample_pdf)["docId"]
    for shape in SHAPES:
        create(client, doc_id, page=0, color=RED, **shape)
    create(client, doc_id, type="freetext", page=0, rect=[1, 1, 90, 40], text="x", color=RED)

    for remaining in range(4, -1, -1):
        client.post(f"/v1/docs/{doc_id}/undo")
        assert len(listing(client, doc_id, 0)) == remaining
    for count in range(1, 6):
        client.post(f"/v1/docs/{doc_id}/redo")
        assert len(listing(client, doc_id, 0)) == count
