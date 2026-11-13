import pymupdf
import pytest

from .conftest import PAGE_HEIGHT, PAGE_WIDTH

YELLOW = "#ffeb3b"
GREEN = "#4caf50"


def word_quad(client, doc_id, page, word):
    """The displayed-space quad of the first occurrence of ``word``, built
    from the text layer the way the renderer does."""
    hits = client.post(f"/v1/docs/{doc_id}/search", json={"query": word, "wholeWord": True})
    for hit in hits.json()["hits"]:
        if hit["page"] == page:
            return hit["quads"][0]
    raise AssertionError(f"{word!r} not found on page {page}")


def create(client, doc_id, **body):
    response = client.post(f"/v1/docs/{doc_id}/annotations", json=body)
    assert response.status_code == 200, response.text
    return response.json()


def listing(client, doc_id, page=None):
    params = {} if page is None else {"page": page}
    response = client.get(f"/v1/docs/{doc_id}/annotations", params=params)
    assert response.status_code == 200, response.text
    return response.json()


@pytest.mark.parametrize("kind", ["highlight", "underline", "strikeout"])
def test_creating_text_markup(client, open_doc, sample_pdf, kind):
    doc_id = open_doc(sample_pdf)["docId"]
    quad = word_quad(client, doc_id, 0, "quick")

    body = create(client, doc_id, type=kind, page=0, quads=[quad], color=YELLOW, author="Ada")

    assert body["revision"] == 1
    assert body["dirtyPages"] == [0]
    assert body["canUndo"] is True and body["modified"] is True
    annotation = body["annotation"]
    assert annotation["type"] == kind
    assert annotation["page"] == 0
    assert annotation["color"] == YELLOW
    assert annotation["author"] == "Ada"
    assert annotation["createdAt"] and annotation["modifiedAt"]
    assert annotation["quads"] == [pytest.approx(quad, abs=0.05)]
    assert listing(client, doc_id, 0) == [annotation]


def test_creating_a_note(client, open_doc, sample_pdf):
    doc_id = open_doc(sample_pdf)["docId"]

    body = create(
        client, doc_id, type="note", page=1, point=[300, 400], contents="Check this", color=GREEN
    )

    note = body["annotation"]
    assert note["type"] == "note"
    assert note["contents"] == "Check this"
    assert note["color"] == GREEN
    assert note["rect"][:2] == pytest.approx([300, 400], abs=0.05)
    assert "quads" not in note


def test_listing_without_a_page_returns_every_annotation(client, open_doc, sample_pdf):
    doc_id = open_doc(sample_pdf)["docId"]
    create(client, doc_id, type="note", page=2, point=[50, 50], contents="c", color=GREEN)
    create(client, doc_id, type="note", page=0, point=[50, 50], contents="a", color=GREEN)

    everything = listing(client, doc_id)

    assert [(a["page"], a["contents"]) for a in everything] == [(0, "a"), (2, "c")]
    assert listing(client, doc_id, 1) == []


def test_markup_is_drawn_where_the_text_is(client, open_doc, sample_pdf):
    doc_id = open_doc(sample_pdf)["docId"]
    quad = word_quad(client, doc_id, 0, "brown")
    before = pymupdf.Pixmap(client.get(f"/v1/docs/{doc_id}/pages/0/render").content)

    create(client, doc_id, type="highlight", page=0, quads=[quad], color="#ff0000")

    after = pymupdf.Pixmap(client.get(f"/v1/docs/{doc_id}/pages/0/render").content)
    # Just left of the word (highlights reach a little past their quads):
    # background before, red tint after.
    x, y = int(quad[0]) - 2, int((quad[1] + quad[5]) / 2)
    assert before.pixel(x, y) == (255, 255, 255)
    red, green, blue = after.pixel(x, y)
    assert red > 200 and green < 100 and blue < 100


@pytest.mark.parametrize("rotation", [90, 180, 270])
def test_annotations_on_rotated_pages_use_displayed_coordinates(
    client, open_doc, sample_pdf, rotation
):
    doc_id = open_doc(sample_pdf)["docId"]
    client.post(f"/v1/docs/{doc_id}/pages/rotate", json={"pages": [0], "degrees": rotation})
    quad = word_quad(client, doc_id, 0, "brown")

    highlight = create(client, doc_id, type="highlight", page=0, quads=[quad], color="#ff0000")
    note = create(client, doc_id, type="note", page=0, point=[100, 120], contents="n", color=GREEN)

    assert highlight["annotation"]["quads"] == [pytest.approx(quad, abs=0.05)]
    assert note["annotation"]["rect"][:2] == pytest.approx([100, 120], abs=0.05)
    # The highlight is drawn over the word as displayed.
    image = pymupdf.Pixmap(client.get(f"/v1/docs/{doc_id}/pages/0/render").content)
    xs, ys = quad[0::2], quad[1::2]
    centre = (int((min(xs) + max(xs)) / 2), int((min(ys) + max(ys)) / 2))
    rect = highlight["annotation"]["rect"]
    assert rect[0] <= centre[0] <= rect[2] and rect[1] <= centre[1] <= rect[3]
    # Somewhere in the word's box is tinted red (glyphs are dark, gaps red).
    tinted = [
        image.pixel(x, y)
        for x in range(int(min(xs)) + 1, int(max(xs)) - 1)
        for y in range(int(min(ys)) + 1, int(max(ys)) - 1)
    ]
    assert any(r > 200 and g < 120 and b < 120 for r, g, b in tinted)


