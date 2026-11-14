"""Conversions: PDF to Word, images and text; images to PDF; Word to PDF."""

import os
import struct

import docx
import pymupdf
import pytest

from pdfengine.convert import Probe, detect_converters, image_file_names, page_layout

from .conftest import USER_PASSWORD, picture

# --- PDF to Word ------------------------------------------------------------------


def docx_text(path) -> str:
    document = docx.Document(str(path))
    parts = [paragraph.text for paragraph in document.paragraphs]
    for table in document.tables:
        for row in table.rows:
            parts.extend(cell.text for cell in row.cells)
    return "\n".join(parts)


def test_pdf_to_docx(sample_pdf, open_doc, run_job, tmp_path):
    doc_id = open_doc(sample_pdf)["docId"]
    target = tmp_path / "out" / "sample.docx"
    target.parent.mkdir()
    status = run_job("pdf-to-docx", doc_id, {"outPath": str(target)}, timeout=180)
    assert status["status"] == "done", status
    assert status["result"]["path"] == str(target)
    assert status["result"]["pageCount"] == 3
    text = docx_text(target)
    for number in (1, 2, 3):
        assert f"Heading of page {number}" in text
    assert "The quick brown Fox jumps over the lazy dog." in text
    assert "Unique-marker" in text
    assert os.listdir(target.parent) == ["sample.docx"]


def test_pdf_to_docx_selected_pages_of_encrypted_file(encrypted_pdf, open_doc, run_job, tmp_path):
    doc_id = open_doc(encrypted_pdf, USER_PASSWORD)["docId"]
    target = tmp_path / "second.docx"
    status = run_job("pdf-to-docx", doc_id, {"pages": [1], "outPath": str(target)}, timeout=180)
    assert status["status"] == "done", status
    text = docx_text(target)
    assert "Heading of page 2" in text
    assert "Heading of page 1" not in text


def test_pdf_to_docx_refuses_the_open_file_and_missing_folders(sample_pdf, open_doc, client):
    doc_id = open_doc(sample_pdf)["docId"]
    response = client.post(
        "/v1/jobs",
        json={"type": "pdf-to-docx", "docId": doc_id, "params": {"outPath": sample_pdf}},
    )
    assert response.status_code == 400
    response = client.post(
        "/v1/jobs",
        json={
            "type": "pdf-to-docx",
            "docId": doc_id,
            "params": {"outPath": os.path.join(os.path.dirname(sample_pdf), "no", "x.docx")},
        },
    )
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "folder_not_found"


# --- PDF to images -----------------------------------------------------------------


def test_pdf_to_images(sample_pdf, open_doc, run_job, client, tmp_path):
    doc_id = open_doc(sample_pdf)["docId"]
    out = tmp_path / "pictures"
    out.mkdir()
    status = run_job("pdf-to-images", doc_id, {"format": "png", "dpi": 100, "outDir": str(out)})
    assert status["status"] == "done", status
    names = sorted(os.listdir(out))
    assert names == ["sample-1.png", "sample-2.png", "sample-3.png"]
    assert [f["fileName"] for f in status["result"]["files"]] == names
    for name in names:
        pixmap = pymupdf.Pixmap(str(out / name))
        assert (pixmap.width, pixmap.height) == (850, 1100)  # 612 x 792 pt at 100 dpi

    # Existing files are not replaced without asking.
    response = client.post(
        "/v1/jobs",
        json={
            "type": "pdf-to-images",
            "docId": doc_id,
            "params": {"format": "png", "dpi": 100, "outDir": str(out)},
        },
    )
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "files_exist"
    assert len(response.json()["error"]["paths"]) == 3

    status = run_job(
        "pdf-to-images",
        doc_id,
        {"format": "jpg", "dpi": 72, "pages": [1], "outDir": str(out), "overwrite": True},
    )
    assert status["status"] == "done", status
    assert "sample-2.jpg" in os.listdir(out)
    pixmap = pymupdf.Pixmap(str(out / "sample-2.jpg"))
    assert (pixmap.width, pixmap.height) == (612, 792)


def test_image_names_are_padded():
    assert image_file_names("doc", [0, 9, 119], 120, "png") == [
        "doc-001.png",
        "doc-010.png",
        "doc-120.png",
    ]


def test_cancelled_image_export_leaves_no_files(app, client, tmp_path, open_doc):
    doc = pymupdf.open()
    for _ in range(40):
        doc.new_page().insert_text((72, 72), "page")
    path = tmp_path / "many.pdf"
    doc.save(path)
    doc_id = open_doc(str(path))["docId"]
    out = tmp_path / "pictures"
    out.mkdir()
    job_id = client.post(
        "/v1/jobs",
        json={
            "type": "pdf-to-images",
            "docId": doc_id,
            "params": {"format": "png", "dpi": 300, "outDir": str(out)},
        },
    ).json()["jobId"]
    client.post(f"/v1/jobs/{job_id}/cancel")
    assert app.state.jobs.wait(job_id, timeout=60)["status"] == "cancelled"
    assert os.listdir(out) == []


