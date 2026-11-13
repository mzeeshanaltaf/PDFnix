import pymupdf
import pytest

from pdfengine import text as text_module

from .conftest import PAGE_HEIGHT, PAGE_WIDTH


def search(client, doc_id, query, **options):
    response = client.post(f"/v1/docs/{doc_id}/search", json={"query": query, **options})
    assert response.status_code == 200, response.text
    return response.json()


def quad_bounds(quad):
    xs, ys = quad[0::2], quad[1::2]
    return min(xs), min(ys), max(xs), max(ys)


def dark_share(image, bounds):
    """Share of non-white pixels of a 1:1 page image inside bounds."""
    x0, y0, x1, y1 = (int(round(value)) for value in bounds)
    total = dark = 0
    for y in range(max(y0, 0), min(y1, image.height)):
        for x in range(max(x0, 0), min(x1, image.width)):
            total += 1
            dark += image.pixel(x, y) != (255, 255, 255)
    return dark / total if total else 0.0


def page_image(client, doc_id, index):
    response = client.get(f"/v1/docs/{doc_id}/pages/{index}/render", params={"scale": 1})
    return pymupdf.Pixmap(response.content)


# --- text ---------------------------------------------------------------


def test_text_returns_lines_and_words_in_reading_order(client, open_doc, sample_pdf):
    doc_id = open_doc(sample_pdf)["docId"]

    body = client.get(f"/v1/docs/{doc_id}/pages/0/text").json()

    lines = [" ".join(word["text"] for word in line["words"]) for line in body["lines"]]
    assert lines == [
        "Heading of page 1",
        "The quick brown Fox jumps over the lazy dog.",
        "fox foxes Foxtrot outfox",
    ]
    assert all(line["angle"] == 0 for line in body["lines"])


@pytest.mark.parametrize("index", [0, 1, 2, 3])
def test_text_boxes_fall_inside_the_page(client, open_doc, rotated_pdf, index):
    opened = open_doc(rotated_pdf)
    page = opened["pages"][index]

    body = client.get(f"/v1/docs/{opened['docId']}/pages/{index}/text").json()

    assert body["lines"]
    for line in body["lines"]:
        lx0, ly0, lx1, ly1 = line["bbox"]
        assert 0 <= lx0 < lx1 <= page["width"]
        assert 0 <= ly0 < ly1 <= page["height"]
        for word in line["words"]:
            x0, y0, x1, y1 = word["bbox"]
            assert lx0 - 0.01 <= x0 < x1 <= lx1 + 0.01
            assert ly0 - 0.01 <= y0 < y1 <= ly1 + 0.01


@pytest.mark.parametrize(("index", "angle"), [(0, 0), (1, 90), (2, 180), (3, 270)])
def test_text_follows_the_page_rotation(client, open_doc, rotated_pdf, index, angle):
    doc_id = open_doc(rotated_pdf)["docId"]

    body = client.get(f"/v1/docs/{doc_id}/pages/{index}/text").json()
    image = page_image(client, doc_id, index)

    assert {line["angle"] for line in body["lines"]} == {angle}
    # The boxes are where the rendered text actually is.
    for line in body["lines"]:
        for word in line["words"]:
            assert dark_share(image, word["bbox"]) > 0.1, word
    # ...and rotated text runs along the other axis.
    x0, y0, x1, y1 = body["lines"][1]["bbox"]
    assert (x1 - x0 > y1 - y0) == (angle in (0, 180))


def test_text_of_a_page_without_text(client, open_doc, scanned_pdf):
    doc_id = open_doc(scanned_pdf)["docId"]

    assert client.get(f"/v1/docs/{doc_id}/pages/0/text").json() == {"lines": []}


def test_text_page_out_of_range(client, open_doc, sample_pdf):
    doc_id = open_doc(sample_pdf)["docId"]

    response = client.get(f"/v1/docs/{doc_id}/pages/9/text")

    assert response.status_code == 404


# --- search -------------------------------------------------------------


def test_search_finds_known_strings_on_the_right_pages(client, open_doc, sample_pdf):
    doc_id = open_doc(sample_pdf)["docId"]

    result = search(client, doc_id, "Unique-marker")
    assert [hit["page"] for hit in result["hits"]] == [1]
    assert result["truncated"] is False

    headings = search(client, doc_id, "heading of page")
    assert [hit["page"] for hit in headings["hits"]] == [0, 1, 2]
    assert [hit["match"] for hit in headings["hits"]] == ["Heading of page"] * 3


def test_search_ignores_case_by_default(client, open_doc, sample_pdf):
    doc_id = open_doc(sample_pdf)["docId"]

    hits = [hit for hit in search(client, doc_id, "fox")["hits"] if hit["page"] == 0]

    # Fox, fox, foxes, Foxtrot, outfox
    assert [hit["match"] for hit in hits] == ["Fox", "fox", "fox", "Fox", "fox"]


def test_search_honours_match_case(client, open_doc, sample_pdf):
    doc_id = open_doc(sample_pdf)["docId"]

    upper = search(client, doc_id, "Fox", matchCase=True)["hits"]
    lower = search(client, doc_id, "fox", matchCase=True)["hits"]

    assert len([hit for hit in upper if hit["page"] == 0]) == 2  # Fox, Foxtrot
    assert len([hit for hit in lower if hit["page"] == 0]) == 3  # fox, foxes, outfox
    assert all(hit["match"] == "Fox" for hit in upper)