def test_changing_contents_colour_and_opacity(client, open_doc, sample_pdf):
    doc_id = open_doc(sample_pdf)["docId"]
    quad = word_quad(client, doc_id, 0, "quick")
    annot_id = create(client, doc_id, type="highlight", page=0, quads=[quad], color=YELLOW)[
        "annotation"
    ]["annotId"]

    response = client.patch(
        f"/v1/docs/{doc_id}/annotations/{annot_id}",
        params={"page": 0},
        json={"contents": "Why?", "color": GREEN, "opacity": 0.5},
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["undoName"] == "Edit Annotation"
    assert body["annotation"]["contents"] == "Why?"
    assert body["annotation"]["color"] == GREEN
    assert body["annotation"]["opacity"] == 0.5
    assert body["annotation"]["annotId"] == annot_id


def test_comment_can_be_cleared(client, open_doc, sample_pdf):
    doc_id = open_doc(sample_pdf)["docId"]
    note = create(client, doc_id, type="note", page=0, point=[50, 50], contents="x", color=GREEN)
    annot_id = note["annotation"]["annotId"]

    body = client.patch(f"/v1/docs/{doc_id}/annotations/{annot_id}", json={"contents": ""}).json()

    assert body["annotation"]["contents"] == ""
    assert body["undoName"] == "Edit Comment"


def test_moving_a_note(client, open_doc, sample_pdf):
    doc_id = open_doc(sample_pdf)["docId"]
    note = create(client, doc_id, type="note", page=0, point=[50, 50], contents="x", color=GREEN)
    annot_id = note["annotation"]["annotId"]
    width = note["annotation"]["rect"][2] - note["annotation"]["rect"][0]

    body = client.patch(
        f"/v1/docs/{doc_id}/annotations/{annot_id}", json={"rect": [200, 300, 200 + width, 320]}
    ).json()

    assert body["annotation"]["rect"][:2] == pytest.approx([200, 300], abs=0.05)
    assert body["undoName"] == "Move"


def test_a_note_stays_on_the_page(client, open_doc, sample_pdf):
    doc_id = open_doc(sample_pdf)["docId"]

    note = create(
        client, doc_id, type="note", page=0, point=[PAGE_WIDTH + 50, -40], contents="", color=GREEN
    )["annotation"]

    x0, y0, x1, _y1 = note["rect"]
    assert x1 <= PAGE_WIDTH + 0.05 and x0 >= 0 and y0 >= -0.05
    assert note["rect"][3] <= PAGE_HEIGHT


def test_text_markup_cannot_be_moved(client, open_doc, sample_pdf):
    doc_id = open_doc(sample_pdf)["docId"]
    quad = word_quad(client, doc_id, 0, "quick")
    annot_id = create(client, doc_id, type="highlight", page=0, quads=[quad], color=YELLOW)[
        "annotation"
    ]["annotId"]

    response = client.patch(
        f"/v1/docs/{doc_id}/annotations/{annot_id}", json={"rect": [0, 0, 10, 10]}
    )

    assert response.status_code == 400


def test_deleting(client, open_doc, sample_pdf):
    doc_id = open_doc(sample_pdf)["docId"]
    note = create(client, doc_id, type="note", page=1, point=[50, 50], contents="x", color=GREEN)
    annot_id = note["annotation"]["annotId"]

    # Without a page hint the engine finds the page itself.
    response = client.delete(f"/v1/docs/{doc_id}/annotations/{annot_id}")

    assert response.status_code == 200
    assert response.json()["dirtyPages"] == [1]
    assert response.json()["undoName"] == "Delete"
    assert listing(client, doc_id) == []


def test_unknown_annotation(client, open_doc, sample_pdf):
    doc_id = open_doc(sample_pdf)["docId"]

    response = client.delete(f"/v1/docs/{doc_id}/annotations/99999")

    assert response.status_code == 404


@pytest.mark.parametrize(
    "body",
    [
        {"type": "highlight", "page": 0, "color": YELLOW},  # no quads
        {"type": "highlight", "page": 0, "quads": [], "color": YELLOW},
        {"type": "highlight", "page": 0, "quads": [[1, 2, 3]], "color": YELLOW},
        {"type": "note", "page": 0, "color": YELLOW},  # no point
    ],
)
def test_bad_requests_change_nothing(client, open_doc, sample_pdf, body):
    doc_id = open_doc(sample_pdf)["docId"]

    response = client.post(f"/v1/docs/{doc_id}/annotations", json=body)

    assert response.status_code == 400
    state = client.get(f"/v1/docs/{doc_id}/state").json()
    assert state["revision"] == 0 and state["canUndo"] is False and state["canRedo"] is False


def test_bad_colour_or_page(client, open_doc, sample_pdf):
    doc_id = open_doc(sample_pdf)["docId"]
    note = {"type": "note", "point": [1, 1]}

    assert (
        client.post(
            f"/v1/docs/{doc_id}/annotations", json={**note, "page": 0, "color": "yellow"}
        ).status_code
        == 422
    )
    assert (
        client.post(
            f"/v1/docs/{doc_id}/annotations", json={**note, "page": 9, "color": YELLOW}
        ).status_code
        == 404
    )


def test_existing_annotations_from_the_file_are_listed(client, open_doc, tmp_path):
    doc = pymupdf.open()
    page = doc.new_page(width=PAGE_WIDTH, height=PAGE_HEIGHT)
    square = page.add_rect_annot(pymupdf.Rect(100, 100, 200, 150))
    square.set_info(content="A box", title="Someone")
    square.update()
    page.insert_link({"kind": pymupdf.LINK_URI, "from": pymupdf.Rect(10, 10, 50, 20), "uri": "x:"})
    path = tmp_path / "existing.pdf"
    doc.save(path)
    doc_id = open_doc(str(path))["docId"]

    annotations = listing(client, doc_id)

    assert [(a["type"], a["contents"], a["author"]) for a in annotations] == [
        ("square", "A box", "Someone")
    ]
