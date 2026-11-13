"""Page management: reorder, delete, duplicate, insert, extract, split, merge."""

import os

import pymupdf
import pytest

from pdfengine.textpages import text_page

from .conftest import OWNER_PASSWORD, USER_PASSWORD


def numbered(path, count=6, prefix="Page", widths=None, password=None):
    """A PDF whose pages say "<prefix>-1" … and have one outline entry each;
    page 1 links to page 4 (when there is one)."""
    doc = pymupdf.open()
    for number in range(1, count + 1):
        width = widths[number - 1] if widths else 400
        page = doc.new_page(width=width, height=500)
        page.insert_text((50, 100), f"{prefix}-{number}", fontsize=20)
    doc.set_toc([[1, f"{prefix} chapter {n}", n] for n in range(1, count + 1)])
    if count >= 4:
        doc[0].insert_link(
            {"kind": pymupdf.LINK_GOTO, "from": pymupdf.Rect(40, 200, 140, 220), "page": 3}
        )
    options = {}
    if password:
        options = dict(
            encryption=pymupdf.PDF_ENCRYPT_AES_256, user_pw=password, owner_pw=OWNER_PASSWORD
        )
    doc.save(path, **options)
    doc.close()
    return str(path)


@pytest.fixture
def six(tmp_path):
    return numbered(tmp_path / "six.pdf")


def labels_of(doc):
    return [text_page(page, 0).extractText().strip() for page in doc]


def labels(app, doc_id):
    session = app.state.sessions.get(doc_id)
    with session.lock:
        return labels_of(session.doc)


def file_labels(path, password=None):
    doc = pymupdf.open(path)
    if password:
        doc.authenticate(password)
    try:
        return labels_of(doc)
    finally:
        doc.close()


def post(client, doc_id, action, **body):
    return client.post(f"/v1/docs/{doc_id}/{action}", json=body)


def P(*numbers, prefix="Page"):
    return [f"{prefix}-{n}" for n in numbers]


# --- Reorder ------------------------------------------------------------------------


def test_reorder_gives_the_requested_sequence(client, app, open_doc, six):
    doc_id = open_doc(six)["docId"]

    response = post(client, doc_id, "pages/reorder", order=[5, 0, 1, 2, 3, 4])

    assert response.status_code == 200, response.text
    result = response.json()
    assert result["structure"] is True
    assert result["dirtyPages"] == list(range(6))
    assert [page["index"] for page in result["pages"]] == list(range(6))
    assert result["undoName"] == "Move Pages"
    assert labels(app, doc_id) == P(6, 1, 2, 3, 4, 5)


def test_reorder_keeps_outline_and_links_pointing_at_the_same_pages(client, app, open_doc, six):
    doc_id = open_doc(six)["docId"]

    post(client, doc_id, "pages/reorder", order=[5, 4, 3, 2, 1, 0])

    outline = client.get(f"/v1/docs/{doc_id}/outline").json()
    targets = {entry["title"]: entry["page"] for entry in outline}
    assert targets["Page chapter 1"] == 5
    assert targets["Page chapter 6"] == 0
    session = app.state.sessions.get(doc_id)
    with session.lock:
        # Page-1 (now index 5) links to Page-4, now at index 2.
        assert [link["page"] for link in session.doc[5].get_links()] == [2]


def test_reorder_rejects_an_incomplete_order(client, open_doc, six):
    doc_id = open_doc(six)["docId"]

    for order in ([0, 1, 2], [0, 0, 1, 2, 3, 4], [0, 1, 2, 3, 4, 6]):
        response = post(client, doc_id, "pages/reorder", order=order)
        assert response.status_code == 400, order


def test_reorder_to_the_same_order_changes_nothing(client, open_doc, six):
    doc_id = open_doc(six)["docId"]

    result = post(client, doc_id, "pages/reorder", order=list(range(6))).json()

    assert result["revision"] == 0
    assert result["canUndo"] is False


# --- Delete --------------------------------------------------------------------------


