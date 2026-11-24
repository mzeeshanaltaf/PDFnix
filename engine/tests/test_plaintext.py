"""The document's plain text for the AI assistant (GET /v1/docs/{id}/plain-text)."""

import pymupdf
import pytest

from .conftest import build_sample

PAGE_ONE = (
    "Heading of page 1\n\nThe quick brown Fox jumps over the lazy dog.\n\nfox foxes Foxtrot outfox"
)


def plain(client, doc_id, **params):
    query = {"from": 0, **{k: v for k, v in params.items() if k != "first"}}
    if "first" in params:
        query["from"] = params["first"]
    return client.get(f"/v1/docs/{doc_id}/plain-text", params=query)


def saved_sample(tmp_path, pages=3, rotation=0, name="sample.pdf"):
    doc = build_sample(pages)
    for page in doc:
        page.set_rotation(rotation)
    path = tmp_path / name
    doc.save(path)
    doc.close()
    return str(path)


@pytest.mark.parametrize("rotation", [0, 90, 180, 270])
def test_text_is_the_same_at_every_rotation(client, open_doc, tmp_path, rotation):
    doc_id = open_doc(saved_sample(tmp_path, rotation=rotation))["docId"]

    body = plain(client, doc_id).json()

    assert body["pageCount"] == 3
    assert body["truncated"] is False
    assert [page["index"] for page in body["pages"]] == [0, 1, 2]
    assert body["pages"][0]["text"] == PAGE_ONE
    assert "Unique-marker here." in body["pages"][1]["text"]


def test_text_of_an_edited_document_with_a_turned_page(client, open_doc, tmp_path):
    """With the journal on, page.get_text would fail on a turned page."""
    doc_id = open_doc(saved_sample(tmp_path))["docId"]
    response = client.post(f"/v1/docs/{doc_id}/pages/rotate", json={"pages": [0], "degrees": 90})
    assert response.status_code == 200
    response = client.post(
        f"/v1/docs/{doc_id}/annotations",
        json={
            "type": "highlight",
            "page": 1,
            "quads": [[72, 128, 300, 128, 72, 144, 300, 144]],
            "color": "#ffd54f",
        },
    )
    assert response.status_code == 200, response.text

    body = plain(client, doc_id).json()

    assert body["pages"][0]["text"] == PAGE_ONE
    assert body["pages"][1]["text"].startswith("Heading of page 2")


def test_annotation_text_is_left_out(client, open_doc, tmp_path):
    doc_id = open_doc(saved_sample(tmp_path))["docId"]
    response = client.post(
        f"/v1/docs/{doc_id}/annotations",
        json={
            "type": "freetext",
            "page": 0,
            "rect": [100, 400, 300, 440],
            "text": "Boxed words",
            "color": "#0000ff",
        },
    )
    assert response.status_code == 200, response.text
    response = client.post(
        f"/v1/docs/{doc_id}/annotations",
        json={
            "type": "note",
            "page": 0,
            "point": [300, 300],
            "contents": "A sticky note",
            "color": "#ffd54f",
        },
    )
    assert response.status_code == 200, response.text

    text = plain(client, doc_id, to=0).json()["pages"][0]["text"]

    assert text == PAGE_ONE
    assert "Boxed" not in text and "sticky" not in text


def test_a_page_range(client, open_doc, tmp_path):
    doc_id = open_doc(saved_sample(tmp_path, pages=5))["docId"]

    body = plain(client, doc_id, first=1, to=3).json()

    assert [page["index"] for page in body["pages"]] == [1, 2, 3]
    assert body["pages"][2]["text"].startswith("Heading of page 4")
    assert body["pageCount"] == 5
    assert body["truncated"] is False


def test_max_chars_stops_at_a_page_boundary(client, open_doc, tmp_path):
    # Pages 3, 4 and 5 are as long as page 1 (page 2 has extra lines).
    doc_id = open_doc(saved_sample(tmp_path, pages=5))["docId"]
    one_page = len(PAGE_ONE)

    body = plain(client, doc_id, first=2, maxChars=2 * one_page + 5).json()

    assert [page["index"] for page in body["pages"]] == [2, 3]
    assert body["pages"][1]["text"] == PAGE_ONE.replace("page 1", "page 4")
    assert body["truncated"] is True


def test_the_first_page_is_cut_when_it_is_too_long_on_its_own(client, open_doc, tmp_path):
    doc_id = open_doc(saved_sample(tmp_path))["docId"]

    body = plain(client, doc_id, maxChars=10).json()

    assert body["pages"] == [{"index": 0, "text": PAGE_ONE[:10]}]
    assert body["truncated"] is True


def test_exactly_enough_room_is_not_truncated(client, open_doc, tmp_path):
    doc_id = open_doc(saved_sample(tmp_path, pages=1))["docId"]

    body = plain(client, doc_id, maxChars=len(PAGE_ONE)).json()

    assert body["pages"] == [{"index": 0, "text": PAGE_ONE}]
    assert body["truncated"] is False


def test_a_page_without_text_gives_an_empty_string(client, open_doc, tmp_path):
    doc = pymupdf.open()
    doc.new_page()
    path = tmp_path / "blank.pdf"
    doc.save(path)
    doc.close()
    doc_id = open_doc(str(path))["docId"]

    assert plain(client, doc_id).json()["pages"] == [{"index": 0, "text": ""}]


def test_unknown_document_is_404(client):
    response = client.get("/v1/docs/nope/plain-text")

    assert response.status_code == 404


@pytest.mark.parametrize(
    "params",
    [{"first": 3}, {"first": -1}, {"to": 3}, {"first": 2, "to": 1}, {"maxChars": 0}],
)
def test_out_of_range_is_400(client, open_doc, tmp_path, params):
    doc_id = open_doc(saved_sample(tmp_path))["docId"]

    response = plain(client, doc_id, **params)

    assert response.status_code == 400
    assert response.json()["error"]["code"] == "bad_request"
