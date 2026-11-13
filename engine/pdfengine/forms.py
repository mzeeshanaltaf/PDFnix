"""Interactive forms: list fields, fill them, reset and flatten.

Values are set with MuPDF's own form calls (``pdf_set_field_value``,
``pdf_toggle_widget``, ``pdf_reset_form``), not PyMuPDF's ``Widget.update``,
which also rewrites the field's rectangle, colours, font string, flags and
scripts: on real-world forms that changes how fields look. MuPDF's calls change
the value and regenerate the appearance, nothing else. Form JavaScript is not
run (``ignore_trigger_events``), so calculated fields do not recalculate.

A field shown in several places (a radio group, or a text field with several
widgets) is one entry per widget; ``fieldId`` is the widget's xref. All the
widgets of a radio group share ``name`` and ``value``; each has its own
``exportValue``.
"""

from typing import Any

import pymupdf
from pymupdf import mupdf

from .annotations import _bounds, _rect, hex_color
from .errors import BadRequestError, NotFoundError
from .sessions import Session

FieldType = str

_TYPES: dict[int, FieldType] = {
    pymupdf.PDF_WIDGET_TYPE_BUTTON: "button",
    pymupdf.PDF_WIDGET_TYPE_CHECKBOX: "checkbox",
    pymupdf.PDF_WIDGET_TYPE_COMBOBOX: "combobox",
    pymupdf.PDF_WIDGET_TYPE_LISTBOX: "listbox",
    pymupdf.PDF_WIDGET_TYPE_RADIOBUTTON: "radio",
    pymupdf.PDF_WIDGET_TYPE_SIGNATURE: "signature",
    pymupdf.PDF_WIDGET_TYPE_TEXT: "text",
}

# Field flags (PDF 32000-1, 12.7.3.1, 12.7.4.2-4).
_FF_READ_ONLY = 1 << 0
_FF_REQUIRED = 1 << 1
_FF_MULTILINE = 1 << 12
_FF_PASSWORD = 1 << 13
_FF_NO_TOGGLE_TO_OFF = 1 << 14
_FF_EDIT = 1 << 18
_FF_MULTI_SELECT = 1 << 21
_FF_COMB = 1 << 24

_HIDDEN = pymupdf.PDF_ANNOT_IS_HIDDEN | pymupdf.PDF_ANNOT_IS_NO_VIEW
_ALIGN = {0: "left", 1: "center", 2: "right"}

V = mupdf.PDF_ENUM_NAME_V
_NAME = mupdf.pdf_new_name


def _obj(widget: pymupdf.Widget) -> mupdf.PdfObj:
    return mupdf.pdf_annot_obj(widget._annot.this)


def _field(obj: mupdf.PdfObj) -> mupdf.PdfObj:
    """The field dictionary a widget belongs to: the nearest one with a name
    (``/T``), where the value is kept."""
    current = obj
    for _ in range(32):
        if mupdf.pdf_dict_get(current, mupdf.PDF_ENUM_NAME_T).m_internal:
            return current
        parent = mupdf.pdf_dict_get(current, mupdf.PDF_ENUM_NAME_Parent)
        if not parent.m_internal:
            break
        current = parent
    return obj


def _options(widget: pymupdf.Widget) -> list[dict[str, str]]:
    """Choices as ``{value, label}``: ``/Opt`` entries are either a string or
    an [export value, shown text] pair."""
    result = []
    for choice in widget.choice_values or []:
        if isinstance(choice, (list, tuple)) and len(choice) == 2:
            result.append({"value": str(choice[0]), "label": str(choice[1])})
        else:
            result.append({"value": str(choice), "label": str(choice)})
    return result


