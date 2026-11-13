import os
import time

import pymupdf
import pytest
from fastapi.testclient import TestClient

from pdfengine.server import TOKEN_HEADER, create_app

from .conftest import TEST_ORIGIN, TEST_TOKEN, USER_PASSWORD

GREEN = "#4caf50"


@pytest.fixture
def recovery_dir(tmp_path):
    folder = tmp_path / "recovery"
    folder.mkdir()
    return folder


def make_client(recovery_dir, delay=0.0):
    app = create_app(
        TEST_TOKEN, [TEST_ORIGIN], recovery_dir=str(recovery_dir), recovery_delay=delay
    )
    return app, TestClient(app, headers={TOKEN_HEADER: TEST_TOKEN}, raise_server_exceptions=False)


def open_doc(client, path, password=None):
    body = {"path": path}
    if password:
        body["password"] = password
    response = client.post("/v1/docs/open", json=body)
    assert response.status_code == 200, response.text
    return response.json()["docId"]


def add_note(client, doc_id, text="unsaved work"):
    response = client.post(
        f"/v1/docs/{doc_id}/annotations",
        json={"type": "note", "page": 0, "point": [100, 100], "contents": text, "color": GREEN},
    )
    assert response.status_code == 200, response.text


def files(folder):
    return sorted(os.listdir(folder))


def test_copy_is_written_for_unsaved_changes_and_removed_on_save(recovery_dir, sample_pdf):
    app, client = make_client(recovery_dir)
    with client:
        doc_id = open_doc(client, sample_pdf)
        app.state.recovery.tick()
        assert files(recovery_dir) == []  # nothing unsaved yet

        add_note(client, doc_id)
        app.state.recovery.tick()
        assert files(recovery_dir) == [f"{doc_id}.json", f"{doc_id}.pdf"]
        with pymupdf.open(recovery_dir / f"{doc_id}.pdf") as copy:
            assert [a.info["content"] for a in copy[0].annots()] == ["unsaved work"]

        client.post(f"/v1/docs/{doc_id}/save", json={})
        assert files(recovery_dir) == []


def test_copy_waits_for_the_delay(recovery_dir, sample_pdf):
    app, client = make_client(recovery_dir, delay=120)
    with client:
        doc_id = open_doc(client, sample_pdf)
        add_note(client, doc_id)
        session = app.state.sessions.get(doc_id)

        app.state.recovery.tick(now=session.unrecovered_since + 60)
        assert files(recovery_dir) == []
        app.state.recovery.tick(now=session.unrecovered_since + 121)
        assert len(files(recovery_dir)) == 2


def test_copy_is_removed_on_close_and_when_undone_to_saved(recovery_dir, sample_pdf):
    app, client = make_client(recovery_dir)
    with client:
        doc_id = open_doc(client, sample_pdf)
        add_note(client, doc_id)
        app.state.recovery.tick()
        assert files(recovery_dir)

        client.post(f"/v1/docs/{doc_id}/undo")
        app.state.recovery.tick()
        assert files(recovery_dir) == []

        client.post(f"/v1/docs/{doc_id}/redo")
        app.state.recovery.tick()
        assert files(recovery_dir)
        client.delete(f"/v1/docs/{doc_id}")
        assert files(recovery_dir) == []


