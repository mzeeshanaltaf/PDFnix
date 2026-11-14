"""Compress: presets, replacing the open document as one undo step, writing a
separate file, encryption, cancellation."""

import os
from pathlib import Path

import pymupdf
import pytest

from pdfengine.textpages import text_page

from .conftest import OWNER_PASSWORD, USER_PASSWORD, picture

#: A TrueType font from the app (OFL), embedded whole by ``insert_font``.
FONT_FILE = (
    Path(__file__).resolve().parents[2] / "src/renderer/src/assets/fonts/GreatVibes-Regular.ttf"
)


def session_of(app, doc_id):
    return app.state.sessions.get(doc_id)


def compacted_size(app, doc_id) -> int:
    session = session_of(app, doc_id)
    with session.lock:
        data = session.history.serialise()
    doc = pymupdf.open(stream=data, filetype="pdf")
    if doc.needs_pass:
        doc.authenticate(session.password)
    try:
        return len(doc.tobytes(garbage=3, deflate=True))
    finally:
        doc.close()


def page_pixels(app, doc_id, index: int) -> bytes:
    session = session_of(app, doc_id)
    with session.lock:
        return session.doc[index].get_pixmap(dpi=36).samples


def page_texts(doc) -> list[str]:
    return [text_page(page, 0).extractText().strip() for page in doc]


def image_widths(doc) -> list[int]:
    widths = []
    for page in doc:
        for info in page.get_images(full=True):
            widths.append(info[2])
    return widths


def test_balanced_replaces_the_document_in_one_undo_step(app, client, photo_pdf, open_doc, run_job):
    doc_id = open_doc(photo_pdf)["docId"]
    before = compacted_size(app, doc_id)
    pixels = [page_pixels(app, doc_id, index) for index in range(3)]

    status = run_job("compress", doc_id, {"preset": "balanced"})
    assert status["status"] == "done", status
    result = status["result"]
    assert result["smaller"] is True
    assert result["newSize"] < result["originalSize"] * 0.6
    assert result["dirtyPages"] == [0, 1, 2]
    assert result["undoName"] == "Compress"
    assert result["modified"] is True

    session = session_of(app, doc_id)
    with session.lock:
        doc = session.doc
        assert doc.page_count == 3
        assert page_texts(doc) == [f"Photo page {n} caption" for n in (1, 2, 3)]
        # 400 pt wide at 150 dpi is about 833 pixels (was 1667).
        assert all(820 <= width <= 840 for width in image_widths(doc))
    assert compacted_size(app, doc_id) < before * 0.6

    # Undo brings back the original exactly; redo the compressed state.
    assert client.post(f"/v1/docs/{doc_id}/undo").json()["undone"] == "Compress"
    assert [page_pixels(app, doc_id, index) for index in range(3)] == pixels
    assert abs(compacted_size(app, doc_id) - before) < 2000
    assert client.post(f"/v1/docs/{doc_id}/redo").json()["redone"] == "Compress"
    assert compacted_size(app, doc_id) < before * 0.6

    # Saved: smaller on disk, opens, same pages and text.
    original_size = os.path.getsize(photo_pdf)
    assert client.post(f"/v1/docs/{doc_id}/save", json={}).status_code == 200
    assert os.path.getsize(photo_pdf) < original_size * 0.6
    saved = pymupdf.open(photo_pdf)
    assert saved.page_count == 3
    assert page_texts(saved) == [f"Photo page {n} caption" for n in (1, 2, 3)]
    saved.close()


def test_light_keeps_resolution(app, photo_pdf, open_doc, run_job):
    doc_id = open_doc(photo_pdf)["docId"]
    status = run_job("compress", doc_id, {"preset": "light"})
    assert status["status"] == "done", status
    assert status["result"]["smaller"] is True
    session = session_of(app, doc_id)
    with session.lock:
        assert all(width >= 1660 for width in image_widths(session.doc))


def test_strong_with_greyscale(app, photo_pdf, open_doc, run_job):
    doc_id = open_doc(photo_pdf)["docId"]
    status = run_job("compress", doc_id, {"preset": "strong", "grayscale": True})
    assert status["status"] == "done", status
    session = session_of(app, doc_id)
    with session.lock:
        doc = session.doc
        for page in doc:
            for info in page.get_images(full=True):
                assert pymupdf.Pixmap(doc, info[0]).n == 1
                assert info[2] <= 540  # 400 pt at 96 dpi = 533 px
    assert status["result"]["newSize"] < status["result"]["originalSize"] * 0.3


