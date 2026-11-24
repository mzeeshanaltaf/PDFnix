"""Fonts for new and replaced text.

New text is laid out by MuPDF's HTML engine (``insert_htmlbox``), which has
built-in fonts metric-compatible with the common ones: CSS ``Helvetica`` /
``Arial`` give Nimbus Sans, ``Times`` gives Nimbus Roman and ``Courier`` Nimbus
Mono PS, each with bold and italic. Characters those lack (Greek and Cyrillic
are covered; Arabic, Devanagari, CJK… are not) fall back to MuPDF's built-in
Noto and Droid fonts automatically. So no font files are bundled.

When text is replaced, the document's own font is used if it is embedded and
has a glyph for every new character. Subsetted fonts usually do not: they hold
only the characters the document used, and subsets of CID fonts lose their
Unicode mapping altogether, so they fail the check and a built-in font of the
same kind (serif / sans / mono, bold, italic) is used instead. The caller tells
the user about the substitution.
"""

import re
from dataclasses import dataclass
from typing import Any

import pymupdf

from .sessions import Session

#: The built-in families offered for new text: id, label, CSS family.
BUILTIN_FAMILIES = (
    ("sans", "Sans (Helvetica, Arial)", "Helvetica"),
    ("serif", "Serif (Times)", "Times"),
    ("mono", "Monospace (Courier)", "Courier"),
)
_CSS = {key: css for key, _, css in BUILTIN_FAMILIES}

#: Span flags from MuPDF's text extraction.
FLAG_ITALIC = 2
FLAG_SERIF = 4
FLAG_MONO = 8
FLAG_BOLD = 16

#: The standard-14 names (and common aliases) MuPDF draws with the Nimbus
#: fonts anyway: replacing them with a built-in font is not a substitution.
_STANDARD = re.compile(
    r"^(helvetica|arial|arialmt|times|timesnewroman|times-roman|timesnewromanps|courier|couriernew)"
    r"([-,]?(bold|italic|oblique|bolditalic|boldoblique|roman|regular|ps|mt|psmt)*)*$",
    re.IGNORECASE,
)

_SUBSET_PREFIX = re.compile(r"^[A-Z]{6}\+")


def base_name(name: str) -> str:
    """A font name without its subset prefix (``ABCDEF+``)."""
    return _SUBSET_PREFIX.sub("", name)


@dataclass
class FontChoice:
    """What new text is set in."""

    #: CSS ``font-family`` for ``insert_htmlbox``.
    css_family: str
    bold: bool
    italic: bool
    #: Shown to the user.
    label: str
    #: True when the original font could not be used.
    substituted: bool
    archive: pymupdf.Archive | None = None
    #: ``@font-face`` rule for a document font.
    font_face: str = ""
    #: The document font's file and the name ``font_face`` refers to it by.
    font_file: tuple[bytes, str] | None = None

    def css(self) -> str:
        return (
            f"font-family: {self.css_family}; "
            f"font-weight: {'bold' if self.bold else 'normal'}; "
            f"font-style: {'italic' if self.italic else 'normal'};"
        )


def family_for(name: str, flags: int) -> str:
    """``sans``, ``serif`` or ``mono`` for a font, from its flags and name."""
    lowered = name.lower()
    if flags & FLAG_MONO or any(key in lowered for key in ("courier", "mono", "consol")):
        return "mono"
    if "sans" in lowered:
        return "sans"
    if flags & FLAG_SERIF or any(
        key in lowered for key in ("times", "serif", "roman", "georgia", "garamond", "cambria")
    ):
        return "serif"
    return "sans"


def style_for(name: str, flags: int) -> tuple[bool, bool]:
    lowered = name.lower()
    bold = bool(flags & FLAG_BOLD) or any(
        key in lowered for key in ("bold", "black", "heavy", "semibold", "demi")
    )
    italic = bool(flags & FLAG_ITALIC) or "italic" in lowered or "oblique" in lowered
    return bold, italic


def builtin_choice(family: str, bold: bool, italic: bool, *, substituted: bool) -> FontChoice:
    label = next(label for key, label, _ in BUILTIN_FAMILIES if key == family)
    return FontChoice(
        css_family=_CSS[family], bold=bold, italic=italic, label=label, substituted=substituted
    )


def _normalise(name: str) -> str:
    """A font name for comparing: no subset prefix, case, spaces, hyphens or
    a trailing "Regular" (MuPDF reports "Georgia" for "Georgia Regular")."""
    plain = re.sub(r"[^a-z0-9]", "", base_name(name).lower())
    return plain.removesuffix("regular") or plain


def _page_font(page: pymupdf.Page, span_font: str) -> tuple[int, str] | None:
    """The page font a span's font name refers to: (xref, base font)."""
    wanted = _normalise(span_font)
    for xref, _ext, _type, basefont, *_ in page.get_fonts(full=True):
        if _normalise(basefont) == wanted:
            return xref, basefont
    return None


