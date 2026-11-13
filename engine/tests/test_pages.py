import pymupdf
import pytest

from .conftest import PAGE_HEIGHT, PAGE_WIDTH

PORTRAIT = (PAGE_WIDTH, PAGE_HEIGHT)
LANDSCAPE = (PAGE_HEIGHT, PAGE_WIDTH)


def rotate(client, doc_id, **body):
    return client.post(f"/v1/docs/{doc_id}/pages/rotate", json=body)


def test_rotation_changes_the_reported_sizes(client, open_doc, sample_pdf):
    doc_id = open_doc(sample_pdf)["docId"]

    response = rotate(client, doc_id, pages=[1], degrees=90)

    assert response.status_code == 200
    assert response.json() == {
        "revision": 1,
        "dirtyPages": [1],
        "pageCount": 3,
        "pages": [{"index": 1, "width": PAGE_HEIGHT, "height": PAGE_WIDTH, "rotation": 90}],
    }


def test_rotation_is_visible_in_the_render(client, open_doc, sample_pdf):
    doc_id = open_doc(sample_pdf)["docId"]

    rotate(client, doc_id, pages=[0], degrees=90)

    rotated = pymupdf.Pixmap(client.get(f"/v1/docs/{doc_id}/pages/0/render").content)
    untouched = pymupdf.Pixmap(client.get(f"/v1/docs/{doc_id}/pages/1/render").content)
    assert (rotated.width, rotated.height) == LANDSCAPE
    assert (untouched.width, untouched.height) == PORTRAIT


def test_rotation_accumulates_and_wraps(client, open_doc, sample_pdf):
    doc_id = open_doc(sample_pdf)["docId"]

    rotations = []
    for _ in range(4):
        rotations.append(rotate(client, doc_id, pages=[0], degrees=90).json()["pages"][0])

    assert [page["rotation"] for page in rotations] == [90, 180, 270, 0]
    assert [(page["width"], page["height"]) for page in rotations] == [
        LANDSCAPE,
        PORTRAIT,
        LANDSCAPE,
        PORTRAIT,
    ]


def test_rotating_counterclockwise(client, open_doc, sample_pdf):
    doc_id = open_doc(sample_pdf)["docId"]

    page = rotate(client, doc_id, pages=[2], degrees=-90).json()["pages"][0]

    assert page == {"index": 2, "width": PAGE_HEIGHT, "height": PAGE_WIDTH, "rotation": 270}


def test_rotating_all_pages(client, open_doc, sample_pdf):
    doc_id = open_doc(sample_pdf)["docId"]

    body = rotate(client, doc_id, degrees=180).json()

    assert body["dirtyPages"] == [0, 1, 2]
    assert [page["rotation"] for page in body["pages"]] == [180, 180, 180]
    assert body["revision"] == 1


def test_each_rotation_increases_the_revision(client, open_doc, sample_pdf):
    doc_id = open_doc(sample_pdf)["docId"]

    first = rotate(client, doc_id, pages=[0], degrees=90).json()
    second = rotate(client, doc_id, pages=[0, 1], degrees=90).json()

    assert (first["revision"], second["revision"]) == (1, 2)
    assert second["dirtyPages"] == [0, 1]


def test_a_full_turn_changes_nothing(client, open_doc, sample_pdf):
    doc_id = open_doc(sample_pdf)["docId"]

    body = rotate(client, doc_id, pages=[0], degrees=360).json()

    assert body == {"revision": 0, "dirtyPages": [], "pageCount": 3, "pages": []}


@pytest.mark.parametrize("degrees", [45, 1, -30])
def test_rotation_must_be_a_quarter_turn(client, open_doc, sample_pdf, degrees):
    doc_id = open_doc(sample_pdf)["docId"]

    response = rotate(client, doc_id, pages=[0], degrees=degrees)

    assert response.status_code == 400
    assert response.json()["error"]["code"] == "bad_request"


def test_a_bad_page_index_changes_nothing(client, open_doc, sample_pdf):
    doc_id = open_doc(sample_pdf)["docId"]

    response = rotate(client, doc_id, pages=[0, 7], degrees=90)

    assert response.status_code == 404
    image = pymupdf.Pixmap(client.get(f"/v1/docs/{doc_id}/pages/0/render").content)
    assert (image.width, image.height) == PORTRAIT
    assert rotate(client, doc_id, pages=[0], degrees=90).json()["revision"] == 1
