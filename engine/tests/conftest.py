import os

import pymupdf
import pytest
from fastapi.testclient import TestClient

from pdfengine.server import TOKEN_HEADER, create_app

TEST_TOKEN = "test-token-123"
TEST_ORIGIN = "http://localhost:5173"

PAGE_WIDTH = 612
PAGE_HEIGHT = 792
USER_PASSWORD = "open-sesame"
OWNER_PASSWORD = "owner-secret"


@pytest.fixture
def app():
    return create_app(TEST_TOKEN, [TEST_ORIGIN])


@pytest.fixture
def anonymous_client(app):
    """A client that sends no token."""
    with TestClient(app, raise_server_exceptions=False) as client:
        yield client


@pytest.fixture
def client(app):
    """A client that sends the correct token on every request."""
    with TestClient(
        app, headers={TOKEN_HEADER: TEST_TOKEN}, raise_server_exceptions=False
    ) as client:
        yield client


def build_sample(pages: int = 3) -> pymupdf.Document:
    """A text document. Every page has a heading and two body lines; page 2
    additionally has a phrase that wraps over two lines."""
    doc = pymupdf.open()
    for number in range(1, pages + 1):
        page = doc.new_page(width=PAGE_WIDTH, height=PAGE_HEIGHT)
        page.insert_text((72, 100), f"Heading of page {number}", fontsize=16)
        page.insert_text((72, 140), "The quick brown Fox jumps over the lazy dog.", fontsize=11)
        page.insert_text((72, 160), "fox foxes Foxtrot outfox", fontsize=11)
        if number == 2:
            page.insert_text((72, 200), "This sentence ends with wrapped", fontsize=11)
            page.insert_text((72, 216), "phrase on the next line. Unique-marker here.", fontsize=11)
    return doc


@pytest.fixture
def sample_pdf(tmp_path):
    """Three pages of text with an outline and metadata."""
    doc = build_sample(3)
    doc.set_toc([[1, "Chapter One", 1], [2, "Section 1.1", 2], [1, "Chapter Two", 3]])
    doc.set_metadata(
        {
            "title": "Sample Document",
            "author": "Test Author",
            "subject": "Testing",
            "keywords": "pdf, test",
            "creationDate": "D:20240131120000+01'00'",
            "modDate": "D:20240201083000Z",
        }
    )
    path = tmp_path / "sample.pdf"
    doc.save(path)
    doc.close()
    return str(path)


@pytest.fixture
def encrypted_pdf(tmp_path):
    """Needs a password to open; printing and copying are allowed, editing is not."""
    doc = build_sample(2)
    path = tmp_path / "encrypted.pdf"
    doc.save(
        path,
        encryption=pymupdf.PDF_ENCRYPT_AES_256,
        user_pw=USER_PASSWORD,
        owner_pw=OWNER_PASSWORD,
        permissions=pymupdf.PDF_PERM_PRINT | pymupdf.PDF_PERM_COPY,
    )
    doc.close()
    return str(path)


@pytest.fixture
def rotated_pdf(tmp_path):
    """Four pages with the same content, stored with rotation 0, 90, 180, 270."""
    doc = build_sample(4)
    for index, rotation in enumerate((0, 90, 180, 270)):
        doc[index].set_rotation(rotation)
    path = tmp_path / "rotated.pdf"
    doc.save(path)
    doc.close()
    return str(path)


@pytest.fixture
def scanned_pdf(tmp_path):
    """Two pages that are nothing but a full-page picture: no text layer."""
    doc = pymupdf.open()
    picture = pymupdf.Pixmap(pymupdf.csRGB, 120, 160, os.urandom(120 * 160 * 3), False)
    for _ in range(2):
        page = doc.new_page(width=PAGE_WIDTH, height=PAGE_HEIGHT)
        page.insert_image(page.rect, pixmap=picture, keep_proportion=False)
    path = tmp_path / "scanned.pdf"
    doc.save(path)
    doc.close()
    return str(path)


@pytest.fixture
def open_doc(client):
    """Opens a file through the API and returns the response body."""

    def _open(path: str, password: str | None = None) -> dict:
        body = {"path": path}
        if password is not None:
            body["password"] = password
        response = client.post("/v1/docs/open", json=body)
        assert response.status_code == 200, response.text
        return response.json()

    return _open