# --- PDF to text ------------------------------------------------------------------


def test_pdf_to_text(sample_pdf, open_doc, run_job, tmp_path):
    doc_id = open_doc(sample_pdf)["docId"]
    target = tmp_path / "sample.txt"
    status = run_job("pdf-to-text", doc_id, {"outPath": str(target), "pages": [0, 2]})
    assert status["status"] == "done", status
    data = target.read_bytes()
    assert b"\r\n" in data
    text = data.decode("utf-8")
    assert "Heading of page 1" in text and "Heading of page 3" in text
    assert "Heading of page 2" not in text
    assert text.index("Heading of page 1") < text.index("quick brown Fox")


# --- Images to PDF ---------------------------------------------------------------


def with_orientation(jpeg: bytes, orientation: int) -> bytes:
    """Adds an EXIF block saying how viewers should turn the picture."""
    tiff = b"MM\x00\x2a" + struct.pack(">I", 8)
    ifd = (
        struct.pack(">H", 1)
        + struct.pack(">HHIHH", 0x0112, 3, 1, orientation, 0)
        + struct.pack(">I", 0)
    )
    payload = b"Exif\x00\x00" + tiff + ifd
    return jpeg[:2] + b"\xff\xe1" + struct.pack(">H", len(payload) + 2) + payload + jpeg[2:]


def red_blue_jpeg() -> bytes:
    """200 x 100 pixels: left half red, right half blue."""
    doc = pymupdf.open()
    page = doc.new_page(width=200, height=100)
    page.draw_rect(pymupdf.Rect(0, 0, 100, 100), color=None, fill=(1, 0, 0))
    page.draw_rect(pymupdf.Rect(100, 0, 200, 100), color=None, fill=(0, 0, 1))
    return page.get_pixmap().tobytes("jpeg")