def test_unsaved_work_is_kept_on_shutdown_and_restored(recovery_dir, sample_pdf):
    app, client = make_client(recovery_dir, delay=3600)
    with client:
        doc_id = open_doc(client, sample_pdf)
        add_note(client, doc_id)
        assert files(recovery_dir) == []  # not due yet
    # Leaving the block shuts the engine down, which writes the copy.
    assert len(files(recovery_dir)) == 2

    _app, client = make_client(recovery_dir)
    with client:
        entries = client.get("/v1/recovery").json()
        assert len(entries) == 1
        entry = entries[0]
        assert entry["originalPath"] == os.path.abspath(sample_pdf)
        assert entry["fileName"] == "sample.pdf"
        assert entry["isEncrypted"] is False
        assert entry["pageCount"] == 3

        restored = client.post(f"/v1/recovery/{entry['recoveryId']}/open", json={})
        assert restored.status_code == 200, restored.text
        body = restored.json()
        assert body["path"] == os.path.abspath(sample_pdf)
        assert body["modified"] is True and body["canUndo"] is False
        notes = client.get(f"/v1/docs/{body['docId']}/annotations").json()
        assert [n["contents"] for n in notes] == ["unsaved work"]
        # The copy now belongs to the open document and is not offered again.
        assert client.get("/v1/recovery").json() == []
        assert files(recovery_dir) == [f"{body['docId']}.json", f"{body['docId']}.pdf"]

        client.post(f"/v1/docs/{body['docId']}/save", json={})
        assert files(recovery_dir) == []
    with pymupdf.open(sample_pdf) as doc:
        assert [a.info["content"] for a in doc[0].annots()] == ["unsaved work"]


def test_closing_all_documents_keeps_unsaved_work(recovery_dir, sample_pdf):
    """A window reload closes every session; its unsaved work is offered after."""
    _app, client = make_client(recovery_dir, delay=3600)
    with client:
        doc_id = open_doc(client, sample_pdf)
        add_note(client, doc_id)

        client.delete("/v1/docs")

        assert [e["fileName"] for e in client.get("/v1/recovery").json()] == ["sample.pdf"]


def test_discarding_a_copy(recovery_dir, sample_pdf):
    _app, client = make_client(recovery_dir, delay=3600)
    with client:
        doc_id = open_doc(client, sample_pdf)
        add_note(client, doc_id)
        client.delete("/v1/docs")
        recovery_id = client.get("/v1/recovery").json()[0]["recoveryId"]

        assert client.delete(f"/v1/recovery/{recovery_id}").status_code == 200

        assert client.get("/v1/recovery").json() == []
        assert files(recovery_dir) == []


def test_encrypted_copy_needs_the_password(recovery_dir, encrypted_pdf):
    _app, client = make_client(recovery_dir, delay=3600)
    with client:
        doc_id = open_doc(client, encrypted_pdf, USER_PASSWORD)
        add_note(client, doc_id)
        client.delete("/v1/docs")
        entry = client.get("/v1/recovery").json()[0]
        assert entry["isEncrypted"] is True
        with pymupdf.open(recovery_dir / f"{entry['recoveryId']}.pdf") as copy:
            assert copy.needs_pass  # never written to disk decrypted

        missing = client.post(f"/v1/recovery/{entry['recoveryId']}/open", json={})
        assert missing.status_code == 401
        assert missing.json()["error"]["code"] == "password_required"

        restored = client.post(
            f"/v1/recovery/{entry['recoveryId']}/open", json={"password": USER_PASSWORD}
        )
        assert restored.status_code == 200, restored.text


def test_recovery_ids_cannot_reach_outside_the_folder(recovery_dir):
    _app, client = make_client(recovery_dir)
    with client:
        assert client.post("/v1/recovery/..%5Cx/open", json={}).status_code == 404
        assert client.delete("/v1/recovery/..%5Cx").status_code == 404


def test_background_writer_runs(recovery_dir, sample_pdf):
    app = create_app(TEST_TOKEN, [TEST_ORIGIN], recovery_dir=str(recovery_dir), recovery_delay=0)
    app.state.recovery.tick_seconds = 0.05
    client = TestClient(app, headers={TOKEN_HEADER: TEST_TOKEN})
    with client:
        doc_id = open_doc(client, sample_pdf)
        add_note(client, doc_id)
        deadline = time.monotonic() + 5
        while not files(recovery_dir) and time.monotonic() < deadline:
            time.sleep(0.05)
        assert len(files(recovery_dir)) == 2
