"""OCR: invisible text layer from Tesseract, languages."""

import shutil
from pathlib import Path

import pymupdf
import pytest

import pdfengine.ocr as ocr
from pdfengine.textpages import text_page

LINES = [
    ((72, 120), "Invoice number 4471 for Rosalind", 22),
    ((72, 180), "The quick brown fox jumps over the lazy dog", 16),
    ((72, 230), "Payment due within thirty days", 16),
]


def text_source() -> pymupdf.Document:
    doc = pymupdf.open()
    page = doc.new_page(width=612, height=792)
    for point, text, size in LINES:
        page.insert_text(point, text, fontsize=size)
    return doc


def word_boxes(page: pymupdf.Page, matrix: pymupdf.Matrix | None = None) -> dict[str, pymupdf.Rect]:
    """Word -> box in displayed space (the first of each)."""
    boxes: dict[str, pymupdf.Rect] = {}
    for x0, y0, x1, y1, word, *_ in text_page(page, 0).extractWORDS():
        rect = pymupdf.Rect(x0, y0, x1, y1) * (matrix or page.rotation_matrix)
        boxes.setdefault(word, rect)
    return boxes


@pytest.fixture
def scan_pdf(tmp_path):
    """Two image-only pages showing ``LINES`` upright (rendered at 200 dpi).
    The second is stored like a sideways scan: a landscape page whose
    ``/Rotate 90`` shows the picture upright."""
    source = text_source()
    picture = source[0].get_pixmap(dpi=200)
    doc = pymupdf.open()
    page = doc.new_page(width=612, height=792)
    page.insert_image(page.rect, pixmap=picture)
    turned = doc.new_page(width=792, height=612)
    turned.set_rotation(90)
    turned.insert_image(turned.rect * turned.derotation_matrix, pixmap=picture, rotate=90)
    path = tmp_path / "scan.pdf"
    doc.save(path)
    doc.close()
    return str(path)


def source_boxes() -> dict[str, pymupdf.Rect]:
    """Where the words are seen on either scan page (displayed space)."""
    return word_boxes(text_source()[0], pymupdf.Identity)


def same_place(found: pymupdf.Rect, drawn: pymupdf.Rect) -> bool:
    """The recognised word's box sits on the drawn word: its centre inside the
    drawn box (font boxes are taller than the ink) and most of its width shared."""
    shared = min(found.x1, drawn.x1) - max(found.x0, drawn.x0)
    return drawn.contains((found.tl + found.br) / 2) and shared > 0.8 * drawn.width


def pixels(app, doc_id, index):
    session = app.state.sessions.get(doc_id)
    with session.lock:
        return session.doc[index].get_pixmap(dpi=50).samples


def test_ocr_adds_invisible_words_in_place(app, client, scan_pdf, open_doc, run_job):
    opened = open_doc(scan_pdf)
    assert opened["hasTextLayer"] is False
    doc_id = opened["docId"]
    before = [pixels(app, doc_id, index) for index in range(2)]

    status = run_job("ocr", doc_id, {"languages": ["eng"], "dpi": 300}, timeout=180)
    assert status["status"] == "done", status
    result = status["result"]
    assert result["pagesProcessed"] == 2
    assert result["pagesSkipped"] == 0
    assert result["wordsFound"] >= 30
    assert result["hasTextLayer"] is True
    assert result["undoName"] == "Recognise Text"
    assert result["dirtyPages"] == [0, 1]

    session = app.state.sessions.get(doc_id)
    expected = source_boxes()
    for index in (0, 1):
        with session.lock:
            assert session.doc[index].rotation == index * 90
            found = word_boxes(session.doc[index])
        for word in ("Invoice", "4471", "Rosalind", "quick", "lazy", "Payment", "thirty"):
            assert word in found, (index, word, sorted(found))
            assert same_place(found[word], expected[word]), (index, word, found[word])

    # The pages look exactly as before.
    assert [pixels(app, doc_id, index) for index in range(2)] == before

    # The words can be found by search.
    hits = client.post(f"/v1/docs/{doc_id}/search", json={"query": "Rosalind"}).json()["hits"]
    assert [hit["page"] for hit in hits] == [0, 1]

    # Undo takes the text away again.
    assert client.post(f"/v1/docs/{doc_id}/undo").json()["undone"] == "Recognise Text"
    with session.lock:
        assert not text_page(session.doc[0], 0).extractText().strip()