def test_images_to_pdf(run_job, tmp_path):
    landscape = tmp_path / "wide.png"
    landscape.write_bytes(picture(1, 400, 200, dpi=72).tobytes("png"))
    portrait = tmp_path / "tall.jpg"
    portrait.write_bytes(picture(2, 200, 400, dpi=72).tobytes("jpeg"))
    phone = tmp_path / "phone.jpg"
    phone.write_bytes(with_orientation(red_blue_jpeg(), 6))  # shown turned: 100 x 200
    target = tmp_path / "album.pdf"

    status = run_job(
        "images-to-pdf",
        None,
        {
            "inputs": [str(landscape), str(portrait), str(phone)],
            "pageSize": "a4",
            "margin": 36,
            "outPath": str(target),
        },
    )
    assert status["status"] == "done", status
    assert status["result"]["pageCount"] == 3
    album = pymupdf.open(target)
    assert album.page_count == 3
    assert (album[0].rect.width, album[0].rect.height) == (842, 595)  # landscape A4
    assert (album[1].rect.width, album[1].rect.height) == (595, 842)
    # The phone picture is upright: red on top, blue below.
    pixmap = album[2].get_pixmap(dpi=36)
    top = pixmap.pixel(pixmap.width // 2, int(pixmap.height * 0.3))
    bottom = pixmap.pixel(pixmap.width // 2, int(pixmap.height * 0.7))
    assert top[0] > 200 and top[2] < 60, top
    assert bottom[2] > 200 and bottom[0] < 60, bottom
    # The JPEG is embedded as it is (not re-encoded to something larger).
    assert any(
        album.xref_get_key(x, "Filter")[1] == "/DCTDecode" for x in range(1, album.xref_length())
    )


def test_images_to_pdf_page_fits_the_picture():
    from pdfengine.convert import ImagesToPdfParams

    params = ImagesToPdfParams(inputs=["x"], page_size="image", margin=0, out_path="x.pdf")
    page, image = page_layout((400, 200), params)
    assert (page.width, page.height) == (842, 421)
    assert image == page


def test_images_to_pdf_rejects_what_is_not_a_picture(run_job, tmp_path):
    fake = tmp_path / "notes.webp"
    fake.write_bytes(b"RIFF\x00\x00\x00\x00WEBPVP8 nonsense")
    status = run_job(
        "images-to-pdf", None, {"inputs": [str(fake)], "outPath": str(tmp_path / "x.pdf")}
    )
    assert status["status"] == "failed"
    assert status["error"]["code"] == "unsupported_image"
    assert "notes.webp" in status["error"]["message"]
    assert not (tmp_path / "x.pdf").exists()


# --- Word to PDF -----------------------------------------------------------------


class FakeProbe(Probe):
    def __init__(self, *, keys=(), files=(), which=None, environ=None, install=None):
        super().__init__(
            key_exists=lambda root, path: (root, path) in keys,
            value=lambda root, path, name: install,
            is_file=lambda path: path in files,
            which=lambda name: which,
            environ=environ or {"ProgramFiles": r"C:\Program Files"},
        )


def test_converter_detection():
    word_key = ("HKCR", r"Word.Application\CLSID")
    standard = r"C:\Program Files\LibreOffice\program\soffice.exe"
    assert detect_converters(FakeProbe()) == {"word": False, "libreOffice": False, "using": None}
    assert detect_converters(FakeProbe(keys=[word_key]))["using"] == "word"
    assert detect_converters(FakeProbe(files=[standard])) == {
        "word": False,
        "libreOffice": True,
        "using": "libreoffice",
    }
    # Word wins when both are there.
    assert detect_converters(FakeProbe(keys=[word_key], files=[standard]))["using"] == "word"
    # Found through the registry's install path, or on PATH.
    assert detect_converters(
        FakeProbe(install=r"D:\LO\program", files=[r"D:\LO\program\soffice.exe"])
    )["libreOffice"]
    assert detect_converters(FakeProbe(which=r"E:\bin\soffice.exe", files=[r"E:\bin\soffice.exe"]))[
        "libreOffice"
    ]
    # A path that does not exist does not count.
    assert not detect_converters(FakeProbe(which=r"E:\gone\soffice.exe"))["libreOffice"]


def test_converters_endpoint(client):
    body = client.get("/v1/convert/converters").json()
    assert set(body) == {"word", "libreOffice", "using"}


def test_word_document_is_checked_before_starting(client, tmp_path):
    response = client.post(
        "/v1/jobs",
        json={
            "type": "docx-to-pdf",
            "params": {"input": str(tmp_path / "missing.docx"), "outPath": str(tmp_path / "x.pdf")},
        },
    )
    assert response.status_code == 404
    text = tmp_path / "notes.txt"
    text.write_text("hello")
    response = client.post(
        "/v1/jobs",
        json={
            "type": "docx-to-pdf",
            "params": {"input": str(text), "outPath": str(tmp_path / "x.pdf")},
        },
    )
    assert response.status_code == 400


@pytest.mark.skipif(not detect_converters()["word"], reason="Microsoft Word is not installed")
def test_docx_to_pdf_with_word(run_job, tmp_path):
    document = docx.Document()
    document.add_heading("Quarterly report", level=1)
    document.add_paragraph("Revenue grew by twelve percent in the third quarter.")
    source = tmp_path / "report.docx"
    document.save(str(source))
    target = tmp_path / "report.pdf"
    status = run_job(
        "docx-to-pdf", None, {"input": str(source), "outPath": str(target)}, timeout=300
    )
    assert status["status"] == "done", status
    assert status["result"]["converter"] == "word"
    pdf = pymupdf.open(target)
    text = pdf[0].get_text()
    assert "Quarterly report" in text
    assert "twelve percent" in text
    assert sorted(os.listdir(tmp_path)) == ["report.docx", "report.pdf"]


def word_processes() -> set[int]:
    import subprocess

    result = subprocess.run(
        ["tasklist", "/FI", "IMAGENAME eq WINWORD.EXE", "/FO", "CSV", "/NH"],
        capture_output=True,
        text=True,
    )
    return {
        int(line.split('","')[1])
        for line in result.stdout.splitlines()
        if line.startswith('"WINWORD.EXE"')
    }


@pytest.mark.skipif(not detect_converters()["word"], reason="Microsoft Word is not installed")
def test_cancelling_word_conversion_closes_word(app, client, tmp_path):
    import time

    before = word_processes()
    document = docx.Document()
    for number in range(1500):
        document.add_paragraph(f"Paragraph {number}: " + "lorem ipsum dolor sit amet " * 12)
    source = tmp_path / "long.docx"
    document.save(str(source))
    target = tmp_path / "long.pdf"
    job_id = client.post(
        "/v1/jobs",
        json={"type": "docx-to-pdf", "params": {"input": str(source), "outPath": str(target)}},
    ).json()["jobId"]
    deadline = time.monotonic() + 60
    while client.get(f"/v1/jobs/{job_id}").json()["progress"] < 0.3:
        assert time.monotonic() < deadline, "Word did not start"
        time.sleep(0.1)
    client.post(f"/v1/jobs/{job_id}/cancel")
    status = app.state.jobs.wait(job_id, timeout=30)
    assert status["status"] == "cancelled"
    time.sleep(1)
    assert word_processes() - before == set()
    assert sorted(os.listdir(tmp_path)) == ["long.docx"]