def test_greyscale_only_with_strong(photo_pdf, open_doc, client):
    doc_id = open_doc(photo_pdf)["docId"]
    response = client.post(
        "/v1/jobs",
        json={
            "type": "compress",
            "docId": doc_id,
            "params": {"preset": "light", "grayscale": True},
        },
    )
    assert response.status_code == 400


def test_separate_file_leaves_the_document_alone(
    app, client, photo_pdf, open_doc, run_job, tmp_path
):
    doc_id = open_doc(photo_pdf)["docId"]
    target = tmp_path / "out" / "small.pdf"
    target.parent.mkdir()
    status = run_job(
        "compress", doc_id, {"preset": "balanced", "output": "file", "outPath": str(target)}
    )
    assert status["status"] == "done", status
    result = status["result"]
    assert result["path"] == str(target)
    assert result["size"] == os.path.getsize(target) == result["newSize"]
    assert os.listdir(target.parent) == ["small.pdf"]  # no temporary file left
    written = pymupdf.open(target)
    assert written.page_count == 3
    assert page_texts(written) == [f"Photo page {n} caption" for n in (1, 2, 3)]
    written.close()
    state = client.get(f"/v1/docs/{doc_id}/state").json()
    assert state["modified"] is False and state["canUndo"] is False


def test_separate_file_must_not_be_the_open_file(photo_pdf, open_doc, client):
    doc_id = open_doc(photo_pdf)["docId"]
    response = client.post(
        "/v1/jobs",
        json={
            "type": "compress",
            "docId": doc_id,
            "params": {"output": "file", "outPath": photo_pdf},
        },
    )
    assert response.status_code == 400


def test_result_not_smaller_changes_nothing(client, sample_pdf, open_doc, run_job, tmp_path):
    # A file compressed once has nothing more to give.
    doc_id = open_doc(sample_pdf)["docId"]
    once = tmp_path / "once.pdf"
    status = run_job(
        "compress", doc_id, {"preset": "light", "output": "file", "outPath": str(once)}
    )
    assert status["status"] == "done", status
    assert status["result"]["smaller"] is True  # content streams were merged
    client.delete(f"/v1/docs/{doc_id}")

    doc_id = open_doc(str(once))["docId"]
    status = run_job("compress", doc_id, {"preset": "balanced"})
    assert status["status"] == "done", status
    assert status["result"]["smaller"] is False
    assert "dirtyPages" not in status["result"]
    assert client.get(f"/v1/docs/{doc_id}/state").json()["canUndo"] is False

    target = tmp_path / "twice.pdf"
    status = run_job(
        "compress", doc_id, {"preset": "light", "output": "file", "outPath": str(target)}
    )
    assert status["result"]["smaller"] is False
    assert not target.exists()
    assert sorted(os.listdir(tmp_path)) == ["once.pdf", "sample.pdf"]


def test_compress_keeps_encryption(app, client, tmp_path, open_doc, run_job):
    doc = pymupdf.open()
    page = doc.new_page()
    page.insert_image(pymupdf.Rect(72, 72, 472, 372), pixmap=picture(7))
    page.insert_text((72, 420), "Secret photo", fontsize=14)
    path = tmp_path / "locked.pdf"
    doc.save(
        path,
        encryption=pymupdf.PDF_ENCRYPT_AES_256,
        user_pw=USER_PASSWORD,
        owner_pw=OWNER_PASSWORD,
        permissions=pymupdf.PDF_PERM_PRINT,
    )
    doc.close()
    doc_id = open_doc(str(path), USER_PASSWORD)["docId"]
    status = run_job("compress", doc_id, {"preset": "balanced"})
    assert status["status"] == "done", status
    assert status["result"]["smaller"] is True
    assert client.post(f"/v1/docs/{doc_id}/save", json={}).status_code == 200
    saved = pymupdf.open(path)
    assert saved.needs_pass
    assert saved.authenticate(USER_PASSWORD)
    assert "AES" in saved.metadata["encryption"]
    assert text_page(saved[0], 0).extractText().strip() == "Secret photo"
    saved.close()