def test_delete_removes_the_pages_and_their_outline_entries(client, app, open_doc, six):
    doc_id = open_doc(six)["docId"]

    result = post(client, doc_id, "pages/delete", pages=[1, 3]).json()

    assert result["pageCount"] == 4
    assert result["undoName"] == "Delete Pages"
    assert labels(app, doc_id) == P(1, 3, 5, 6)
    titles = [entry["title"] for entry in client.get(f"/v1/docs/{doc_id}/outline").json()]
    assert titles == ["Page chapter 1", "Page chapter 3", "Page chapter 5", "Page chapter 6"]


def test_delete_refuses_to_delete_every_page(client, app, open_doc, six):
    doc_id = open_doc(six)["docId"]

    response = post(client, doc_id, "pages/delete", pages=list(range(6)))

    assert response.status_code == 400
    assert "at least one page" in response.json()["error"]["message"]
    assert len(labels(app, doc_id)) == 6


def test_delete_rejects_pages_out_of_range(client, open_doc, six):
    doc_id = open_doc(six)["docId"]

    assert post(client, doc_id, "pages/delete", pages=[6]).status_code == 400
    assert post(client, doc_id, "pages/delete", pages=[]).status_code == 400


# --- Duplicate ------------------------------------------------------------------------


def test_duplicate_puts_a_copy_after_each_page(client, app, open_doc, six):
    doc_id = open_doc(six)["docId"]

    result = post(client, doc_id, "pages/duplicate", pages=[0, 5]).json()

    assert result["pageCount"] == 8
    assert labels(app, doc_id) == P(1, 1, 2, 3, 4, 5, 6, 6)


def test_duplicated_pages_have_their_own_annotations(client, app, open_doc, six):
    doc_id = open_doc(six)["docId"]
    created = client.post(
        f"/v1/docs/{doc_id}/annotations",
        json={"type": "square", "page": 0, "rect": [50, 50, 150, 150], "color": "#ff0000"},
    ).json()["annotation"]

    post(client, doc_id, "pages/duplicate", pages=[0])
    copy_annots = client.get(f"/v1/docs/{doc_id}/annotations", params={"page": 1}).json()
    assert len(copy_annots) == 1
    assert copy_annots[0]["annotId"] != created["annotId"]

    # Deleting the original's annotation leaves the copy's alone.
    client.delete(f"/v1/docs/{doc_id}/annotations/{created['annotId']}", params={"page": 0})
    assert client.get(f"/v1/docs/{doc_id}/annotations", params={"page": 0}).json() == []
    assert len(client.get(f"/v1/docs/{doc_id}/annotations", params={"page": 1}).json()) == 1


# --- Insert ----------------------------------------------------------------------------


def test_insert_blank_takes_the_size_of_the_neighbour(client, app, tmp_path, open_doc):
    path = numbered(tmp_path / "mixed.pdf", count=3, widths=[300, 450, 600])
    doc_id = open_doc(path)["docId"]

    result = post(client, doc_id, "pages/insert-blank", at=1, count=2).json()

    assert result["pageCount"] == 5
    assert labels(app, doc_id) == ["Page-1", "", "", "Page-2", "Page-3"]
    widths = [page["width"] for page in result["pages"]]
    assert widths == [300, 450, 450, 450, 600]
    appended = post(client, doc_id, "pages/insert-blank", at=5).json()
    assert appended["pages"][5]["width"] == 600


def test_insert_blank_with_an_explicit_size(client, open_doc, six):
    doc_id = open_doc(six)["docId"]

    result = post(client, doc_id, "pages/insert-blank", at=0, width=200, height=100).json()

    assert (result["pages"][0]["width"], result["pages"][0]["height"]) == (200, 100)


def test_insert_blank_rejects_a_bad_position(client, open_doc, six):
    doc_id = open_doc(six)["docId"]

    assert post(client, doc_id, "pages/insert-blank", at=7).status_code == 400
    assert post(client, doc_id, "pages/insert-blank", at=0, count=0).status_code == 400


