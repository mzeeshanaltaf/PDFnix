import os
import stat
from pathlib import Path

import pymupdf
import pytest

from .conftest import OWNER_PASSWORD, USER_PASSWORD

YELLOW = "#ffeb3b"


def add_annotations(client, doc_id):
    hits = client.post(f"/v1/docs/{doc_id}/search", json={"query": "quick"}).json()["hits"]
    client.post(
        f"/v1/docs/{doc_id}/annotations",
        json={
            "type": "highlight",
            "page": 0,
            "quads": hits[0]["quads"],
            "color": YELLOW,
            "author": "Ada",
            "contents": "Nice",
        },
    )
    client.post(
        f"/v1/docs/{doc_id}/annotations",
        json={
            "type": "note",
            "page": 1,
            "point": [300, 300],
            "contents": "A note",
            "color": "#2196f3",
            "author": "Ada",
        },
    )


def summary(annotations):
    return [(a["page"], a["type"], a["color"], a["author"], a["contents"]) for a in annotations]


def test_annotations_survive_save_and_reopen(client, open_doc, sample_pdf):
    doc_id = open_doc(sample_pdf)["docId"]
    add_annotations(client, doc_id)
    before = client.get(f"/v1/docs/{doc_id}/annotations").json()

    response = client.post(f"/v1/docs/{doc_id}/save", json={})

    assert response.status_code == 200, response.text
    assert response.json()["modified"] is False
    assert response.json()["path"] == os.path.abspath(sample_pdf)
    client.delete(f"/v1/docs/{doc_id}")
    reopened = open_doc(sample_pdf)["docId"]
    after = client.get(f"/v1/docs/{reopened}/annotations").json()
    assert (
        summary(after)
        == summary(before)
        == [
            (0, "highlight", YELLOW, "Ada", "Nice"),
            (1, "note", "#2196f3", "Ada", "A note"),
        ]
    )
    assert after[0]["quads"][0] == pytest.approx(before[0]["quads"][0])
    # The file is a valid, independent PDF.
    with pymupdf.open(sample_pdf) as doc:
        assert [a.type[1] for a in doc[0].annots()] == ["Highlight"]
        assert doc.metadata["title"] == "Sample Document"
        assert len(doc.get_toc()) == 3


def test_undo_still_works_after_saving(client, open_doc, sample_pdf):
    doc_id = open_doc(sample_pdf)["docId"]
    add_annotations(client, doc_id)
    ids = [a["annotId"] for a in client.get(f"/v1/docs/{doc_id}/annotations").json()]

    client.post(f"/v1/docs/{doc_id}/save", json={})

    # Annotation ids are unchanged by saving.
    assert [a["annotId"] for a in client.get(f"/v1/docs/{doc_id}/annotations").json()] == ids
    body = client.post(f"/v1/docs/{doc_id}/undo").json()
    assert body["modified"] is True
    assert len(client.get(f"/v1/docs/{doc_id}/annotations").json()) == 1
    body = client.post(f"/v1/docs/{doc_id}/redo").json()
    assert body["modified"] is False


def test_modified_after_save_undo_and_new_change(client, open_doc, sample_pdf):
    """The saved state cannot be reached again once a different change replaces it."""
    doc_id = open_doc(sample_pdf)["docId"]
    add_annotations(client, doc_id)
    client.post(f"/v1/docs/{doc_id}/save", json={})
    client.post(f"/v1/docs/{doc_id}/undo")

    body = client.post(f"/v1/docs/{doc_id}/pages/rotate", json={"pages": [0], "degrees": 90})

    assert body.json()["modified"] is True
    assert client.post(f"/v1/docs/{doc_id}/undo").json()["modified"] is True


def test_rotation_is_saved(client, open_doc, sample_pdf):
    doc_id = open_doc(sample_pdf)["docId"]
    client.post(f"/v1/docs/{doc_id}/pages/rotate", json={"pages": [1], "degrees": 90})

    client.post(f"/v1/docs/{doc_id}/save", json={})

    with pymupdf.open(sample_pdf) as doc:
        assert [page.rotation for page in doc] == [0, 90, 0]


