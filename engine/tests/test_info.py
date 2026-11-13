import os

import pymupdf
import pytest

from pdfengine.info import parse_pdf_date

from .conftest import PAGE_HEIGHT, PAGE_WIDTH, USER_PASSWORD


def test_outline(client, open_doc, sample_pdf):
    doc_id = open_doc(sample_pdf)["docId"]

    response = client.get(f"/v1/docs/{doc_id}/outline")

    assert response.status_code == 200
    assert response.json() == [
        {"title": "Chapter One", "page": 0, "level": 1},
        {"title": "Section 1.1", "page": 1, "level": 2},
        {"title": "Chapter Two", "page": 2, "level": 1},
    ]


def test_outline_of_a_document_without_one(client, open_doc, scanned_pdf):
    doc_id = open_doc(scanned_pdf)["docId"]

    assert client.get(f"/v1/docs/{doc_id}/outline").json() == []


def test_outline_entry_without_a_target_page(client, open_doc, tmp_path):
    doc = pymupdf.open()
    doc.new_page()
    doc.set_toc([[1, "Here", 1], [1, "Elsewhere", -1]])
    path = tmp_path / "toc.pdf"
    doc.save(path)
    doc.close()
    doc_id = open_doc(str(path))["docId"]

    outline = client.get(f"/v1/docs/{doc_id}/outline").json()

    assert [entry["page"] for entry in outline] == [0, None]


def test_info(client, open_doc, sample_pdf):
    doc_id = open_doc(sample_pdf)["docId"]

    body = client.get(f"/v1/docs/{doc_id}/info").json()

    assert body["fileName"] == "sample.pdf"
    assert os.path.samefile(body["path"], sample_pdf)
    assert body["fileSize"] == os.path.getsize(sample_pdf)
    assert body["pageCount"] == 3
    assert body["pdfVersion"] == "1.7"
    assert body["title"] == "Sample Document"
    assert body["author"] == "Test Author"
    assert body["subject"] == "Testing"
    assert body["keywords"] == "pdf, test"
    assert body["createdAt"] == "2024-01-31T12:00:00+01:00"
    assert body["modifiedAt"] == "2024-02-01T08:30:00+00:00"
    assert body["isEncrypted"] is False
    assert body["encryption"] is None
    assert body["pageSize"] == {"width": PAGE_WIDTH, "height": PAGE_HEIGHT}
    assert all(body["permissions"].values())
    assert set(body["permissions"]) == {
        "print",
        "printHighQuality",
        "modify",
        "copy",
        "annotate",
        "fillForms",
        "accessibility",
        "assemble",
    }


def test_info_of_an_encrypted_document(client, open_doc, encrypted_pdf):
    doc_id = open_doc(encrypted_pdf, USER_PASSWORD)["docId"]

    body = client.get(f"/v1/docs/{doc_id}/info").json()

    assert body["isEncrypted"] is True
    assert "AES" in body["encryption"]
    assert body["permissions"]["print"] is True
    assert body["permissions"]["copy"] is True
    assert body["permissions"]["modify"] is False
    assert body["permissions"]["annotate"] is False


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        ("D:20240131120000+01'00'", "2024-01-31T12:00:00+01:00"),
        ("D:20240131120000-05'30'", "2024-01-31T12:00:00-05:30"),
        ("D:20240131120000Z", "2024-01-31T12:00:00+00:00"),
        ("D:20240131120000Z00'00'", "2024-01-31T12:00:00+00:00"),
        ("D:20240131120000", "2024-01-31T12:00:00"),
        ("20240131", "2024-01-31T00:00:00"),
        ("D:2024", "2024-01-01T00:00:00"),
        ("D:20241399000000", None),
        ("yesterday", None),
        ("", None),
        (None, None),
    ],
)
def test_parse_pdf_date(value, expected):
    assert parse_pdf_date(value) == expected