def test_insert_pdf_at_a_position(client, app, tmp_path, open_doc, six):
    other = numbered(tmp_path / "other.pdf", count=3, prefix="Other")
    doc_id = open_doc(six)["docId"]

    result = post(client, doc_id, "pages/insert-pdf", path=other, at=2).json()

    assert result["pageCount"] == 9
    assert result["undoName"] == "Insert Pages"
    assert labels(app, doc_id) == P(1, 2) + P(1, 2, 3, prefix="Other") + P(3, 4, 5, 6)


def test_insert_pdf_with_chosen_pages_in_order(client, app, tmp_path, open_doc, six):
    other = numbered(tmp_path / "other.pdf", count=3, prefix="Other")
    doc_id = open_doc(six)["docId"]

    post(client, doc_id, "pages/insert-pdf", path=other, at=6, fromPages=[2, 0])

    assert labels(app, doc_id)[6:] == P(3, 1, prefix="Other")


def test_insert_encrypted_pdf_needs_its_password(client, app, tmp_path, open_doc, six):
    locked = numbered(tmp_path / "locked.pdf", count=2, prefix="Locked", password=USER_PASSWORD)
    doc_id = open_doc(six)["docId"]

    missing = post(client, doc_id, "pages/insert-pdf", path=locked, at=0)
    wrong = post(client, doc_id, "pages/insert-pdf", path=locked, at=0, password="nope")
    right = post(client, doc_id, "pages/insert-pdf", path=locked, at=0, password=USER_PASSWORD)

    assert missing.status_code == 401
    assert missing.json()["error"]["code"] == "password_required"
    assert missing.json()["error"]["path"] == os.path.abspath(locked)
    assert wrong.json()["error"]["code"] == "password_incorrect"
    assert right.status_code == 200
    assert labels(app, doc_id)[:3] == ["Locked-1", "Locked-2", "Page-1"]


def test_insert_pdf_reports_a_missing_file(client, tmp_path, open_doc, six):
    doc_id = open_doc(six)["docId"]

    response = post(client, doc_id, "pages/insert-pdf", path=str(tmp_path / "nope.pdf"), at=0)

    assert response.status_code == 404


# --- Undo, redo, save --------------------------------------------------------------------


OPERATIONS = [
    ("pages/reorder", {"order": [2, 0, 1, 5, 4, 3]}),
    ("pages/delete", {"pages": [0, 4]}),
    ("pages/duplicate", {"pages": [1, 2]}),
    ("pages/insert-blank", {"at": 3, "count": 2}),
    ("pages/insert-pdf", {"at": 1}),
]


@pytest.mark.parametrize(("action", "body"), OPERATIONS, ids=[op[0] for op in OPERATIONS])
def test_page_operations_undo_and_redo_also_after_saving(
    client, app, tmp_path, open_doc, six, action, body
):
    if action == "pages/insert-pdf":
        body = {**body, "path": numbered(tmp_path / "other.pdf", count=2, prefix="Other")}
    doc_id = open_doc(six)["docId"]
    before = labels(app, doc_id)

    result = post(client, doc_id, action, **body).json()
    after = labels(app, doc_id)
    assert after != before
    assert client.post(f"/v1/docs/{doc_id}/save", json={}).status_code == 200
    assert file_labels(six) == after

    undone = client.post(f"/v1/docs/{doc_id}/undo").json()
    assert undone["structure"] is True
    assert undone["pageCount"] == len(before)
    assert len(undone["pages"]) == len(before)
    assert labels(app, doc_id) == before
    redone = client.post(f"/v1/docs/{doc_id}/redo").json()
    assert redone["structure"] is True
    assert redone["pageCount"] == result["pageCount"]
    assert labels(app, doc_id) == after
    assert redone["modified"] is False

    # And once more back, then save the undone state.
    client.post(f"/v1/docs/{doc_id}/undo")
    client.post(f"/v1/docs/{doc_id}/save", json={})
    assert file_labels(six) == before


