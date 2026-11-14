"""Password protection: set, change, remove; applied on save."""

import json

import pymupdf

from pdfengine.recovery import RecoveryStore

from .conftest import OWNER_PASSWORD, USER_PASSWORD

NEW_OPEN = "fresh-open-pw"
NEW_OWNER = "fresh-owner-pw"

ONLY_PRINT = {"print": True, "copy": False, "modify": False, "annotate": False, "fillForms": False}


def declared_permissions(doc) -> int:
    kind, value = doc.xref_get_key(-1, "Encrypt/P")
    assert kind == "int"
    return int(value) & 0xFFFFFFFF


def test_protect_an_unprotected_file(client, sample_pdf, open_doc):
    doc_id = open_doc(sample_pdf)["docId"]
    state = client.get(f"/v1/docs/{doc_id}/security").json()
    assert state["current"]["encrypted"] is False
    assert state["pending"] is None
    assert state["ownerAccess"] is True

    response = client.post(
        f"/v1/docs/{doc_id}/security",
        json={"userPassword": NEW_OPEN, "ownerPassword": NEW_OWNER, "permissions": ONLY_PRINT},
    )
    assert response.status_code == 200, response.text
    state = response.json()
    assert state["modified"] is True
    assert state["pending"] == {
        "action": "set",
        "encrypted": True,
        "method": "AES-256",
        "hasOpenPassword": True,
        "permissions": ONLY_PRINT,
    }
    assert NEW_OPEN not in response.text and NEW_OWNER not in response.text
    # Nothing is written until saved.
    assert not pymupdf.open(sample_pdf).needs_pass

    assert client.post(f"/v1/docs/{doc_id}/save", json={}).status_code == 200
    saved = pymupdf.open(sample_pdf)
    assert saved.needs_pass
    assert saved.authenticate("wrong") == 0
    assert saved.authenticate(NEW_OPEN) == 2
    assert "AES" in saved.metadata["encryption"] and "256" in saved.metadata["encryption"]
    permissions = saved.permissions
    assert permissions & pymupdf.PDF_PERM_PRINT
    assert not permissions & pymupdf.PDF_PERM_COPY
    assert not permissions & pymupdf.PDF_PERM_MODIFY
    assert not permissions & pymupdf.PDF_PERM_ANNOTATE
    assert not permissions & pymupdf.PDF_PERM_FORM
    saved.close()
    owner = pymupdf.open(sample_pdf)
    assert owner.authenticate(NEW_OWNER) == 4
    owner.close()

    state = client.get(f"/v1/docs/{doc_id}/security").json()
    assert state["pending"] is None
    assert state["modified"] is False
    assert state["current"]["encrypted"] is True
    assert state["current"]["permissions"] == ONLY_PRINT

    # Later saves keep writing the new protection.
    client.post(f"/v1/docs/{doc_id}/pages/rotate", json={"degrees": 90, "pages": [0]})
    assert client.post(f"/v1/docs/{doc_id}/save", json={}).status_code == 200
    again = pymupdf.open(sample_pdf)
    assert again.needs_pass and again.authenticate(NEW_OPEN)
    assert again[0].rotation == 90
    again.close()
    # Undo still works after saving with the new encryption.
    assert client.post(f"/v1/docs/{doc_id}/undo").json()["undone"] == "Rotate"


def test_open_password_only_sets_the_owner_password_too(client, sample_pdf, open_doc):
    doc_id = open_doc(sample_pdf)["docId"]
    client.post(
        f"/v1/docs/{doc_id}/security", json={"userPassword": NEW_OPEN, "permissions": ONLY_PRINT}
    ).raise_for_status()
    client.post(f"/v1/docs/{doc_id}/save", json={}).raise_for_status()
    saved = pymupdf.open(sample_pdf)
    assert saved.authenticate(NEW_OPEN) == 6  # user and owner
    assert declared_permissions(saved) & pymupdf.PDF_PERM_COPY == 0


def test_owner_password_only_restricts_without_encrypting_access(client, sample_pdf, open_doc):
    doc_id = open_doc(sample_pdf)["docId"]
    client.post(
        f"/v1/docs/{doc_id}/security", json={"ownerPassword": NEW_OWNER, "permissions": ONLY_PRINT}
    ).raise_for_status()
    client.post(f"/v1/docs/{doc_id}/save", json={}).raise_for_status()
    saved = pymupdf.open(sample_pdf)
    assert not saved.needs_pass
    assert not saved.permissions & pymupdf.PDF_PERM_COPY
    assert saved.permissions & pymupdf.PDF_PERM_PRINT
    state = client.get(f"/v1/docs/{doc_id}/security").json()
    assert state["current"]["hasOpenPassword"] is False


def test_a_password_is_required(client, sample_pdf, open_doc):
    doc_id = open_doc(sample_pdf)["docId"]
    response = client.post(f"/v1/docs/{doc_id}/security", json={"permissions": ONLY_PRINT})
    assert response.status_code == 400
    response = client.post(
        f"/v1/docs/{doc_id}/security", json={"userPassword": "x", "permissions": {"teleport": True}}
    )
    assert response.status_code == 422