def test_pages_with_text_are_skipped(client, sample_pdf, open_doc, run_job):
    doc_id = open_doc(sample_pdf)["docId"]
    status = run_job("ocr", doc_id, {})
    assert status["status"] == "done", status
    assert status["result"]["pagesProcessed"] == 0
    assert status["result"]["pagesSkipped"] == 3
    assert client.get(f"/v1/docs/{doc_id}/state").json()["canUndo"] is False


def test_selected_pages_only(app, scan_pdf, open_doc, run_job):
    doc_id = open_doc(scan_pdf)["docId"]
    status = run_job("ocr", doc_id, {"pages": [1], "dpi": 200}, timeout=180)
    assert status["status"] == "done", status
    assert status["result"]["dirtyPages"] == [1]
    session = app.state.sessions.get(doc_id)
    with session.lock:
        assert not text_page(session.doc[0], 0).extractText().strip()
        assert "Rosalind" in text_page(session.doc[1], 0).extractText()


def test_cancel_leaves_the_document_unchanged(app, client, scan_pdf, open_doc):
    doc_id = open_doc(scan_pdf)["docId"]
    job_id = client.post(
        "/v1/jobs", json={"type": "ocr", "docId": doc_id, "params": {"dpi": 300}}
    ).json()["jobId"]
    client.post(f"/v1/jobs/{job_id}/cancel")
    assert app.state.jobs.wait(job_id, timeout=30)["status"] == "cancelled"
    state = client.get(f"/v1/docs/{doc_id}/state").json()
    assert state["canUndo"] is False and state["modified"] is False


def test_language_list_and_missing_language(client, scan_pdf, open_doc, monkeypatch, tmp_path):
    monkeypatch.setenv("PDFENGINE_TESSDATA_DIR", str(tmp_path / "langs"))
    languages = {item["code"]: item for item in client.get("/v1/ocr/languages").json()}
    assert languages["eng"]["installed"] and languages["eng"]["bundled"]
    assert languages["deu"]["name"] == "German"
    assert not languages["deu"]["installed"]

    doc_id = open_doc(scan_pdf)["docId"]
    response = client.post(
        "/v1/jobs", json={"type": "ocr", "docId": doc_id, "params": {"languages": ["eng", "deu"]}}
    )
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "language_missing"
    assert response.json()["error"]["languages"] == ["deu"]
    response = client.post(
        "/v1/jobs", json={"type": "ocr", "docId": doc_id, "params": {"languages": ["xx"]}}
    )
    assert response.status_code == 400


def test_download_and_remove_a_language(client, run_job, monkeypatch, tmp_path):
    # A stand-in for the tessdata_fast repository.
    mirror = tmp_path / "mirror"
    mirror.mkdir()
    shutil.copyfile(ocr.bundled_dir() / "eng.traineddata", mirror / "deu.traineddata")
    monkeypatch.setattr(ocr, "DOWNLOAD_URL", mirror.as_uri() + "/{code}.traineddata")
    downloads = tmp_path / "langs"
    monkeypatch.setenv("PDFENGINE_TESSDATA_DIR", str(downloads))

    status = run_job("ocr-language", None, {"code": "deu"})
    assert status["status"] == "done", status
    assert status["result"]["name"] == "German"
    assert (downloads / "deu.traineddata").stat().st_size == status["result"]["size"]
    assert [p.name for p in downloads.iterdir()] == ["deu.traineddata"]  # no temp file left
    languages = {item["code"]: item for item in client.get("/v1/ocr/languages").json()}
    assert languages["deu"]["installed"] and not languages["deu"]["bundled"]

    # Mixed runs get one folder holding both.
    folder = Path(ocr.tessdata_for(["eng", "deu"]))
    assert {p.name for p in folder.iterdir()} >= {"eng.traineddata", "deu.traineddata"}

    assert client.delete("/v1/ocr/languages/deu").status_code == 200
    assert client.delete("/v1/ocr/languages/deu").status_code == 404
    assert client.delete("/v1/ocr/languages/eng").status_code in (200, 400)


def test_failed_download_is_reported(run_job, monkeypatch, tmp_path):
    monkeypatch.setattr(ocr, "DOWNLOAD_URL", (tmp_path / "nothing").as_uri() + "/{code}.x")
    monkeypatch.setenv("PDFENGINE_TESSDATA_DIR", str(tmp_path / "langs"))
    status = run_job("ocr-language", None, {"code": "fra"})
    assert status["status"] == "failed"
    assert status["error"]["code"] == "download_failed"
    assert "French" in status["error"]["message"]
    assert not any((tmp_path / "langs").iterdir())