def _list_value(obj: mupdf.PdfObj) -> list[str]:
    value = mupdf.pdf_dict_get_inheritable(obj, V)
    if mupdf.pdf_is_array(value):
        return [
            mupdf.pdf_to_text_string(mupdf.pdf_array_get(value, i))
            for i in range(mupdf.pdf_array_len(value))
        ]
    if mupdf.pdf_is_string(value) or mupdf.pdf_is_name(value):
        text = mupdf.pdf_field_value(obj)
        return [text] if text else []
    return []


def _value(widget: pymupdf.Widget, kind: FieldType) -> Any:
    obj = _obj(widget)
    if kind == "checkbox":
        # A widget's own state (/AS): when several checkboxes are kids of one
        # field, the field's value says which one is on, not whether this is.
        state = mupdf.pdf_dict_get(obj, mupdf.PDF_ENUM_NAME_AS)
        if mupdf.pdf_is_name(state):
            return mupdf.pdf_to_name(state) != "Off"
        return mupdf.pdf_field_value(obj) not in ("", "Off")
    if kind == "radio":
        value = mupdf.pdf_field_value(obj)
        return None if value in ("", "Off") else value
    if kind == "listbox":
        return _list_value(obj)
    if kind in ("text", "combobox"):
        return mupdf.pdf_field_value(obj)
    return None


def _describe(widget: pymupdf.Widget, page: int) -> dict[str, Any] | None:
    kind = _TYPES.get(widget.field_type)
    if kind is None or widget._annot.flags & _HIDDEN:
        return None
    flags = widget.field_flags or 0
    obj = _obj(widget)
    quadding = mupdf.pdf_to_int(mupdf.pdf_dict_get_inheritable(obj, mupdf.PDF_ENUM_NAME_Q))
    entry: dict[str, Any] = {
        "fieldId": widget.xref,
        "page": page,
        "rect": _rect(_bounds(widget._annot)),
        "type": kind,
        "name": widget.field_name or "",
        "label": widget.field_label or "",
        "value": _value(widget, kind),
        "flags": {
            "readOnly": bool(flags & _FF_READ_ONLY) or kind in ("signature", "button"),
            "required": bool(flags & _FF_REQUIRED),
            "multiline": kind == "text" and bool(flags & _FF_MULTILINE),
            "password": kind == "text" and bool(flags & _FF_PASSWORD),
            "comb": kind == "text" and bool(flags & _FF_COMB),
            "editable": kind == "combobox" and bool(flags & _FF_EDIT),
            "multiSelect": kind == "listbox" and bool(flags & _FF_MULTI_SELECT),
            "noToggleToOff": kind == "radio" and bool(flags & _FF_NO_TOGGLE_TO_OFF),
        },
        "fontSize": round(widget.text_fontsize or 0, 2),
        "textColor": hex_color(widget.text_color) or "#000000",
        "align": _ALIGN.get(quadding, "left"),
    }
    if kind == "text" and widget.text_maxlen:
        entry["maxLength"] = widget.text_maxlen
    if kind in ("combobox", "listbox"):
        entry["options"] = _options(widget)
    if kind in ("checkbox", "radio"):
        on = widget.on_state()
        entry["exportValue"] = on if isinstance(on, str) else "Yes"
    return entry


def list_fields(session: Session) -> list[dict[str, Any]]:
    """Every visible form field widget, in page order and, on each page, in the
    order of the page's annotations (the document's tab order)."""
    with session.lock:
        fields: list[dict[str, Any]] = []
        for index, page in enumerate(session.doc):
            for widget in page.widgets():
                entry = _describe(widget, index)
                if entry is not None:
                    fields.append(entry)
        return fields


def _find_widgets(
    session: Session, ids: set[int]
) -> dict[int, tuple[int, pymupdf.Page, pymupdf.Widget]]:
    """Widgets by xref, with their page index and page. Call with the lock
    held. The page is returned to keep it alive: a widget whose page object
    has been collected is "not bound to any page"."""
    found: dict[int, tuple[int, pymupdf.Page, pymupdf.Widget]] = {}
    for index, page in enumerate(session.doc):
        for widget in page.widgets():
            if widget.xref in ids:
                found[widget.xref] = (index, page, widget)
        if len(found) == len(ids):
            break
    return found


