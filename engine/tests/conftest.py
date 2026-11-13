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


def _form_stream(doc: pymupdf.Document, content: bytes) -> int:
    xref = doc.get_new_xref()
    doc.update_object(xref, "<< /Type /XObject /Subtype /Form /BBox [0 0 14 14] >>")
    doc.update_stream(xref, content)
    return xref


def build_form() -> pymupdf.Document:
    """Page 1: text "name", multiline "notes" (max 40 characters), checkbox
    "agree", radio group "color" (buttons Red and Blue, built like real forms:
    one parent field with two kid widgets), combo box "country", multi-select
    list "fruit", read-only text "id" (value "A-1"), signature "sig" and a
    hidden text field. Page 2, rotated 90: text "city"."""
    doc = pymupdf.open()
    page = doc.new_page(width=PAGE_WIDTH, height=PAGE_HEIGHT)

    def add(target, kind, name, rect, **attributes):
        widget = pymupdf.Widget()
        widget.field_type = kind
        widget.field_name = name
        widget.rect = pymupdf.Rect(rect)
        for key, value in attributes.items():
            setattr(widget, key, value)
        target.add_widget(widget)

    add(page, pymupdf.PDF_WIDGET_TYPE_TEXT, "name", (50, 50, 250, 70), text_fontsize=11)
    add(
        page,
        pymupdf.PDF_WIDGET_TYPE_TEXT,
        "notes",
        (50, 80, 250, 140),
        field_flags=pymupdf.PDF_TX_FIELD_IS_MULTILINE,
        text_maxlen=40,
        text_fontsize=10,
    )
    add(page, pymupdf.PDF_WIDGET_TYPE_CHECKBOX, "agree", (50, 150, 64, 164))
    add(
        page,
        pymupdf.PDF_WIDGET_TYPE_COMBOBOX,
        "country",
        (50, 210, 200, 230),
        choice_values=["Pakistan", "Germany", "Japan"],
        text_fontsize=10,
    )
    add(
        page,
        pymupdf.PDF_WIDGET_TYPE_LISTBOX,
        "fruit",
        (50, 240, 200, 300),
        choice_values=["Apple", "Banana", "Cherry"],
        field_flags=pymupdf.PDF_CH_FIELD_IS_MULTI_SELECT,
        text_fontsize=10,
    )
    add(
        page,
        pymupdf.PDF_WIDGET_TYPE_TEXT,
        "id",
        (300, 50, 400, 70),
        field_value="A-1",
        field_flags=pymupdf.PDF_FIELD_IS_READ_ONLY,
        text_fontsize=10,
    )
    add(page, pymupdf.PDF_WIDGET_TYPE_SIGNATURE, "sig", (50, 310, 200, 350))
    second = doc.new_page(width=PAGE_WIDTH, height=PAGE_HEIGHT)
    add(second, pymupdf.PDF_WIDGET_TYPE_TEXT, "city", (100, 100, 300, 120), text_fontsize=10)
    page = doc[0]  # new_page invalidates earlier page objects
    add(page, pymupdf.PDF_WIDGET_TYPE_TEXT, "secret", (300, 300, 400, 320))
    for widget in page.widgets():
        if widget.field_name == "secret":
            doc.xref_set_key(widget.xref, "F", "6")  # hidden

    # A radio group as real forms build it.
    parent = doc.get_new_xref()
    kids = []
    for state, x in (("Red", 50), ("Blue", 80)):
        on = _form_stream(doc, b"0 g 3 3 8 8 re f")
        off = _form_stream(doc, b"")
        kid = doc.get_new_xref()
        doc.update_object(
            kid,
            f"<< /Type /Annot /Subtype /Widget /Rect [{x} 598 {x + 14} 612] "
            f"/Parent {parent} 0 R /AS /Off /F 4 /P {page.xref} 0 R "
            f"/AP << /N << /{state} {on} 0 R /Off {off} 0 R >> >> >>",
        )
        kids.append(kid)
    refs = " ".join(f"{kid} 0 R" for kid in kids)
    doc.update_object(parent, f"<< /FT /Btn /Ff 49152 /T (color) /V /Off /Kids [{refs}] >>")
    # A checkbox group: one field "size" with two checkbox kids (on states S, L).
    group = doc.get_new_xref()
    group_kids = []
    for state, x in (("S", 150), ("L", 180)):
        on = _form_stream(doc, b"0 g 2 2 10 10 re f")
        off = _form_stream(doc, b"")
        kid = doc.get_new_xref()
        doc.update_object(
            kid,
            f"<< /Type /Annot /Subtype /Widget /Rect [{x} 598 {x + 14} 612] "
            f"/Parent {group} 0 R /AS /Off /F 4 /P {page.xref} 0 R "
            f"/AP << /N << /{state} {on} 0 R /Off {off} 0 R >> >> >>",
        )
        group_kids.append(kid)
    group_refs = " ".join(f"{kid} 0 R" for kid in group_kids)
    doc.update_object(group, f"<< /FT /Btn /T (size) /V /Off /Kids [{group_refs}] >>")
    refs = f"{refs} {group_refs}"
    new_fields = f"{parent} 0 R {group} 0 R"
    annots = doc.xref_get_key(page.xref, "Annots")[1]
    doc.xref_set_key(page.xref, "Annots", f"{annots[:-1]} {refs}]")
    catalog = doc.pdf_catalog()
    fields = doc.xref_get_key(catalog, "AcroForm/Fields")[1]
    doc.xref_set_key(catalog, "AcroForm/Fields", f"{fields[:-1]} {new_fields}]")

    doc[1].set_rotation(90)
    return pymupdf.open(stream=doc.tobytes(), filetype="pdf")


@pytest.fixture
def form_pdf(tmp_path):
    path = tmp_path / "form.pdf"
    doc = build_form()
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
