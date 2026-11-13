import math

import pymupdf
import pytest

from pdfengine.render import MAX_PIXELS, effective_scale

from .conftest import PAGE_HEIGHT, PAGE_WIDTH


def decode(response) -> pymupdf.Pixmap:
    return pymupdf.Pixmap(response.content)


@pytest.mark.parametrize("scale", [0.25, 1.0, 1.5, 2.0])
def test_render_has_the_expected_pixel_size(client, open_doc, sample_pdf, scale):
    doc_id = open_doc(sample_pdf)["docId"]

    response = client.get(f"/v1/docs/{doc_id}/pages/0/render", params={"scale": scale})

    assert response.status_code == 200
    assert response.headers["content-type"] == "image/png"
    image = decode(response)
    assert abs(image.width - PAGE_WIDTH * scale) <= 1
    assert abs(image.height - PAGE_HEIGHT * scale) <= 1


def test_render_shows_the_page_content(client, open_doc, sample_pdf):
    doc_id = open_doc(sample_pdf)["docId"]

    image = decode(client.get(f"/v1/docs/{doc_id}/pages/0/render", params={"scale": 1}))

    # White paper with dark text where the heading is, nothing in the margin.
    assert image.pixel(5, 5) == (255, 255, 255)
    heading = pymupdf.IRect(72, 84, 250, 106)
    assert any(
        image.pixel(x, y) != (255, 255, 255)
        for x in range(heading.x0, heading.x1)
        for y in range(heading.y0, heading.y1)
    )


def test_render_of_a_rotated_page_uses_the_displayed_size(client, open_doc, rotated_pdf):
    doc_id = open_doc(rotated_pdf)["docId"]

    image = decode(client.get(f"/v1/docs/{doc_id}/pages/1/render", params={"scale": 1}))

    assert (image.width, image.height) == (PAGE_HEIGHT, PAGE_WIDTH)


def test_render_stays_within_the_pixel_budget(client, open_doc, sample_pdf):
    doc_id = open_doc(sample_pdf)["docId"]

    response = client.get(f"/v1/docs/{doc_id}/pages/0/render", params={"scale": 20})

    assert response.status_code == 200
    image = decode(response)
    assert image.width * image.height <= MAX_PIXELS * 1.01
    # The budget is used, not undershot, and the proportions are kept.
    assert image.width * image.height >= MAX_PIXELS * 0.98
    assert math.isclose(image.width / image.height, PAGE_WIDTH / PAGE_HEIGHT, rel_tol=0.001)


def test_effective_scale():
    assert effective_scale(612, 792, 2) == 2
    capped = effective_scale(612, 792, 100)
    assert math.isclose(612 * 792 * capped * capped, MAX_PIXELS)


def test_render_sends_an_etag_and_honours_it(client, open_doc, sample_pdf):
    doc_id = open_doc(sample_pdf)["docId"]
    url = f"/v1/docs/{doc_id}/pages/1/render"

    first = client.get(url, params={"scale": 1.5})
    etag = first.headers["etag"]
    assert etag.startswith('"0-1-1.5')

    again = client.get(url, params={"scale": 1.5}, headers={"If-None-Match": etag})
    assert again.status_code == 304
    assert again.content == b""

    other_scale = client.get(url, params={"scale": 2}, headers={"If-None-Match": etag})
    assert other_scale.status_code == 200
    assert other_scale.headers["etag"] != etag


def test_etag_changes_with_the_revision(client, open_doc, sample_pdf):
    doc_id = open_doc(sample_pdf)["docId"]
    url = f"/v1/docs/{doc_id}/pages/0/render"
    before = client.get(url).headers["etag"]

    client.post(f"/v1/docs/{doc_id}/pages/rotate", json={"pages": [0], "degrees": 90})

    after = client.get(url, headers={"If-None-Match": before})
    assert after.status_code == 200
    assert after.headers["etag"] != before


def test_page_images_are_not_stored_by_the_browser(client, open_doc, sample_pdf):
    doc_id = open_doc(sample_pdf)["docId"]

    response = client.get(f"/v1/docs/{doc_id}/pages/0/render")

    assert response.headers["cache-control"] == "no-store"


def test_a_picture_page_is_sent_as_jpeg(client, open_doc, scanned_pdf):
    doc_id = open_doc(scanned_pdf)["docId"]

    automatic = client.get(f"/v1/docs/{doc_id}/pages/0/render")
    forced = client.get(f"/v1/docs/{doc_id}/pages/0/render", params={"format": "png"})

    assert automatic.headers["content-type"] == "image/jpeg"
    assert automatic.content[:2] == b"\xff\xd8"
    assert forced.headers["content-type"] == "image/png"
    assert (decode(automatic).width, decode(automatic).height) == (PAGE_WIDTH, PAGE_HEIGHT)


def test_render_page_out_of_range(client, open_doc, sample_pdf):
    doc_id = open_doc(sample_pdf)["docId"]

    for index in (3, -1):
        response = client.get(f"/v1/docs/{doc_id}/pages/{index}/render")
        assert response.status_code == 404
        assert response.json()["error"]["code"] == "not_found"


@pytest.mark.parametrize(
    "params", [{"scale": 0}, {"scale": -1}, {"scale": "big"}, {"format": "gif"}]
)
def test_render_rejects_bad_parameters(client, open_doc, sample_pdf, params):
    doc_id = open_doc(sample_pdf)["docId"]

    response = client.get(f"/v1/docs/{doc_id}/pages/0/render", params=params)

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "invalid_request"
