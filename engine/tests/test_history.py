import pymupdf

GREEN = "#4caf50"


def note(client, doc_id, page=0, x=50, text="n"):
    response = client.post(
        f"/v1/docs/{doc_id}/annotations",
        json={"type": "note", "page": page, "point": [x, 50], "contents": text, "color": GREEN},
    )
    assert response.status_code == 200, response.text
    return response.json()


def contents(client, doc_id):
    return [a["contents"] for a in client.get(f"/v1/docs/{doc_id}/annotations").json()]


def undo(client, doc_id):
    response = client.post(f"/v1/docs/{doc_id}/undo")
    assert response.status_code == 200, response.text
    return response.json()


def redo(client, doc_id):
    response = client.post(f"/v1/docs/{doc_id}/redo")
    assert response.status_code == 200, response.text
    return response.json()


def test_fresh_document_has_nothing_to_undo(client, open_doc, sample_pdf):
    opened = open_doc(sample_pdf)

    assert opened["canUndo"] is False and opened["canRedo"] is False
    assert opened["modified"] is False
    state = client.get(f"/v1/docs/{opened['docId']}/state").json()
    assert state == {
        "path": opened["path"],
        "fileName": "sample.pdf",
        "revision": 0,
        "canUndo": False,
        "canRedo": False,
        "undoName": None,
        "redoName": None,
        "modified": False,
    }
    assert client.post(f"/v1/docs/{opened['docId']}/undo").status_code == 400
    assert client.post(f"/v1/docs/{opened['docId']}/redo").status_code == 400


def test_undo_removes_and_redo_restores_an_annotation(client, open_doc, sample_pdf):
    doc_id = open_doc(sample_pdf)["docId"]
    created = note(client, doc_id, page=1)
    annot_id = created["annotation"]["annotId"]

    undone = undo(client, doc_id)

    assert contents(client, doc_id) == []
    assert undone["dirtyPages"] == [1]
    assert undone["undone"] == "Note"
    assert (undone["canUndo"], undone["canRedo"]) == (False, True)
    assert (undone["undoName"], undone["redoName"]) == (None, "Note")
    assert undone["modified"] is False
    assert undone["revision"] == created["revision"] + 1

    redone = redo(client, doc_id)

    assert contents(client, doc_id) == ["n"]
    assert client.get(f"/v1/docs/{doc_id}/annotations").json()[0]["annotId"] == annot_id
    assert (redone["canUndo"], redone["canRedo"]) == (True, False)
    assert redone["undoName"] == "Note" and redone["modified"] is True


def test_mixed_operations_undo_in_reverse_order(client, open_doc, sample_pdf):
    doc_id = open_doc(sample_pdf)["docId"]
    first = note(client, doc_id, text="first")["annotation"]["annotId"]
    note(client, doc_id, x=150, text="second")
    client.patch(f"/v1/docs/{doc_id}/annotations/{first}", json={"contents": "first, edited"})
    client.post(f"/v1/docs/{doc_id}/pages/rotate", json={"pages": [0], "degrees": 90})
    client.delete(f"/v1/docs/{doc_id}/annotations/{first}")

    seen = []
    for _ in range(5):
        body = undo(client, doc_id)
        seen.append((body["undone"], sorted(contents(client, doc_id))))

    assert seen == [
        ("Delete", ["first, edited", "second"]),
        ("Rotate", ["first, edited", "second"]),
        ("Edit Comment", ["first", "second"]),
        ("Note", ["first"]),
        ("Note", []),
    ]
    for _ in range(5):
        redo(client, doc_id)
    assert contents(client, doc_id) == ["second"]
    assert client.get(f"/v1/docs/{doc_id}/state").json()["undoName"] == "Delete"


def test_undoing_a_rotation_reports_the_page_size(client, open_doc, sample_pdf):
    doc_id = open_doc(sample_pdf)["docId"]
    client.post(f"/v1/docs/{doc_id}/pages/rotate", json={"pages": [2], "degrees": 90})

    body = undo(client, doc_id)

    assert body["dirtyPages"] == [2]
    assert body["pages"] == [{"index": 2, "width": 612, "height": 792, "rotation": 0}]
    image = pymupdf.Pixmap(client.get(f"/v1/docs/{doc_id}/pages/2/render").content)
    assert (image.width, image.height) == (612, 792)


def test_a_new_change_discards_redo(client, open_doc, sample_pdf):
    doc_id = open_doc(sample_pdf)["docId"]
    note(client, doc_id, text="a")
    note(client, doc_id, x=150, text="b")
    undo(client, doc_id)

    body = note(client, doc_id, x=250, text="c")

    assert body["canRedo"] is False
    assert sorted(contents(client, doc_id)) == ["a", "c"]
    assert client.post(f"/v1/docs/{doc_id}/redo").status_code == 400


def test_text_and_search_work_on_pages_rotated_in_the_session(client, open_doc, sample_pdf):
    """Reading text must not change the document (the journal forbids it)."""
    doc_id = open_doc(sample_pdf)["docId"]
    client.post(f"/v1/docs/{doc_id}/pages/rotate", json={"degrees": 90})

    text = client.get(f"/v1/docs/{doc_id}/pages/0/text")
    search = client.post(f"/v1/docs/{doc_id}/search", json={"query": "quick"})
    render = client.get(f"/v1/docs/{doc_id}/pages/0/render")

    assert text.status_code == 200 and text.json()["lines"]
    assert search.status_code == 200 and len(search.json()["hits"]) == 3
    assert render.status_code == 200
    assert client.get(f"/v1/docs/{doc_id}/state").json()["undoName"] == "Rotate"


def test_failed_change_is_not_left_behind(open_doc, client, sample_pdf, app):
    """A change that fails half way is undone and cannot be redone."""
    doc_id = open_doc(sample_pdf)["docId"]
    note(client, doc_id, text="kept")
    session = app.state.sessions.get(doc_id)

    try:
        with session.edit("Broken") as step:
            session.page(0).add_text_annot((300, 300), "partial")
            step.pages.add(0)
            raise RuntimeError("boom")
    except RuntimeError:
        pass

    assert contents(client, doc_id) == ["kept"]
    state = client.get(f"/v1/docs/{doc_id}/state").json()
    assert state["canRedo"] is False and state["undoName"] == "Note"
    undo(client, doc_id)
    assert contents(client, doc_id) == []