def _set_list(pdf: mupdf.PdfDocument, widget: pymupdf.Widget, values: list[str]) -> None:
    """Selects several entries of a list box. (MuPDF's
    ``pdf_choice_widget_set_value`` cannot be called from Python.)"""
    field = _field(_obj(widget))
    options = [option["value"] for option in _options(widget)]
    array = mupdf.pdf_new_array(pdf, len(values))
    for value in values:
        mupdf.pdf_array_push_text_string(array, value)
    mupdf.pdf_dict_put(field, V, array)
    indexes = sorted(options.index(value) for value in values if value in options)
    selected = mupdf.pdf_new_array(pdf, len(indexes))
    for position in indexes:
        mupdf.pdf_array_push_int(selected, position)
    mupdf.pdf_dict_put(field, mupdf.PDF_ENUM_NAME_I, selected)
    mupdf.pdf_dirty_annot(widget._annot.this)


def _radio_off(session: Session, widget: pymupdf.Widget) -> None:
    """Turns a whole radio group off."""
    field = _field(_obj(widget))
    mupdf.pdf_dict_put(field, V, _NAME("Off"))
    for page in session.doc:
        for other in page.widgets():
            if other.field_type == pymupdf.PDF_WIDGET_TYPE_RADIOBUTTON:
                other_obj = _obj(other)
                if mupdf.pdf_objcmp(_field(other_obj), field) == 0:
                    mupdf.pdf_dict_put(other_obj, mupdf.PDF_ENUM_NAME_AS, _NAME("Off"))
                    mupdf.pdf_dirty_annot(other._annot.this)


def _check_value(entry: dict[str, Any], value: Any) -> Any:
    """Validates ``value`` for the field ``entry``; returns it normalised."""
    kind, name = entry["type"], entry["name"] or f"#{entry['fieldId']}"
    if entry["flags"]["readOnly"]:
        raise BadRequestError(f"The field {name} cannot be changed.")
    if kind == "checkbox":
        if not isinstance(value, bool):
            raise BadRequestError(f"The checkbox {name} takes true or false.")
        return value
    if kind == "radio":
        if value is not None and not isinstance(value, (str, bool)):
            raise BadRequestError(f"The radio button {name} takes its export value or null.")
        if value is True:
            return entry["exportValue"]
        if value is False:
            return None
        return value
    if kind == "listbox":
        values = [value] if isinstance(value, str) else value
        if not isinstance(values, list) or not all(isinstance(v, str) for v in values):
            raise BadRequestError(f"The list {name} takes a list of its values.")
        if len(values) > 1 and not entry["flags"]["multiSelect"]:
            raise BadRequestError(f"Only one entry of the list {name} can be chosen.")
        allowed = {option["value"] for option in entry.get("options", [])}
        unknown = [v for v in values if v not in allowed]
        if unknown:
            raise BadRequestError(f"{unknown[0]!r} is not an entry of the list {name}.")
        return values
    if not isinstance(value, str):
        raise BadRequestError(f"The field {name} takes text.")
    if kind == "combobox" and not entry["flags"]["editable"]:
        allowed = {option["value"] for option in entry.get("options", [])}
        if value and value not in allowed:
            raise BadRequestError(f"{value!r} is not an entry of the list {name}.")
    if kind == "text" and entry.get("maxLength"):
        value = value[: entry["maxLength"]]
    return value


