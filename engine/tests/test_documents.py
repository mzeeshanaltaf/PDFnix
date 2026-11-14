import os

from .conftest import OWNER_PASSWORD, PAGE_HEIGHT, PAGE_WIDTH, USER_PASSWORD


def test_open_returns_page_metadata(client, sample_pdf):
    response = client.post("/v1/docs/open", json={"path": sample_pdf})

    assert response.status_code == 200
    body = response.json()
    assert body["docId"]
    assert body["pageCount"] == 3
    assert body["pages"] == [{"width": PAGE_WIDTH, "height": PAGE_HEIGHT, "rotation": 0}] * 3
    assert body["title"] == "Sample Document"
    assert body["fileName"] == "sample.pdf"
    assert os.path.samefile(body["path"], sample_pdf)
    assert body["isEncrypted"] is False
    assert body["hasTextLayer"] is True
    assert body["revision"] == 0


def test_open_reports_stored_rotation_as_displayed_size(open_doc, rotated_pdf):
    pages = open_doc(rotated_pdf)["pages"]

    assert [page["rotation"] for page in pages] == [0, 90, 180, 270]
    assert (pages[0]["width"], pages[0]["height"]) == (PAGE_WIDTH, PAGE_HEIGHT)
    assert (pages[1]["width"], pages[1]["height"]) == (PAGE_HEIGHT, PAGE_WIDTH)
    assert (pages[2]["width"], pages[2]["height"]) == (PAGE_WIDTH, PAGE_HEIGHT)
    assert (pages[3]["width"], pages[3]["height"]) == (PAGE_HEIGHT, PAGE_WIDTH)


def test_open_detects_a_document_without_text(open_doc, scanned_pdf):
    assert open_doc(scanned_pdf)["hasTextLayer"] is False


def test_open_does_not_lock_the_file(open_doc, sample_pdf):
    open_doc(sample_pdf)

    # The session works on a copy in memory, so the file can be replaced.
    os.replace(sample_pdf, sample_pdf + ".moved")
    assert not os.path.exists(sample_pdf)


def test_the_same_file_can_be_opened_twice(open_doc, client, sample_pdf):
    first = open_doc(sample_pdf)
    second = open_doc(sample_pdf)

    assert first["docId"] != second["docId"]
    assert client.get("/v1/health").json()["openDocuments"] == 2


def test_open_missing_file(client, tmp_path):
    response = client.post("/v1/docs/open", json={"path": str(tmp_path / "nope.pdf")})

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "file_not_found"


def test_open_a_folder(client, tmp_path):
    response = client.post("/v1/docs/open", json={"path": str(tmp_path)})

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "file_not_found"


def test_open_a_file_that_is_not_a_pdf(client, tmp_path):
    path = tmp_path / "notes.pdf"
    path.write_text("just some text, not a PDF")

    response = client.post("/v1/docs/open", json={"path": str(path)})

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "invalid_pdf"
    assert client.get("/v1/health").json()["openDocuments"] == 0


def test_open_an_empty_file(client, tmp_path):
    path = tmp_path / "empty.pdf"
    path.write_bytes(b"")

    response = client.post("/v1/docs/open", json={"path": str(path)})

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "invalid_pdf"


def test_open_rejects_unknown_fields(client, sample_pdf):
    response = client.post("/v1/docs/open", json={"path": sample_pdf, "pasword": "typo"})

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "invalid_request"


def test_encrypted_without_password(client, encrypted_pdf):
    response = client.post("/v1/docs/open", json={"path": encrypted_pdf})

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "password_required"
    assert client.get("/v1/health").json()["openDocuments"] == 0


def test_encrypted_with_wrong_password(client, encrypted_pdf):
    response = client.post("/v1/docs/open", json={"path": encrypted_pdf, "password": "wrong"})

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "password_incorrect"
    assert client.get("/v1/health").json()["openDocuments"] == 0


def test_encrypted_with_correct_password(client, encrypted_pdf):
    response = client.post("/v1/docs/open", json={"path": encrypted_pdf, "password": USER_PASSWORD})

    assert response.status_code == 200
    body = response.json()
    assert body["isEncrypted"] is True
    assert body["pageCount"] == 2
    assert body["hasTextLayer"] is True

    # The content really is readable.
    text = client.get(f"/v1/docs/{body['docId']}/pages/0/text").json()
    assert text["lines"][0]["words"][0]["text"] == "Heading"


def test_encrypted_with_owner_password(open_doc, encrypted_pdf):
    assert open_doc(encrypted_pdf, OWNER_PASSWORD)["isEncrypted"] is True


def test_password_is_ignored_for_an_unprotected_file(open_doc, sample_pdf):
    assert open_doc(sample_pdf, "not needed")["isEncrypted"] is False


def test_close_frees_the_session(client, open_doc, sample_pdf):
    doc_id = open_doc(sample_pdf)["docId"]
    assert client.get("/v1/health").json()["openDocuments"] == 1

    response = client.delete(f"/v1/docs/{doc_id}")

    assert response.status_code == 200
    assert response.json() == {"closed": True}
    assert client.get("/v1/health").json()["openDocuments"] == 0
    for path in ("pages/0/render", "pages/0/text", "outline", "info"):
        gone = client.get(f"/v1/docs/{doc_id}/{path}")
        assert gone.status_code == 404, path
        assert gone.json()["error"]["code"] == "not_found"


def test_close_releases_the_document(app, client, open_doc, sample_pdf):
    doc_id = open_doc(sample_pdf)["docId"]
    session = app.state.sessions.get(doc_id)
    document = session.doc

    client.delete(f"/v1/docs/{doc_id}")

    assert document.is_closed


def test_list_documents(client, open_doc, sample_pdf):
    assert client.get("/v1/docs").json() == {"documents": []}
    doc_id = open_doc(sample_pdf)["docId"]

    documents = client.get("/v1/docs").json()["documents"]

    assert len(documents) == 1
    entry = documents[0]
    assert entry["docId"] == doc_id
    assert entry["path"] == os.path.abspath(sample_pdf)
    assert entry["pageCount"] >= 1
    assert entry["modified"] is False and entry["revision"] == 0


def test_close_all_documents(client, open_doc, sample_pdf):
    first = open_doc(sample_pdf)["docId"]
    open_doc(sample_pdf)

    response = client.delete("/v1/docs")

    assert response.status_code == 200
    assert response.json() == {"closed": 2}
    assert client.get("/v1/health").json()["openDocuments"] == 0
    assert client.get(f"/v1/docs/{first}/info").status_code == 404
    assert client.delete("/v1/docs").json() == {"closed": 0}


def test_close_unknown_document(client):
    response = client.delete("/v1/docs/does-not-exist")

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "not_found"


def test_document_endpoints_need_the_token(anonymous_client, sample_pdf):
    response = anonymous_client.post("/v1/docs/open", json={"path": sample_pdf})

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "unauthorized"