def test_page_operations_on_an_encrypted_document_keep_its_encryption(
    client, app, tmp_path, open_doc
):
    path = numbered(tmp_path / "enc.pdf", count=3, password=USER_PASSWORD)
    doc_id = open_doc(path, USER_PASSWORD)["docId"]

    post(client, doc_id, "pages/reorder", order=[2, 1, 0])
    post(client, doc_id, "pages/delete", pages=[0])
    client.post(f"/v1/docs/{doc_id}/save", json={})

    saved = pymupdf.open(path)
    assert saved.needs_pass
    saved.authenticate(USER_PASSWORD)
    assert labels_of(saved) == P(2, 1)
    saved.close()


# --- Extract ------------------------------------------------------------------------------


def test_extract_writes_the_chosen_pages_and_leaves_the_document(
    client, app, tmp_path, open_doc, six
):
    doc_id = open_doc(six)["docId"]
    target = tmp_path / "out" / "extract.pdf"
    target.parent.mkdir()

    response = post(client, doc_id, "pages/extract", pages=[4, 1], outPath=str(target))

    assert response.status_code == 200, response.text
    assert response.json()["pageCount"] == 2
    assert file_labels(target) == P(5, 2)
    assert labels(app, doc_id) == P(1, 2, 3, 4, 5, 6)
    assert client.get(f"/v1/docs/{doc_id}/state").json()["canUndo"] is False


def test_extract_includes_unsaved_changes(client, tmp_path, open_doc, six):
    doc_id = open_doc(six)["docId"]
    post(client, doc_id, "pages/rotate", pages=[0], degrees=90)
    target = tmp_path / "extract.pdf"

    post(client, doc_id, "pages/extract", pages=[0], outPath=str(target))

    with pymupdf.open(target) as out:
        assert out[0].rotation == 90


def test_extract_refuses_the_documents_own_file(client, open_doc, six):
    doc_id = open_doc(six)["docId"]

    response = post(client, doc_id, "pages/extract", pages=[0], outPath=six)

    assert response.status_code == 400


def test_extract_to_a_missing_folder(client, tmp_path, open_doc, six):
    doc_id = open_doc(six)["docId"]

    response = post(
        client, doc_id, "pages/extract", pages=[0], outPath=str(tmp_path / "no" / "x.pdf")
    )

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "folder_not_found"


# --- Split -----------------------------------------------------------------------------------


def split(client, doc_id, out_dir, **body):
    return post(client, doc_id, "split", outDir=str(out_dir), **body)


def test_split_by_ranges(client, tmp_path, open_doc, six):
    doc_id = open_doc(six)["docId"]
    out = tmp_path / "parts"
    out.mkdir()

    response = split(client, doc_id, out, mode="ranges", ranges=[[0, 1, 2], [5], [3, 4]])

    assert response.status_code == 200, response.text
    files = response.json()["files"]
    assert [f["fileName"] for f in files] == ["six-1.pdf", "six-2.pdf", "six-3.pdf"]
    assert [file_labels(f["path"]) for f in files] == [P(1, 2, 3), P(6), P(4, 5)]


def test_split_every_n_pages(client, tmp_path, open_doc, six):
    doc_id = open_doc(six)["docId"]

    files = split(client, doc_id, tmp_path, mode="every", n=4, nameTemplate="{name} p{start}-{end}")
    files = files.json()["files"]

    assert [f["fileName"] for f in files] == ["six p1-4.pdf", "six p5-6.pdf"]
    assert [file_labels(f["path"]) for f in files] == [P(1, 2, 3, 4), P(5, 6)]


