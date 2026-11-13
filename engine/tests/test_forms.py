"""Forms: listing fields, filling every field type, reset, flatten."""

import pymupdf
import pytest

from pdfengine.textpages import text_page


def fields(client, doc_id):
    response = client.get(f"/v1/docs/{doc_id}/forms")
    assert response.status_code == 200, response.text
    return response.json()


def by_name(entries):
    """name -> entry; radio buttons as name/exportValue."""
    result = {}
    for entry in entries:
        key = entry["name"]
        if entry["type"] == "radio":
            key = f"{key}/{entry['exportValue']}"
        result[key] = entry
    return result


def fill(client, doc_id, **values):
    """Sets values by field name (radio: color=<export value>)."""
    named = by_name(fields(client, doc_id))
    body = []
    for name, value in values.items():
        if name == "color":
            target = named[f"color/{value}"] if value else named["color/Red"]
            body.append({"fieldId": target["fieldId"], "value": value})
        else:
            body.append({"fieldId": named[name]["fieldId"], "value": value})
    return client.post(f"/v1/docs/{doc_id}/forms/values", json={"values": body})


def values(client, doc_id):
    return {key: entry["value"] for key, entry in by_name(fields(client, doc_id)).items()}


ALL_VALUES = dict(
    name="Zoë Example",
    notes="line one\nline two",
    agree=True,
    color="Blue",
    country="Japan",
    fruit=["Apple", "Cherry"],
    city="Lahore",
)


def test_fields_are_listed_with_their_types_and_flags(client, open_doc, form_pdf):
    doc_id = open_doc(form_pdf)["docId"]

    named = by_name(fields(client, doc_id))

    assert sorted(named) == [
        "agree",
        "city",
        "color/Blue",
        "color/Red",
        "country",
        "fruit",
        "id",
        "name",
        "notes",
        "sig",
        "size",
    ]
    assert {key: entry["type"] for key, entry in named.items()} == {
        "agree": "checkbox",
        "city": "text",
        "color/Blue": "radio",
        "color/Red": "radio",
        "country": "combobox",
        "fruit": "listbox",
        "id": "text",
        "name": "text",
        "notes": "text",
        "sig": "signature",
        "size": "checkbox",
    }
    assert named["notes"]["flags"]["multiline"] is True
    assert named["notes"]["maxLength"] == 40
    assert named["id"]["flags"]["readOnly"] is True
    assert named["id"]["value"] == "A-1"
    assert named["sig"]["flags"]["readOnly"] is True
    assert named["fruit"]["flags"]["multiSelect"] is True
    assert named["country"]["options"] == [
        {"value": "Pakistan", "label": "Pakistan"},
        {"value": "Germany", "label": "Germany"},
        {"value": "Japan", "label": "Japan"},
    ]
    assert named["color/Red"]["flags"]["noToggleToOff"] is True
    assert named["agree"]["exportValue"] == "Yes"
    assert named["name"]["rect"] == [50, 50, 250, 70]
    assert named["name"]["fontSize"] == 11
    assert named["city"]["page"] == 1


def test_fields_on_a_rotated_page_are_in_displayed_space(client, open_doc, form_pdf):
    doc_id = open_doc(form_pdf)["docId"]

    city = by_name(fields(client, doc_id))["city"]

    with pymupdf.open(form_pdf) as doc:
        expected = pymupdf.Rect(100, 100, 300, 120) * doc[1].rotation_matrix
    assert city["rect"] == pytest.approx(list(expected), abs=0.01)


def test_values_round_trip_for_every_field_type(client, open_doc, form_pdf):
    doc_id = open_doc(form_pdf)["docId"]

    response = fill(client, doc_id, **ALL_VALUES)

    assert response.status_code == 200, response.text
    result = response.json()
    assert result["undoName"] == "Fill Form"
    assert result["dirtyPages"] == [0, 1]
    got = values(client, doc_id)
    assert got["name"] == "Zoë Example"
    assert got["notes"] == "line one\nline two"
    assert got["agree"] is True
    assert got["color/Blue"] == got["color/Red"] == "Blue"
    assert got["country"] == "Japan"
    assert got["fruit"] == ["Apple", "Cherry"]
    assert got["city"] == "Lahore"


