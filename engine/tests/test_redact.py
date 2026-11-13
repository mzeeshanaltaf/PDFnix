"""Redaction: marks, search-and-mark, applying, and that removed content is
really gone from the saved file."""

import pymupdf
import pytest

from pdfengine.textpages import content_text_page, text_page

SECRET = "Zebediah"
FONT_SIZE = 11


def build(path):
    """Page 1: tightly set lines (line pitch = font size, so glyph boxes of
    neighbouring lines overlap) with SECRET in the middle line; a red picture;
    invisible text containing SECRET (like an OCR layer); a note holding SECRET
    over SECRET, an unrelated note and a note holding SECRET away from any
    text. Page 2: SECRET again.
    Page 3 rotated 90 with SECRET. Metadata mentions SECRET."""
    doc = pymupdf.open()
    page = doc.new_page(width=612, height=792)
    y = 100
    for text in (
        "Above line keeps every word",
        f"Name: {SECRET} Quill here",
        "Below line keeps it all",
    ):
        page.insert_text((72, y), text, fontsize=FONT_SIZE)
        y += FONT_SIZE
    picture = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, 40, 40), False)
    picture.set_rect(picture.irect, (255, 0, 0))
    page.insert_image(pymupdf.Rect(300, 300, 400, 400), pixmap=picture)
    page.insert_text((72, 500), f"Hidden {SECRET} layer", fontsize=FONT_SIZE, render_mode=3)
    page.add_text_annot((125, 92), f"About {SECRET}")
    page.add_text_annot((500, 700), "Unrelated note")
    page.add_text_annot((450, 600), f"Ask {SECRET}")
    second = doc.new_page(width=612, height=792)
    second.insert_text((72, 200), f"Again {SECRET} appears", fontsize=FONT_SIZE)
    third = doc.new_page(width=612, height=792)
    third.insert_text((72, 200), f"Turned {SECRET} page", fontsize=FONT_SIZE)
    third.set_rotation(90)
    doc.set_metadata({"title": f"File about {SECRET}", "author": SECRET})
    doc.save(path)
    doc.close()
    return str(path)


@pytest.fixture
def secret_pdf(tmp_path):
    return build(tmp_path / "secret.pdf")


def page_text(app, doc_id, index):
    session = app.state.sessions.get(doc_id)
    with session.lock:
        return text_page(session.doc[index], 0).extractText()


def hits(client, doc_id, query=SECRET):
    return client.post(f"/v1/docs/{doc_id}/search", json={"query": query}).json()["hits"]


def mark_search(client, doc_id, **body):
    return client.post(f"/v1/docs/{doc_id}/redactions/search", json={"query": SECRET, **body})


def apply(client, doc_id, **body):
    response = client.post(f"/v1/docs/{doc_id}/redactions/apply", json=body)
    assert response.status_code == 200, response.text
    return response.json()


def word_rect(client, doc_id, word, page=0):
    """Displayed rect of the first hit of ``word`` on ``page``."""
    for hit in hits(client, doc_id, word):
        if hit["page"] == page:
            quad = hit["quads"][0]
            xs, ys = quad[0::2], quad[1::2]
            return [min(xs), min(ys), max(xs), max(ys)]
    raise AssertionError(f"{word} not found on page {page}")


def found_anywhere(data: bytes, word: str) -> bool:
    """Whether ``word`` occurs in the file bytes or in any decompressed
    stream, as plain text or hex-encoded (how PDF strings may be written)."""
    needles = [word.encode(), word.encode().hex().encode(), word.encode().hex().upper().encode()]
    if any(needle in data for needle in needles):
        return True
    doc = pymupdf.open(stream=data, filetype="pdf")
    try:
        for xref in range(1, doc.xref_length()):
            if doc.xref_is_stream(xref):
                stream = doc.xref_stream(xref) or b""
                if any(needle in stream for needle in needles):
                    return True
            if word in (doc.xref_object(xref, compressed=True) or ""):
                return True
    finally:
        doc.close()
    return False


# --- Marks ------------------------------------------------------------------------------