def test_split_by_bookmarks(client, tmp_path, open_doc):
    doc = pymupdf.open()
    for number in range(1, 7):
        doc.new_page().insert_text((50, 100), f"Page-{number}", fontsize=20)
    doc.set_toc(
        [
            [1, "Intro: part/one", 2],
            [2, "Detail", 3],
            [1, "Body", 4],
            [1, "Body", 6],
        ]
    )
    path = tmp_path / "book.pdf"
    doc.save(path)
    doc_id = open_doc(str(path))["docId"]
    out = tmp_path / "parts"
    out.mkdir()

    files = split(client, doc_id, out, mode="bookmarks", nameTemplate="{n} {title}").json()["files"]

    assert [f["fileName"] for f in files] == [
        "1 Part 1.pdf",
        "2 Intro_ part_one.pdf",
        "3 Body.pdf",
        "4 Body.pdf",
    ]
    assert [f["title"] for f in files] == [None, "Intro: part/one", "Body", "Body"]
    assert [file_labels(f["path"]) for f in files] == [P(1), P(2, 3), P(4, 5), P(6)]
    # The part keeps the outline entries that point into it.
    with pymupdf.open(files[1]["path"]) as part:
        assert [entry[1] for entry in part.get_toc()] == ["Intro: part/one", "Detail"]


def test_split_by_bookmarks_needs_bookmarks(client, tmp_path, open_doc, sample_pdf):
    path = tmp_path / "plain.pdf"
    doc = pymupdf.open()
    doc.new_page()
    doc.save(path)
    doc_id = open_doc(str(path))["docId"]

    assert split(client, doc_id, tmp_path, mode="bookmarks").status_code == 400


def test_split_does_not_overwrite_without_asking(client, tmp_path, open_doc, six):
    doc_id = open_doc(six)["docId"]
    out = tmp_path / "parts"
    out.mkdir()
    (out / "six-2.pdf").write_bytes(b"old")

    refused = split(client, doc_id, out, mode="every", n=3)
    assert refused.status_code == 409
    assert refused.json()["error"]["code"] == "files_exist"
    assert refused.json()["error"]["paths"] == [str(out / "six-2.pdf")]
    assert not (out / "six-1.pdf").exists()

    allowed = split(client, doc_id, out, mode="every", n=3, overwrite=True)
    assert allowed.status_code == 200
    assert file_labels(out / "six-2.pdf") == P(4, 5, 6)


# --- Merge --------------------------------------------------------------------------------------


def test_merge_keeps_every_page_in_order(client, tmp_path):
    a = numbered(tmp_path / "a.pdf", count=2, prefix="A")
    b = numbered(tmp_path / "b.pdf", count=3, prefix="B", password=USER_PASSWORD)
    c = numbered(tmp_path / "c.pdf", count=4, prefix="C")
    target = tmp_path / "merged.pdf"

    response = client.post(
        "/v1/merge",
        json={
            "inputs": [
                {"path": a},
                {"path": b, "password": USER_PASSWORD},
                {"path": c, "pages": [3, 0]},
            ],
            "outPath": str(target),
        },
    )

    assert response.status_code == 200, response.text
    assert response.json()["pageCount"] == 7
    assert file_labels(target) == P(1, 2, prefix="A") + P(1, 2, 3, prefix="B") + P(4, 1, prefix="C")
    with pymupdf.open(target) as merged:
        assert not merged.needs_pass
        toc = [(title, page) for _level, title, page in merged.get_toc()]
    assert toc == [
        ("A chapter 1", 1),
        ("A chapter 2", 2),
        ("B chapter 1", 3),
        ("B chapter 2", 4),
        ("B chapter 3", 5),
        # Outline order is kept; the entries of pages left out are dropped.
        ("C chapter 1", 7),
        ("C chapter 4", 6),
    ]


def test_merge_names_the_file_that_needs_a_password(client, tmp_path):
    a = numbered(tmp_path / "a.pdf", count=1, prefix="A")
    b = numbered(tmp_path / "b.pdf", count=1, prefix="B", password=USER_PASSWORD)
    target = tmp_path / "merged.pdf"

    response = client.post(
        "/v1/merge", json={"inputs": [{"path": a}, {"path": b}], "outPath": str(target)}
    )

    assert response.status_code == 401
    assert response.json()["error"]["path"] == os.path.abspath(b)
    assert not target.exists()


def test_merge_refuses_to_replace_an_input(client, tmp_path):
    a = numbered(tmp_path / "a.pdf", count=1, prefix="A")

    response = client.post("/v1/merge", json={"inputs": [{"path": a}], "outPath": a})

    assert response.status_code == 400