def test_removing_needs_the_owner_password(client, encrypted_pdf, open_doc):
    # Opened with the user password: no owner rights.
    doc_id = open_doc(encrypted_pdf, USER_PASSWORD)["docId"]
    state = client.get(f"/v1/docs/{doc_id}/security").json()
    assert state["ownerAccess"] is False
    assert state["current"]["encrypted"] is True
    assert state["current"]["hasOpenPassword"] is True
    assert state["current"]["permissions"] == {
        "print": True,
        "copy": True,
        "modify": False,
        "annotate": False,
        "fillForms": False,
    }

    response = client.request("DELETE", f"/v1/docs/{doc_id}/security")
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "owner_password_required"
    assert response.json()["error"]["wrong"] is False
    response = client.request(
        "DELETE", f"/v1/docs/{doc_id}/security", json={"currentPassword": USER_PASSWORD}
    )
    assert response.status_code == 403 and response.json()["error"]["wrong"] is True
    response = client.request(
        "DELETE", f"/v1/docs/{doc_id}/security", json={"currentPassword": OWNER_PASSWORD}
    )
    assert response.status_code == 200, response.text
    assert response.json()["pending"] == {"action": "remove"}
    assert response.json()["ownerAccess"] is True

    client.post(f"/v1/docs/{doc_id}/save", json={}).raise_for_status()
    saved = pymupdf.open(encrypted_pdf)
    assert not saved.needs_pass
    assert saved.metadata["encryption"] is None
    assert saved.permissions == -4 or saved.permissions & pymupdf.PDF_PERM_MODIFY
    saved.close()
    state = client.get(f"/v1/docs/{doc_id}/security").json()
    assert state["current"]["encrypted"] is False
    # Saving again keeps it unencrypted.
    client.post(f"/v1/docs/{doc_id}/save", json={}).raise_for_status()
    assert pymupdf.open(encrypted_pdf).metadata["encryption"] is None


def test_owner_opened_file_can_be_unprotected_directly(client, encrypted_pdf, open_doc):
    doc_id = open_doc(encrypted_pdf, OWNER_PASSWORD)["docId"]
    assert client.get(f"/v1/docs/{doc_id}/security").json()["ownerAccess"] is True
    assert client.request("DELETE", f"/v1/docs/{doc_id}/security").status_code == 200


def test_changing_the_password_of_a_protected_file(client, encrypted_pdf, open_doc):
    doc_id = open_doc(encrypted_pdf, USER_PASSWORD)["docId"]
    body = {"userPassword": NEW_OPEN, "permissions": ONLY_PRINT}
    assert client.post(f"/v1/docs/{doc_id}/security", json=body).status_code == 403
    body["currentPassword"] = OWNER_PASSWORD
    assert client.post(f"/v1/docs/{doc_id}/security", json=body).status_code == 200
    client.post(f"/v1/docs/{doc_id}/save", json={}).raise_for_status()
    saved = pymupdf.open(encrypted_pdf)
    assert saved.authenticate(USER_PASSWORD) == 0
    assert saved.authenticate(NEW_OPEN)


def test_taking_back_an_unsaved_protection(client, sample_pdf, open_doc):
    doc_id = open_doc(sample_pdf)["docId"]
    client.post(f"/v1/docs/{doc_id}/security", json={"userPassword": NEW_OPEN}).raise_for_status()
    response = client.request("DELETE", f"/v1/docs/{doc_id}/security")
    assert response.status_code == 200
    assert response.json()["pending"] is None
    assert response.json()["modified"] is False
    assert client.request("DELETE", f"/v1/docs/{doc_id}/security").status_code == 400


def test_recovery_copy_is_encrypted_like_the_next_save(app, client, sample_pdf, open_doc, tmp_path):
    doc_id = open_doc(sample_pdf)["docId"]
    client.post(f"/v1/docs/{doc_id}/security", json={"userPassword": NEW_OPEN}).raise_for_status()
    store = RecoveryStore(str(tmp_path / "recovery"), app.state.sessions)
    session = app.state.sessions.get(doc_id)
    assert store.write(session)
    copy = pymupdf.open(tmp_path / "recovery" / f"{doc_id}.pdf")
    assert copy.needs_pass and copy.authenticate(NEW_OPEN)
    meta = json.loads((tmp_path / "recovery" / f"{doc_id}.json").read_text())
    assert meta["encrypted"] is True


def test_print_file_is_an_unencrypted_copy_of_the_current_state(client, encrypted_pdf, open_doc):
    import os
    import shutil

    doc_id = open_doc(encrypted_pdf, USER_PASSWORD)["docId"]
    client.post(f"/v1/docs/{doc_id}/pages/rotate", json={"degrees": 90, "pages": [1]})
    path = client.post(f"/v1/docs/{doc_id}/print-file").json()["path"]
    try:
        assert os.path.basename(os.path.dirname(path)).startswith("pdfnix-print-")
        assert os.path.basename(path) == "encrypted.pdf"
        printed = pymupdf.open(path)
        assert not printed.needs_pass
        assert printed.page_count == 2 and printed[1].rotation == 90
        printed.close()
    finally:
        shutil.rmtree(os.path.dirname(path), ignore_errors=True)
    # The document itself is unchanged by this.
    assert client.get(f"/v1/docs/{doc_id}/state").json()["undoName"] == "Rotate"
