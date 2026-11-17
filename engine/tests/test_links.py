import pymupdf
import pytest

from .conftest import PAGE_HEIGHT, PAGE_WIDTH, build_sample

WEB_RECT = pymupdf.Rect(72, 88, 250, 104)
PAGE_RECT = pymupdf.Rect(72, 128, 300, 144)


def build_linked(path, rotation: int = 0) -> str:
    """Page 1 links to a web site, to page 3, to a mail address, and has a link
    that launches a program (which must not be offered)."""
    doc = build_sample(3)
    page = doc[0]
    page.insert_link({"kind": pymupdf.LINK_URI, "from": WEB_RECT, "uri": "https://example.com/a"})
    page.insert_link(
        {"kind": pymupdf.LINK_GOTO, "from": PAGE_RECT, "page": 2, "to": pymupdf.Point(0, 0)}
    )
    page.insert_link(
        {"kind": pymupdf.LINK_URI, "from": pymupdf.Rect(72, 150, 200, 166), "uri": "mailto:a@b.c"}
    )
    page.insert_link(
        {
            "kind": pymupdf.LINK_LAUNCH,
            "from": pymupdf.Rect(72, 300, 200, 316),
            "file": "calc.exe",
        }
    )
    page.set_rotation(rotation)
    doc.save(path)
    doc.close()
    return str(path)


def test_links_lists_web_and_page_links(client, open_doc, tmp_path):
    doc_id = open_doc(build_linked(tmp_path / "links.pdf"))["docId"]

    body = client.get(f"/v1/docs/{doc_id}/pages/0/links").json()

    assert body["links"] == [
        {"rect": [72, 88, 250, 104], "kind": "uri", "uri": "https://example.com/a", "page": None},
        {"rect": [72, 128, 300, 144], "kind": "page", "uri": None, "page": 2},
        {"rect": [72, 150, 200, 166], "kind": "uri", "uri": "mailto:a@b.c", "page": None},
    ]


def test_links_of_a_page_without_links(client, open_doc, sample_pdf):
    doc_id = open_doc(sample_pdf)["docId"]

    assert client.get(f"/v1/docs/{doc_id}/pages/1/links").json() == {"links": []}


def covers(outer, inner, slack=6.0):
    return (
        outer[0] - slack <= inner[0]
        and outer[1] - slack <= inner[1]
        and inner[2] <= outer[2] + slack
        and inner[3] <= outer[3] + slack
    )


def assert_link_over_heading(client, doc_id, rotation):
    """The web link was drawn over the heading "Heading of page 1", so on the
    displayed page its box must cover that line of the text layer."""
    links = client.get(f"/v1/docs/{doc_id}/pages/0/links").json()["links"]
    heading = client.get(f"/v1/docs/{doc_id}/pages/0/text").json()["lines"][0]["bbox"]

    assert links[0]["kind"] == "uri"
    assert covers(links[0]["rect"], heading), (links[0]["rect"], heading)
    width, height = (
        (PAGE_HEIGHT, PAGE_WIDTH) if rotation in (90, 270) else (PAGE_WIDTH, PAGE_HEIGHT)
    )
    for link in links:
        x0, y0, x1, y1 = link["rect"]
        assert 0 <= x0 < x1 <= width
        assert 0 <= y0 < y1 <= height


@pytest.mark.parametrize("rotation", [0, 90, 180, 270])
def test_links_follow_a_stored_rotation(client, open_doc, tmp_path, rotation):
    doc_id = open_doc(build_linked(tmp_path / "rotated.pdf", rotation))["docId"]

    assert_link_over_heading(client, doc_id, rotation)


@pytest.mark.parametrize("rotation", [90, 180, 270])
def test_links_follow_rotating_in_the_app(client, open_doc, tmp_path, rotation):
    doc_id = open_doc(build_linked(tmp_path / "links.pdf"))["docId"]
    # Load the links once before rotating, so a stale page would show.
    client.get(f"/v1/docs/{doc_id}/pages/0/links")

    response = client.post(
        f"/v1/docs/{doc_id}/pages/rotate", json={"pages": [0], "degrees": rotation}
    )

    assert response.status_code == 200
    assert_link_over_heading(client, doc_id, rotation)


def test_links_page_out_of_range(client, open_doc, sample_pdf):
    doc_id = open_doc(sample_pdf)["docId"]

    assert client.get(f"/v1/docs/{doc_id}/pages/9/links").status_code == 404