def test_filled_values_survive_saving_and_reopening(client, open_doc, form_pdf):
    doc_id = open_doc(form_pdf)["docId"]
    fill(client, doc_id, **ALL_VALUES)

    client.post(f"/v1/docs/{doc_id}/save", json={})
    client.delete(f"/v1/docs/{doc_id}")
    reopened = open_doc(form_pdf)["docId"]

    got = values(client, reopened)
    assert got["name"] == "Zoë Example"
    assert got["agree"] is True
    assert got["color/Red"] == "Blue"
    assert got["fruit"] == ["Apple", "Cherry"]
    # PyMuPDF (as another reader) sees the same values.
    with pymupdf.open(form_pdf) as doc:
        widgets = {w.field_name: w for w in doc[0].widgets()}
        assert widgets["name"].field_value == "Zoë Example"
        assert widgets["country"].field_value == "Japan"
        assert widgets["agree"].field_value == "Yes"


def test_values_show_on_the_page(client, open_doc, form_pdf, app):
    doc_id = open_doc(form_pdf)["docId"]

    fill(client, doc_id, name="Visible Name", country="Germany")

    session = app.state.sessions.get(doc_id)
    with session.lock:
        text = text_page(session.doc[0], 0).extractText()
    assert "Visible Name" in text
    assert "Germany" in text


def test_radio_buttons_switch_within_the_group(client, open_doc, form_pdf):
    doc_id = open_doc(form_pdf)["docId"]

    fill(client, doc_id, color="Blue")
    fill(client, doc_id, color="Red")
    assert values(client, doc_id)["color/Blue"] == "Red"

    fill(client, doc_id, color=None)
    assert values(client, doc_id)["color/Red"] is None


def test_checkboxes_of_one_field_report_their_own_state(client, open_doc, form_pdf):
    """Two checkbox widgets of one field ("size", on states S and L): turning
    one on turns the other off, and each reports its own state."""
    doc_id = open_doc(form_pdf)["docId"]
    kids = {e["exportValue"]: e for e in fields(client, doc_id) if e["name"] == "size"}
    assert sorted(kids) == ["L", "S"]

    for value in ("S", "L"):
        response = client.post(
            f"/v1/docs/{doc_id}/forms/values",
            json={"values": [{"fieldId": kids[value]["fieldId"], "value": True}]},
        )
        assert response.status_code == 200, response.text
        states = {
            e["exportValue"]: e["value"] for e in fields(client, doc_id) if e["name"] == "size"
        }
        assert states == {"S": value == "S", "L": value == "L"}


def test_checkbox_can_be_cleared(client, open_doc, form_pdf):
    doc_id = open_doc(form_pdf)["docId"]

    fill(client, doc_id, agree=True)
    fill(client, doc_id, agree=False)

    assert values(client, doc_id)["agree"] is False


def test_one_undo_step_per_call(client, open_doc, form_pdf):
    doc_id = open_doc(form_pdf)["docId"]
    fill(client, doc_id, name="First")
    fill(client, doc_id, **ALL_VALUES)

    client.post(f"/v1/docs/{doc_id}/undo")
    got = values(client, doc_id)
    assert got["name"] == "First"
    assert got["agree"] is False
    assert got["fruit"] == []

    client.post(f"/v1/docs/{doc_id}/redo")
    assert values(client, doc_id)["fruit"] == ["Apple", "Cherry"]


def test_undo_after_saving(client, open_doc, form_pdf):
    doc_id = open_doc(form_pdf)["docId"]
    fill(client, doc_id, **ALL_VALUES)
    client.post(f"/v1/docs/{doc_id}/save", json={})

    client.post(f"/v1/docs/{doc_id}/undo")

    got = values(client, doc_id)
    assert got["name"] == ""
    assert got["color/Red"] is None
    client.post(f"/v1/docs/{doc_id}/redo")
    assert values(client, doc_id)["name"] == "Zoë Example"