def test_fonts_are_subset(app, tmp_path, open_doc, run_job):
    doc = pymupdf.open()
    page = doc.new_page()
    page.insert_font(fontname="Vibes", fontfile=str(FONT_FILE))
    page.insert_text((72, 100), "Only a few letters", fontname="Vibes", fontsize=14)
    page.insert_image(pymupdf.Rect(72, 150, 272, 300), pixmap=picture(3, 200, 150))
    path = tmp_path / "font.pdf"
    doc.save(path, garbage=3, deflate=True)
    doc.close()

    def font_bytes(document):
        total = 0
        for xref in range(1, document.xref_length()):
            if document.xref_get_key(xref, "Length1")[0] != "null":
                total += len(document.xref_stream_raw(xref))
        return total

    original = pymupdf.open(path)
    before = font_bytes(original)
    original.close()
    doc_id = open_doc(str(path))["docId"]
    status = run_job("compress", doc_id, {"preset": "balanced"})
    assert status["status"] == "done", status
    session = session_of(app, doc_id)
    with session.lock:
        data = session.history.serialise()
    compressed = pymupdf.open(stream=pymupdf.open(stream=data).tobytes(garbage=3))
    assert font_bytes(compressed) < before / 4
    assert text_page(compressed[0], 0).extractText().strip() == "Only a few letters"


def test_cancel_leaves_the_document_untouched(app, client, photo_pdf, open_doc):
    doc_id = open_doc(photo_pdf)["docId"]
    pixels = page_pixels(app, doc_id, 0)
    job_id = client.post(
        "/v1/jobs", json={"type": "compress", "docId": doc_id, "params": {"preset": "strong"}}
    ).json()["jobId"]
    client.post(f"/v1/jobs/{job_id}/cancel")
    status = app.state.jobs.wait(job_id, timeout=30)
    assert status["status"] == "cancelled"
    state = client.get(f"/v1/docs/{doc_id}/state").json()
    assert state["modified"] is False and state["canUndo"] is False
    assert page_pixels(app, doc_id, 0) == pixels


@pytest.mark.parametrize("change", ["highlight"])
def test_document_changed_during_the_job_is_refused(
    app, client, photo_pdf, open_doc, monkeypatch, change
):
    """The result is not applied over changes made while the job ran."""
    import pdfengine.compress as compress

    doc_id = open_doc(photo_pdf)["docId"]
    real = compress.run_in_process

    def run_and_edit(context, target, payload, **kwargs):
        result = real(context, target, payload, **kwargs)
        client.post(
            f"/v1/docs/{doc_id}/pages/rotate", json={"degrees": 90, "pages": [0]}
        ).raise_for_status()
        return result

    monkeypatch.setattr(compress, "run_in_process", run_and_edit)
    job_id = client.post(
        "/v1/jobs", json={"type": "compress", "docId": doc_id, "params": {}}
    ).json()["jobId"]
    status = app.state.jobs.wait(job_id, timeout=60)
    assert status["status"] == "failed"
    assert status["error"]["code"] == "document_changed"
    assert client.get(f"/v1/docs/{doc_id}/state").json()["undoName"] == "Rotate"


def grey_render(doc, index=0):
    return doc[index].get_pixmap(dpi=30, colorspace=pymupdf.csGRAY).samples


def mean_difference(a: bytes, b: bytes) -> float:
    assert len(a) == len(b)
    return sum(abs(x - y) for x, y in zip(a, b, strict=True)) / len(a)


def test_greyscale_pictures_look_right(app, photo_pdf, open_doc, run_job):
    """MuPDF's rewriter turns grey ICC images into stripes unless they are
    plain DeviceGray first; compare the rendered page, not just the colour
    space."""
    original = pymupdf.open(photo_pdf)
    expected = grey_render(original)
    doc_id = open_doc(photo_pdf)["docId"]
    status = run_job("compress", doc_id, {"preset": "strong", "grayscale": True})
    assert status["status"] == "done", status
    session = session_of(app, doc_id)
    with session.lock:
        got = grey_render(session.doc)
    assert mean_difference(expected, got) < 6


def test_grey_icc_pictures_survive_every_preset(tmp_path, open_doc, run_job, app):
    # A document whose pictures are grey with an ICC profile (as greyscale
    # scans often are): made with recolor, which gives exactly that.
    doc = pymupdf.open()
    page = doc.new_page()
    page.insert_image(pymupdf.Rect(72, 72, 472, 372), pixmap=picture(9))
    page.recolor(1)
    path = tmp_path / "grey.pdf"
    doc.save(path, garbage=3, deflate=True)
    expected = grey_render(pymupdf.open(path))
    for preset in ("light", "balanced"):
        doc_id = open_doc(str(path))["docId"]
        status = run_job("compress", doc_id, {"preset": preset})
        assert status["status"] == "done", status
        session = session_of(app, doc_id)
        with session.lock:
            assert mean_difference(expected, grey_render(session.doc)) < 6, preset