def _usable_buffer(doc: pymupdf.Document, xref: int, text: str) -> bytes | None:
    """The font file for ``xref`` if it is embedded and has every character
    of ``text``; else None."""
    try:
        _name, ext, _type, buffer = doc.extract_font(xref)
    except Exception:
        return None
    if not buffer or ext in ("n/a", ""):
        return None
    try:
        font = pymupdf.Font(fontbuffer=buffer)
    except Exception:
        return None
    for char in set(text):
        if char.isspace():
            continue
        if not font.has_glyph(ord(char)):
            return None
    return buffer


def choose_for_replacement(
    doc: pymupdf.Document, page: pymupdf.Page, span_font: str, flags: int, text: str
) -> FontChoice:
    """The font to set ``text`` in, replacing text that was in ``span_font``."""
    bold, italic = style_for(span_font, flags)
    family = family_for(span_font, flags)
    found = _page_font(page, span_font)
    if found is not None and text.strip():
        xref, basefont = found
        buffer = _usable_buffer(doc, xref, text)
        if buffer is not None:
            file_name = f"docfont{xref}.font"
            archive = pymupdf.Archive()
            archive.add((buffer, file_name))
            css_family = f"DocFont{xref}"
            return FontChoice(
                css_family=css_family,
                # The font file is already bold/italic; asking again would
                # make MuPDF embolden or slant it a second time.
                bold=False,
                italic=False,
                label=base_name(basefont),
                substituted=False,
                archive=archive,
                font_face=f"@font-face {{font-family: {css_family}; src: url({file_name});}}",
                font_file=(buffer, file_name),
            )
    standard = bool(_STANDARD.match(span_font.replace(" ", "")))
    return builtin_choice(family, bold, italic, substituted=not standard)


#: PyMuPDF's codes for the built-in fonts: (family, bold, italic) -> code.
_BUILTIN_CODES = {
    ("sans", False, False): "helv",
    ("sans", True, False): "hebo",
    ("sans", False, True): "heit",
    ("sans", True, True): "hebi",
    ("serif", False, False): "tiro",
    ("serif", True, False): "tibo",
    ("serif", False, True): "tiit",
    ("serif", True, True): "tibi",
    ("mono", False, False): "cour",
    ("mono", True, False): "cobo",
    ("mono", False, True): "coit",
    ("mono", True, True): "cobi",
}


@dataclass
class RunFont:
    """A font to write a run of text in directly (``TextWriter``), replacing
    text that was in another font."""

    font: pymupdf.Font
    #: Shown to the user.
    label: str
    #: True when the original font could not be used.
    substituted: bool


def font_for_run(
    doc: pymupdf.Document, page: pymupdf.Page, span_font: str, flags: int, text: str
) -> RunFont | None:
    """The document's own font for ``text`` when it is embedded and can draw
    every character, else the matching built-in font. None when not even the
    built-in font has every character (the caller then lets MuPDF's HTML
    layout pick fallback fonts)."""
    found = _page_font(page, span_font)
    if found is not None and text.strip():
        xref, basefont = found
        buffer = _usable_buffer(doc, xref, text)
        if buffer is not None:
            return RunFont(pymupdf.Font(fontbuffer=buffer), base_name(basefont), False)
    bold, italic = style_for(span_font, flags)
    family = family_for(span_font, flags)
    font = pymupdf.Font(_BUILTIN_CODES[(family, bold, italic)])
    if any(not char.isspace() and not font.has_glyph(ord(char)) for char in set(text)):
        return None
    standard = bool(_STANDARD.match(span_font.replace(" ", "")))
    label = next(label for key, label, _ in BUILTIN_FAMILIES if key == family)
    return RunFont(font, label, substituted=not standard)


def list_fonts(session: Session | None) -> list[dict[str, Any]]:
    """Fonts offered for new text: the built-in families, then the fonts
    embedded in the document (marked when they are subsets, which can only
    draw the characters the document already uses)."""
    result: list[dict[str, Any]] = [
        {"id": key, "name": label, "kind": "builtin", "subset": False}
        for key, label, _ in BUILTIN_FAMILIES
    ]
    if session is None:
        return result
    seen: set[int] = set()
    with session.lock:
        doc = session.doc
        for page in doc:
            for xref, ext, _type, basefont, *_ in page.get_fonts(full=True):
                if xref in seen or ext in ("n/a", ""):
                    continue
                seen.add(xref)
                result.append(
                    {
                        "id": f"doc:{xref}",
                        "name": base_name(basefont),
                        "kind": "document",
                        "subset": bool(_SUBSET_PREFIX.match(basefont)),
                    }
                )
    return result