def test_search_honours_whole_word(client, open_doc, sample_pdf):
    doc_id = open_doc(sample_pdf)["docId"]

    whole = search(client, doc_id, "fox", wholeWord=True)["hits"]
    both = search(client, doc_id, "fox", wholeWord=True, matchCase=True)["hits"]

    assert [hit["match"] for hit in whole if hit["page"] == 0] == ["Fox", "fox"]
    assert [hit["match"] for hit in both if hit["page"] == 0] == ["fox"]
    # Punctuation is a word boundary: "dog." and "Unique-marker".
    assert len(search(client, doc_id, "dog", wholeWord=True)["hits"]) == 3
    assert len(search(client, doc_id, "marker", wholeWord=True)["hits"]) == 1


def test_search_hit_boxes_match_the_text_layer(client, open_doc, sample_pdf):
    doc_id = open_doc(sample_pdf)["docId"]
    words = {
        word["text"]: word["bbox"]
        for line in client.get(f"/v1/docs/{doc_id}/pages/0/text").json()["lines"]
        for word in line["words"]
    }

    hit = search(client, doc_id, "quick", wholeWord=True)["hits"][0]

    assert len(hit["quads"]) == 1
    assert quad_bounds(hit["quads"][0]) == pytest.approx(tuple(words["quick"]), abs=0.05)


def test_search_inside_a_word_covers_only_the_match(client, open_doc, sample_pdf):
    doc_id = open_doc(sample_pdf)["docId"]
    lines = client.get(f"/v1/docs/{doc_id}/pages/0/text").json()["lines"]
    outfox = next(word for word in lines[2]["words"] if word["text"] == "outfox")["bbox"]

    hit = [hit for hit in search(client, doc_id, "fox")["hits"] if hit["page"] == 0][-1]

    x0, y0, x1, y1 = quad_bounds(hit["quads"][0])
    assert x0 > outfox[0] + 5  # starts after "out"
    assert x1 == pytest.approx(outfox[2], abs=0.05)
    assert (y0, y1) == pytest.approx((outfox[1], outfox[3]), abs=0.05)


def test_search_across_a_line_break_gives_one_hit_with_two_boxes(client, open_doc, sample_pdf):
    doc_id = open_doc(sample_pdf)["docId"]

    result = search(client, doc_id, "wrapped   phrase")

    assert len(result["hits"]) == 1
    hit = result["hits"][0]
    assert hit["page"] == 1
    assert hit["match"] == "wrapped phrase"
    assert len(hit["quads"]) == 2
    first, second = (quad_bounds(quad) for quad in hit["quads"])
    assert second[1] > first[1]  # the second box is on the line below


def test_search_snippet_gives_context(client, open_doc, sample_pdf):
    doc_id = open_doc(sample_pdf)["docId"]

    hit = search(client, doc_id, "brown")["hits"][0]

    assert hit["before"].endswith("The quick ")
    assert hit["match"] == "brown"
    assert hit["after"].startswith(" Fox jumps over")


@pytest.mark.parametrize("index", [0, 1, 2, 3])
def test_search_hits_line_up_on_rotated_pages(client, open_doc, rotated_pdf, index):
    opened = open_doc(rotated_pdf)
    doc_id = opened["docId"]
    page = opened["pages"][index]
    image = page_image(client, doc_id, index)

    hits = [hit for hit in search(client, doc_id, "quick brown")["hits"] if hit["page"] == index]

    assert len(hits) == 1
    x0, y0, x1, y1 = quad_bounds(hits[0]["quads"][0])
    assert 0 <= x0 < x1 <= page["width"]
    assert 0 <= y0 < y1 <= page["height"]
    assert dark_share(image, (x0, y0, x1, y1)) > 0.1


def test_search_after_rotating_uses_the_new_orientation(client, open_doc, sample_pdf):
    doc_id = open_doc(sample_pdf)["docId"]
    before = quad_bounds(search(client, doc_id, "quick")["hits"][0]["quads"][0])

    client.post(f"/v1/docs/{doc_id}/pages/rotate", json={"pages": [0], "degrees": 90})
    after = quad_bounds(search(client, doc_id, "quick")["hits"][0]["quads"][0])

    # A point (x, y) of a portrait page lands at (height - y, x) after a quarter turn clockwise.
    assert after == pytest.approx(
        (PAGE_HEIGHT - before[3], before[0], PAGE_HEIGHT - before[1], before[2]), abs=0.05
    )
    assert after[2] <= PAGE_HEIGHT and after[3] <= PAGE_WIDTH


def test_search_without_matches_or_query(client, open_doc, sample_pdf):
    doc_id = open_doc(sample_pdf)["docId"]

    assert search(client, doc_id, "zebra") == {"hits": [], "truncated": False}
    assert search(client, doc_id, "") == {"hits": [], "truncated": False}
    assert search(client, doc_id, "   ") == {"hits": [], "truncated": False}


def test_search_in_a_document_without_text(client, open_doc, scanned_pdf):
    doc_id = open_doc(scanned_pdf)["docId"]

    assert search(client, doc_id, "anything")["hits"] == []


def test_search_stops_at_the_hit_limit(client, open_doc, sample_pdf, monkeypatch):
    doc_id = open_doc(sample_pdf)["docId"]
    monkeypatch.setattr(text_module, "MAX_SEARCH_HITS", 7)

    result = search(client, doc_id, "fox")

    assert len(result["hits"]) == 7
    assert result["truncated"] is True


def test_search_can_be_cancelled(app, open_doc, sample_pdf):
    session = app.state.sessions.get(open_doc(sample_pdf)["docId"])

    with pytest.raises(text_module.SearchCancelled):
        text_module.search_document(session, "fox", cancelled=lambda: True)


def test_search_unknown_document(client):
    response = client.post("/v1/docs/nope/search", json={"query": "x"})

    assert response.status_code == 404