def test_setting_the_same_values_changes_nothing(client, open_doc, form_pdf):
    doc_id = open_doc(form_pdf)["docId"]

    result = fill(client, doc_id, name="", agree=False).json()

    assert result["revision"] == 0
    assert result["canUndo"] is False


@pytest.mark.parametrize(
    ("name", "value"),
    [
        ("id", "changed"),  # read-only
        ("agree", "yes"),  # not a bool
        ("country", "Atlantis"),  # not an entry
        ("fruit", ["Kiwi"]),
        ("name", 5),
    ],
)
def test_bad_values_are_rejected_and_nothing_changes(client, open_doc, form_pdf, name, value):
    doc_id = open_doc(form_pdf)["docId"]
    named = by_name(fields(client, doc_id))

    response = client.post(
        f"/v1/docs/{doc_id}/forms/values",
        json={
            "values": [
                {"fieldId": named["name"]["fieldId"], "value": "ok"},
                {"fieldId": named[name]["fieldId"], "value": value},
            ]
        },
    )

    assert response.status_code in (400, 422)
    assert values(client, doc_id)["name"] == ""


def test_signature_fields_cannot_be_filled(client, open_doc, form_pdf):
    doc_id = open_doc(form_pdf)["docId"]
    sig = by_name(fields(client, doc_id))["sig"]

    response = client.post(
        f"/v1/docs/{doc_id}/forms/values",
        json={"values": [{"fieldId": sig["fieldId"], "value": "x"}]},
    )

    assert response.status_code == 400


def test_text_longer_than_the_limit_is_cut(client, open_doc, form_pdf):
    doc_id = open_doc(form_pdf)["docId"]

    fill(client, doc_id, notes="x" * 60)

    assert values(client, doc_id)["notes"] == "x" * 40


def test_unknown_field(client, open_doc, form_pdf):
    doc_id = open_doc(form_pdf)["docId"]

    response = client.post(
        f"/v1/docs/{doc_id}/forms/values", json={"values": [{"fieldId": 99999, "value": "x"}]}
    )

    assert response.status_code == 404


def test_reset_clears_values(client, open_doc, form_pdf):
    doc_id = open_doc(form_pdf)["docId"]
    fill(client, doc_id, **ALL_VALUES)

    result = client.post(f"/v1/docs/{doc_id}/forms/reset").json()

    assert result["undoName"] == "Reset Form"
    got = values(client, doc_id)
    assert got["name"] == ""
    assert got["agree"] is False
    assert got["color/Blue"] is None
    assert got["fruit"] == []
    client.post(f"/v1/docs/{doc_id}/undo")
    assert values(client, doc_id)["name"] == "Zoë Example"


def test_flatten_removes_the_fields_and_keeps_the_values_visible(client, open_doc, form_pdf, app):
    doc_id = open_doc(form_pdf)["docId"]
    fill(client, doc_id, name="Flat Name", country="Japan", city="Lahore")

    result = client.post(f"/v1/docs/{doc_id}/forms/flatten").json()

    assert result["undoName"] == "Flatten Form"
    assert fields(client, doc_id) == []
    session = app.state.sessions.get(doc_id)
    with session.lock:
        page_text = text_page(session.doc[0], 0).extractText()
        city_text = text_page(session.doc[1], 0).extractText()
    assert "Flat Name" in page_text
    assert "Japan" in page_text
    assert "Lahore" in city_text

    client.post(f"/v1/docs/{doc_id}/save", json={})
    with pymupdf.open(form_pdf) as doc:
        assert not doc.is_form_pdf
        assert list(doc[0].widgets()) == []
        assert "Flat Name" in doc[0].get_text()

    client.post(f"/v1/docs/{doc_id}/undo")
    assert len(fields(client, doc_id)) == 12


def test_flatten_without_fields(client, open_doc, sample_pdf):
    doc_id = open_doc(sample_pdf)["docId"]

    assert client.post(f"/v1/docs/{doc_id}/forms/flatten").status_code == 400
    assert fields(client, doc_id) == []