def test_marking_a_rect_lists_it_with_the_text_under_it(client, open_doc, secret_pdf):
    doc_id = open_doc(secret_pdf)["docId"]
    rect = word_rect(client, doc_id, SECRET)

    result = client.post(
        f"/v1/docs/{doc_id}/redactions", json={"page": 0, "rects": [rect], "overlayText": "X"}
    ).json()

    assert result["undoName"] == "Mark for Redaction"
    assert result["dirtyPages"] == [0]
    [mark] = client.get(f"/v1/docs/{doc_id}/redactions").json()
    assert mark["page"] == 0
    assert mark["text"] == SECRET
    assert mark["fill"] == "#000000"
    assert mark["overlayText"] == "X"
    assert mark["rect"] == pytest.approx(rect, abs=1.5)
    # Marks are not ordinary annotations, and nothing is removed yet.
    types = {a["type"] for a in client.get(f"/v1/docs/{doc_id}/annotations").json()}
    assert "redact" not in types
    assert len(hits(client, doc_id)) == 4  # includes the invisible layer


def test_marking_quads(client, open_doc, secret_pdf):
    doc_id = open_doc(secret_pdf)["docId"]
    quad = hits(client, doc_id)[0]["quads"][0]

    result = client.post(f"/v1/docs/{doc_id}/redactions", json={"page": 0, "quads": [quad]})

    assert result.status_code == 200
    assert result.json()["marks"][0]["text"] == SECRET


def test_search_marks_every_match(client, open_doc, secret_pdf):
    doc_id = open_doc(secret_pdf)["docId"]

    result = mark_search(client, doc_id).json()

    # Text: page 1 (shown and invisible), pages 2 and 3; notes: two on page 1.
    assert result["matches"] == 6
    marks = client.get(f"/v1/docs/{doc_id}/redactions").json()
    assert [m["page"] for m in marks] == [0, 0, 0, 0, 1, 2]


def test_search_limited_to_pages(client, open_doc, secret_pdf):
    doc_id = open_doc(secret_pdf)["docId"]

    result = mark_search(client, doc_id, pages=[1]).json()

    assert result["matches"] == 1
    assert result["marks"][0]["page"] == 1


def test_search_without_matches_changes_nothing(client, open_doc, secret_pdf):
    doc_id = open_doc(secret_pdf)["docId"]

    result = client.post(f"/v1/docs/{doc_id}/redactions/search", json={"query": "absent"}).json()

    assert result["matches"] == 0
    assert result["canUndo"] is False


def test_a_mark_can_be_removed(client, open_doc, secret_pdf):
    doc_id = open_doc(secret_pdf)["docId"]
    mark_search(client, doc_id)
    first = client.get(f"/v1/docs/{doc_id}/redactions").json()[0]

    response = client.delete(f"/v1/docs/{doc_id}/redactions/{first['annotId']}")

    assert response.status_code == 200
    assert len(client.get(f"/v1/docs/{doc_id}/redactions").json()) == 5
    assert client.delete(f"/v1/docs/{doc_id}/redactions/{first['annotId']}").status_code == 404


def test_applying_without_marks_is_refused(client, open_doc, secret_pdf):
    doc_id = open_doc(secret_pdf)["docId"]

    assert client.post(f"/v1/docs/{doc_id}/redactions/apply", json={}).status_code == 400


# --- Applying ------------------------------------------------------------------------------


def test_applied_text_is_gone_and_neighbours_survive(client, app, open_doc, secret_pdf):
    doc_id = open_doc(secret_pdf)["docId"]
    mark_search(client, doc_id)

    result = apply(client, doc_id)

    assert result["undoName"] == "Apply Redactions"
    assert result["dirtyPages"] == [0, 1, 2]
    assert client.get(f"/v1/docs/{doc_id}/redactions").json() == []
    assert hits(client, doc_id) == []
    first = page_text(app, doc_id, 0)
    assert SECRET not in first
    assert "Above line keeps every word" in first
    assert "Below line keeps it all" in first
    assert "Name:" in first and "Quill here" in first
    assert "Again" in page_text(app, doc_id, 1) and "appears" in page_text(app, doc_id, 1)
    assert "Turned" in page_text(app, doc_id, 2)


def test_redacted_text_is_absent_from_the_saved_file(client, open_doc, secret_pdf, tmp_path):
    with open(secret_pdf, "rb") as handle:
        assert found_anywhere(handle.read(), SECRET), "the check must find the original"
    doc_id = open_doc(secret_pdf)["docId"]
    mark_search(client, doc_id)
    apply(client, doc_id)

    target = tmp_path / "redacted.pdf"
    assert client.post(f"/v1/docs/{doc_id}/save", json={"path": str(target)}).status_code == 200

    data = target.read_bytes()
    assert not found_anywhere(data, SECRET)
    with pymupdf.open(target) as saved:
        everything = "".join(page.get_text() for page in saved)
        assert SECRET not in everything
        assert "Above line keeps every word" in everything