def test_save_as_writes_a_new_file_and_moves_the_session(client, open_doc, sample_pdf, tmp_path):
    doc_id = open_doc(sample_pdf)["docId"]
    add_annotations(client, doc_id)
    original = Path(sample_pdf).read_bytes()
    target = tmp_path / "sub" / "copy.pdf"
    target.parent.mkdir()

    response = client.post(f"/v1/docs/{doc_id}/save", json={"path": str(target)})

    assert response.status_code == 200, response.text
    assert response.json()["path"] == str(target)
    assert response.json()["fileName"] == "copy.pdf"
    assert Path(sample_pdf).read_bytes() == original
    state = client.get(f"/v1/docs/{doc_id}/state").json()
    assert state["path"] == str(target) and state["modified"] is False
    with pymupdf.open(target) as doc:
        assert len(list(doc[0].annots())) == 1
    # A later plain Save goes to the new path.
    client.post(f"/v1/docs/{doc_id}/pages/rotate", json={"pages": [0], "degrees": 90})
    client.post(f"/v1/docs/{doc_id}/save", json={})
    with pymupdf.open(target) as doc:
        assert doc[0].rotation == 90
    assert Path(sample_pdf).read_bytes() == original


@pytest.mark.parametrize("password", [USER_PASSWORD, OWNER_PASSWORD])
def test_encrypted_document_stays_encrypted(client, open_doc, encrypted_pdf, password):
    doc_id = open_doc(encrypted_pdf, password)["docId"]
    client.post(
        f"/v1/docs/{doc_id}/annotations",
        json={
            "type": "note",
            "page": 0,
            "point": [100, 100],
            "contents": "secret",
            "color": YELLOW,
        },
    )

    assert client.post(f"/v1/docs/{doc_id}/save", json={}).status_code == 200

    with pymupdf.open(encrypted_pdf) as doc:
        assert doc.needs_pass
        assert doc.authenticate("wrong") == 0
        assert doc.authenticate(USER_PASSWORD) == 2
        assert "AES" in doc.metadata["encryption"]
        assert not doc.permissions & pymupdf.PDF_PERM_MODIFY
        assert doc.permissions & pymupdf.PDF_PERM_PRINT
        assert [a.info["content"] for a in doc[0].annots()] == ["secret"]
    with pymupdf.open(encrypted_pdf) as doc:
        assert doc.authenticate(OWNER_PASSWORD) == 4


def test_saving_to_a_locked_file_fails_cleanly(client, open_doc, sample_pdf):
    doc_id = open_doc(sample_pdf)["docId"]
    add_annotations(client, doc_id)
    original = Path(sample_pdf).read_bytes()
    folder = os.path.dirname(sample_pdf)

    # Python opens files without FILE_SHARE_DELETE on Windows, which blocks
    # replacing them, as an editor holding the file open does.
    with open(sample_pdf, "rb"):
        response = client.post(f"/v1/docs/{doc_id}/save", json={})

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "file_locked"
    assert Path(sample_pdf).read_bytes() == original
    assert sorted(os.listdir(folder)) == ["sample.pdf"]  # no temporary file left
    state = client.get(f"/v1/docs/{doc_id}/state").json()
    assert state["modified"] is True and state["canUndo"] is True
    # Once the other program lets go, saving works.
    assert client.post(f"/v1/docs/{doc_id}/save", json={}).status_code == 200


def test_saving_over_a_read_only_file_fails_cleanly(client, open_doc, sample_pdf):
    doc_id = open_doc(sample_pdf)["docId"]
    add_annotations(client, doc_id)
    original = Path(sample_pdf).read_bytes()
    os.chmod(sample_pdf, stat.S_IREAD)
    try:
        response = client.post(f"/v1/docs/{doc_id}/save", json={})
    finally:
        os.chmod(sample_pdf, stat.S_IREAD | stat.S_IWRITE)

    assert response.status_code == 403
    assert response.json()["error"]["code"] == "file_read_only"
    assert Path(sample_pdf).read_bytes() == original


def test_save_as_into_a_missing_folder(client, open_doc, sample_pdf, tmp_path):
    doc_id = open_doc(sample_pdf)["docId"]

    response = client.post(
        f"/v1/docs/{doc_id}/save", json={"path": str(tmp_path / "nope" / "x.pdf")}
    )

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "folder_not_found"
    assert client.get(f"/v1/docs/{doc_id}/state").json()["path"] == os.path.abspath(sample_pdf)


def test_saved_file_is_compacted(client, open_doc, sample_pdf):
    doc_id = open_doc(sample_pdf)["docId"]
    for _ in range(3):
        add_annotations(client, doc_id)
    for _ in range(6):
        client.post(f"/v1/docs/{doc_id}/undo")

    client.post(f"/v1/docs/{doc_id}/save", json={})

    with pymupdf.open(sample_pdf) as doc:
        assert sum(len(list(page.annots())) for page in doc) == 0
        # Unused objects from the undone annotations are not written.
        live = [x for x in range(1, doc.xref_length()) if doc.xref_object(x) != "null"]
        assert len(live) == doc.xref_length() - 1