def set_values(session: Session, values: list[dict[str, Any]]) -> dict[str, Any]:
    """Sets field values (``[{fieldId, value}]``) as one undoable step.

    Values: text and combo box fields take a string, checkboxes true/false,
    radio buttons the export value of the button to turn on (or null for none),
    list boxes a list of entry values.
    """
    if not values:
        raise BadRequestError("No values were given.")
    with session.lock:
        ids = {item["fieldId"] for item in values}
        widgets = _find_widgets(session, ids)
        missing = ids - widgets.keys()
        if missing:
            raise NotFoundError(f"No form field with id {min(missing)}.")
        # Validate everything before changing anything.
        planned = []
        for item in values:
            index, _page, widget = widgets[item["fieldId"]]
            entry = _describe(widget, index)
            if entry is None:
                raise NotFoundError(f"No form field with id {item['fieldId']}.")
            planned.append((index, widget, entry, _check_value(entry, item["value"])))

        pdf = pymupdf._as_pdf_document(session.doc)
        with session.edit("Fill Form") as step:
            for index, widget, entry, value in planned:
                if value == _value(widget, entry["type"]):
                    continue
                annot = widget._annot.this
                kind = entry["type"]
                if kind in ("text", "combobox"):
                    mupdf.pdf_set_field_value(pdf, _obj(widget), value, 1)
                elif kind == "checkbox":
                    mupdf.pdf_toggle_widget(annot)
                elif kind == "radio":
                    if value is None:
                        _radio_off(session, widget)
                    else:
                        _target_page, target = _radio_button(session, widget, value)
                        mupdf.pdf_toggle_widget(target._annot.this)
                elif kind == "listbox":
                    if len(value) == 1 and not entry["flags"]["multiSelect"]:
                        mupdf.pdf_set_field_value(pdf, _obj(widget), value[0], 1)
                    else:
                        _set_list(pdf, widget, value)
                step.pages.add(index)
            _update_pages(session, step.pages)
        if not step.pages:
            return session.unchanged()
        return session.mutated(step.pages)


def _radio_button(
    session: Session, widget: pymupdf.Widget, value: str
) -> tuple[pymupdf.Page | None, pymupdf.Widget]:
    """The button of ``widget``'s group whose export value is ``value``, and
    its page (kept alive for the caller)."""
    if widget.on_state() == value:
        return None, widget
    field = _field(_obj(widget))
    for page in session.doc:
        for other in page.widgets():
            if (
                other.field_type == pymupdf.PDF_WIDGET_TYPE_RADIOBUTTON
                and other.on_state() == value
                and mupdf.pdf_objcmp(_field(_obj(other)), field) == 0
            ):
                return page, other
    raise BadRequestError(f"The radio group {widget.field_name} has no button {value!r}.")


def _update_pages(session: Session, pages: set[int]) -> None:
    """Regenerates the appearances of changed fields (inside the operation,
    so the new appearances are part of the undo step)."""
    for index in pages:
        mupdf.pdf_update_page(pymupdf._as_pdf_page(session.doc[index]))


def _pages_with_fields(session: Session) -> set[int]:
    return {index for index, page in enumerate(session.doc) if any(True for _ in page.widgets())}


def reset_form(session: Session) -> dict[str, Any]:
    """Puts every field back to its default value (usually empty)."""
    with session.lock:
        pages = _pages_with_fields(session)
        if not pages:
            return session.unchanged()
        pdf = pymupdf._as_pdf_document(session.doc)
        before = session.history.position
        with session.edit("Reset Form") as step:
            mupdf.pdf_reset_form(pdf, mupdf.PdfObj(), 1)
            step.pages |= pages
            _update_pages(session, pages)
        if session.history.position == before:
            return session.unchanged()  # everything was at its default already
        return session.mutated(step.pages)


def flatten_form(session: Session) -> dict[str, Any]:
    """Turns every field into ordinary page content showing its value; the
    fields can no longer be edited. Other annotations are left alone."""
    with session.lock:
        pages = _pages_with_fields(session)
        if not pages:
            raise BadRequestError("The document has no form fields.")
        with session.edit("Flatten Form") as step:
            _update_pages(session, pages)
            session.doc.bake(annots=False, widgets=True)
            step.pages |= pages
        return session.mutated(step.pages)