def test_redacting_after_saving_once_still_leaves_nothing_behind(client, open_doc, secret_pdf):
    doc_id = open_doc(secret_pdf)["docId"]
    client.post(f"/v1/docs/{doc_id}/save", json={})
    mark_search(client, doc_id)
    apply(client, doc_id)

    client.post(f"/v1/docs/{doc_id}/save", json={})

    with open(secret_pdf, "rb") as handle:
        assert not found_anywhere(handle.read(), SECRET)


def test_invisible_text_under_a_mark_is_removed(client, app, open_doc, secret_pdf):
    doc_id = open_doc(secret_pdf)["docId"]
    [hidden] = [hit for hit in hits(client, doc_id) if hit["before"].endswith("Hidden ")]
    client.post(f"/v1/docs/{doc_id}/redactions", json={"page": 0, "quads": hidden["quads"]})

    apply(client, doc_id)

    session = app.state.sessions.get(doc_id)
    with session.lock:
        text = content_text_page(session.doc[0], 0).extractText()
    assert "Hidden" in text and "layer" in text
    assert f"Hidden {SECRET}" not in text
    assert f"Name: {SECRET}" in text  # not marked


def test_partly_covered_picture_loses_only_the_covered_part(client, app, open_doc, secret_pdf):
    doc_id = open_doc(secret_pdf)["docId"]
    client.post(
        f"/v1/docs/{doc_id}/redactions",
        json={"page": 0, "rects": [[290, 290, 350, 410]], "fill": None},
    )

    apply(client, doc_id)

    session = app.state.sessions.get(doc_id)
    with session.lock:
        page = session.doc[0]
        assert len(page.get_images()) == 1
        pixmap = page.get_pixmap(clip=pymupdf.Rect(300, 300, 400, 400))

    def colour(x, y):
        return pixmap.pixel(x - 300, y - 300)

    assert colour(380, 350) == (255, 0, 0)  # uncovered half: still red
    assert colour(320, 350) != (255, 0, 0)  # covered half: blanked


def test_fill_and_overlay_text_are_painted(client, app, open_doc, secret_pdf):
    doc_id = open_doc(secret_pdf)["docId"]
    rect = word_rect(client, doc_id, SECRET, page=1)
    client.post(
        f"/v1/docs/{doc_id}/redactions",
        json={"page": 1, "rects": [rect], "fill": "#000000", "overlayText": "XX"},
    )

    apply(client, doc_id)

    session = app.state.sessions.get(doc_id)
    with session.lock:
        page = session.doc[1]
        pixmap = page.get_pixmap(clip=pymupdf.Rect(rect))
        text = page.get_textbox(pymupdf.Rect(rect))
    dark = sum(1 for i in range(0, len(pixmap.samples), 3) if pixmap.samples[i] < 60)
    assert dark > pixmap.width * pixmap.height * 0.5
    assert "XX" in text


def test_marks_on_a_rotated_page_cover_what_is_shown(client, app, open_doc, secret_pdf):
    doc_id = open_doc(secret_pdf)["docId"]
    rect = word_rect(client, doc_id, SECRET, page=2)
    client.post(f"/v1/docs/{doc_id}/redactions", json={"page": 2, "rects": [rect]})
    assert client.get(f"/v1/docs/{doc_id}/redactions").json()[0]["text"] == SECRET

    apply(client, doc_id)

    text = page_text(app, doc_id, 2)
    assert SECRET not in text and "Turned" in text and "page" in text
    session = app.state.sessions.get(doc_id)
    with session.lock:
        page = session.doc[2]
        full = page.get_pixmap()
    centre = ((rect[0] + rect[2]) / 2, (rect[1] + rect[3]) / 2)
    assert full.pixel(int(centre[0]), int(centre[1])) == (0, 0, 0)


def test_annotations_over_a_mark_are_removed(client, open_doc, secret_pdf):
    doc_id = open_doc(secret_pdf)["docId"]
    rect = word_rect(client, doc_id, SECRET)
    client.post(f"/v1/docs/{doc_id}/redactions", json={"page": 0, "rects": [rect]})

    apply(client, doc_id)

    remaining = [a["contents"] for a in client.get(f"/v1/docs/{doc_id}/annotations").json()]
    assert remaining == ["Unrelated note", f"Ask {SECRET}"]


def test_search_also_removes_annotations_whose_comment_matches(client, open_doc, secret_pdf):
    doc_id = open_doc(secret_pdf)["docId"]
    mark_search(client, doc_id)

    apply(client, doc_id)

    remaining = [a["contents"] for a in client.get(f"/v1/docs/{doc_id}/annotations").json()]
    assert remaining == ["Unrelated note"]


def test_mupdf_still_shifts_text_after_a_removed_run():
    """MuPDF 1.28: removing glyphs from the middle of a text string moves the
    rest of that string back by the advance of the first removed glyph.
    ``redact._measure_shifts`` works around it. When this fails, MuPDF has
    fixed it: remove the workaround (and this test)."""
    doc = pymupdf.open()
    page = doc.new_page()
    page.insert_text((72, 128), "asked Jonathan Whitlock to describe", fontsize=12)
    doc = pymupdf.open(stream=doc.tobytes(), filetype="pdf")
    page = doc[0]
    words = {w[4]: w for w in page.get_text("words")}
    before = words["to"][0]
    target = pymupdf.Rect(words["Whitlock"][:4])
    middle = (target.y0 + target.y1) / 2
    page.add_redact_annot(pymupdf.Rect(target.x0 + 1, middle - 0.4, target.x1 - 1, middle + 0.4))
    page.apply_redactions(images=0, graphics=0, text=0)
    after = {w[4]: w for w in page.get_text("words")}["to"][0]
    assert after == pytest.approx(before - 12 * 0.944, abs=0.05)  # Helvetica "W"


@pytest.mark.parametrize("rotation", [0, 90])
def test_fill_leaves_the_following_text_visible(client, app, open_doc, tmp_path, rotation):
    doc = pymupdf.open()
    page = doc.new_page()
    page.insert_text(
        (72, 128), f"Officer asked {SECRET} Whitlock to describe the driver.", fontsize=12
    )
    page.set_rotation(rotation)
    path = tmp_path / "line.pdf"
    doc.save(path)
    name = next(pymupdf.Rect(w[:4]) for w in doc[0].get_text("words") if w[4] == SECRET)
    doc_id = open_doc(str(path))["docId"]
    mark_search(client, doc_id)

    apply(client, doc_id)

    session = app.state.sessions.get(doc_id)
    with session.lock:
        # get_drawings turns rotated pages, which the journal refuses: use a copy.
        copy = pymupdf.open(stream=session.history.serialise(), filetype="pdf")
    page = copy[0]
    words = page.get_text("words")
    following = pymupdf.Rect(next(w for w in words if w[4] == "Whitlock")[:4])
    # Words and drawings both come in unrotated space.
    fills = [
        pymupdf.Rect(d["rect"]) for d in page.get_drawings() if d.get("fill") == (0.0, 0.0, 0.0)
    ]
    assert len(fills) == 1
    covered = fills[0] & name
    assert covered.width * covered.height > 0.8 * name.width * name.height
    shared = fills[0] & following
    assert shared.is_empty or shared.width * shared.height < 0.5
    assert "Whitlock to describe" in page_text(app, doc_id, 0)


def test_metadata_is_cleaned_by_default(client, open_doc, secret_pdf):
    doc_id = open_doc(secret_pdf)["docId"]
    mark_search(client, doc_id)

    assert apply(client, doc_id)["metadataCleaned"] is True

    info = client.get(f"/v1/docs/{doc_id}/info").json()
    assert SECRET not in str(info)


def test_metadata_can_be_kept(client, open_doc, secret_pdf):
    doc_id = open_doc(secret_pdf)["docId"]
    mark_search(client, doc_id)

    apply(client, doc_id, cleanMetadata=False)

    assert client.get(f"/v1/docs/{doc_id}/info").json()["title"] == f"File about {SECRET}"


def test_applying_is_undoable_also_after_saving(client, app, open_doc, secret_pdf):
    doc_id = open_doc(secret_pdf)["docId"]
    mark_search(client, doc_id)
    apply(client, doc_id)
    client.post(f"/v1/docs/{doc_id}/save", json={})

    undone = client.post(f"/v1/docs/{doc_id}/undo").json()

    assert undone["undone"] == "Apply Redactions"
    assert SECRET in page_text(app, doc_id, 0)
    assert len(client.get(f"/v1/docs/{doc_id}/redactions").json()) == 6
    client.post(f"/v1/docs/{doc_id}/redo")
    assert SECRET not in page_text(app, doc_id, 0)
    assert client.get(f"/v1/docs/{doc_id}/state").json()["modified"] is False
