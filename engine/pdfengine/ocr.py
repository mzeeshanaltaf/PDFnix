"""OCR: make scanned pages searchable and selectable.

Job type ``ocr`` with ``{ pages?, languages, dpi, skipPagesWithText }``.

PyMuPDF's built-in Tesseract does the recognition; only language data files
(``<code>.traineddata``) are needed. English is bundled in
``resources/tessdata`` (``PDFENGINE_TESSDATA_BUNDLED``; the development layout
is the default). Other languages are downloaded on demand (job type
``ocr-language``) from the official ``tessdata_fast`` repository into the app's
data folder (``PDFENGINE_TESSDATA_DIR``). The engine always names the folder
itself, so a Tesseract installed on the machine is never used by accident.

Per page, in a child process (``ocr_worker``): the page is rendered without
annotations at the chosen resolution (in RGB: from a grey picture MuPDF's OCR
writer gets no text at all); Tesseract turns the picture into a one-page PDF
holding the picture and an invisible text layer (``Pixmap.pdfocr_tobytes``:
Tesseract's "GlyphLessFont", each word stretched to its box); and the picture
is removed from that page, leaving only the text layer. Back in the engine,
each text layer is laid over its page (``show_pdf_page``, in one undo step
"Recognise Text"). The page looks exactly as before and its words can be
searched, selected and copied. This is the approach OCRmyPDF uses.

Pages that already carry text are skipped by default.
"""

import os
import re
import shutil
import tempfile
import urllib.error
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import pymupdf
from pydantic import Field

from .api import _Body
from .errors import BadRequestError, EngineError, NotFoundError
from .jobs import DocumentChangedError, JobContext, JobType
from .sessions import Session
from .textpages import has_text
from .worker import run_in_process

DOWNLOAD_URL = (
    "https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/main/{code}.traineddata"
)
SUFFIX = ".traineddata"
#: Largest page picture handed to Tesseract (pixels); larger pages get a lower
#: resolution.
MAX_PIXELS = 60_000_000
MIN_DPI, MAX_DPI = 72, 600

#: The languages of ``tessdata_fast`` (code: name, size in KB).
LANGUAGES: dict[str, tuple[str, int]] = {
    "afr": ("Afrikaans", 2590),
    "amh": ("Amharic", 5341),
    "ara": ("Arabic", 1398),
    "asm": ("Assamese", 1997),
    "aze": ("Azerbaijani", 3442),
    "aze_cyrl": ("Azerbaijani (Cyrillic)", 1898),
    "bel": ("Belarusian", 3605),
    "ben": ("Bengali", 835),
    "bod": ("Tibetan", 1920),
    "bos": ("Bosnian", 2439),
    "bre": ("Breton", 6186),
    "bul": ("Bulgarian", 1635),
    "cat": ("Catalan", 1119),
    "ceb": ("Cebuano", 699),
    "ces": ("Czech", 3706),
    "chi_sim": ("Chinese (Simplified)", 2411),
    "chi_sim_vert": ("Chinese (Simplified, vertical)", 1882),
    "chi_tra": ("Chinese (Traditional)", 2311),
    "chi_tra_vert": ("Chinese (Traditional, vertical)", 1781),
    "chr": ("Cherokee", 366),
    "cos": ("Corsican", 2245),
    "cym": ("Welsh", 2157),
    "dan": ("Danish", 2519),
    "deu": ("German", 1489),
    "deu_latf": ("German (Fraktur)", 6272),
    "div": ("Dhivehi", 1732),
    "dzo": ("Dzongkha", 439),
    "ell": ("Greek", 1386),
    "eng": ("English", 4016),
    "enm": ("English, Middle (1100–1500)", 3028),
    "epo": ("Esperanto", 4617),
    "est": ("Estonian", 4353),
    "eus": ("Basque", 5054),
    "fao": ("Faroese", 3359),
    "fas": ("Persian", 421),
    "fil": ("Filipino", 1798),
    "fin": ("Finnish", 7681),
    "fra": ("French", 1103),
    "frm": ("French, Middle (1400–1600)", 1977),
    "fry": ("Western Frisian", 1861),
    "gla": ("Scottish Gaelic", 2996),
    "gle": ("Irish", 1154),
    "glg": ("Galician", 2494),
    "grc": ("Greek, Ancient", 2193),
    "guj": ("Gujarati", 1385),
    "hat": ("Haitian Creole", 1930),
    "heb": ("Hebrew", 938),
    "hin": ("Hindi", 1096),
    "hrv": ("Croatian", 4007),
    "hun": ("Hungarian", 5172),
    "hye": ("Armenian", 3382),
    "iku": ("Inuktitut", 2736),
    "ind": ("Indonesian", 1096),
    "isl": ("Icelandic", 2225),
    "ita": ("Italian", 2638),
    "ita_old": ("Italian (old)", 3209),
    "jav": ("Javanese", 2912),
    "jpn": ("Japanese", 2413),
    "jpn_vert": ("Japanese (vertical)", 2966),
    "kan": ("Kannada", 3523),
    "kat": ("Georgian", 2465),
    "kat_old": ("Georgian (old)", 413),
    "kaz": ("Kazakh", 4623),
    "khm": ("Khmer", 1413),
    "kir": ("Kyrgyz", 9695),
    "kmr": ("Kurdish (Kurmanji)", 3484),
    "kor": ("Korean", 1638),
    "kor_vert": ("Korean (vertical)", 1087),
    "lao": ("Lao", 6237),
    "lat": ("Latin", 3112),
    "lav": ("Latvian", 2653),
    "lit": ("Lithuanian", 3080),
    "ltz": ("Luxembourgish", 2545),
    "mal": ("Malayalam", 5152),
    "mar": ("Marathi", 2068),
    "mkd": ("Macedonian", 1562),
    "mlt": ("Maltese", 2254),
    "mon": ("Mongolian", 2086),
    "mri": ("Maori", 842),
    "msa": ("Malay", 1706),
    "mya": ("Burmese", 4531),
    "nep": ("Nepali", 979),
    "nld": ("Dutch", 5908),
    "nor": ("Norwegian", 3525),
    "oci": ("Occitan", 6173),
    "ori": ("Odia", 1445),
    "pan": ("Punjabi", 486),
    "pol": ("Polish", 4653),
    "por": ("Portuguese", 1936),
    "pus": ("Pashto", 1730),
    "que": ("Quechua", 4908),
    "ron": ("Romanian", 2320),
    "rus": ("Russian", 3771),
    "san": ("Sanskrit", 12113),
    "sin": ("Sinhala", 1686),
    "slk": ("Slovak", 4323),
    "slv": ("Slovenian", 2933),
    "snd": ("Sindhi", 1654),
    "spa": ("Spanish", 2240),
    "spa_old": ("Spanish (old)", 2826),
    "sqi": ("Albanian", 1830),
    "srp": ("Serbian", 2099),
    "srp_latn": ("Serbian (Latin)", 3204),
    "sun": ("Sundanese", 1337),
    "swa": ("Swahili", 2116),
    "swe": ("Swedish", 4069),
    "syr": ("Syriac", 2155),
    "tam": ("Tamil", 3162),
    "tat": ("Tatar", 1047),
    "tel": ("Telugu", 2704),
    "tgk": ("Tajik", 2541),
    "tha": ("Thai", 1047),
    "tir": ("Tigrinya", 369),
    "ton": ("Tongan", 925),
    "tur": ("Turkish", 4443),
    "uig": ("Uyghur", 2728),
    "ukr": ("Ukrainian", 3735),
    "urd": ("Urdu", 1365),
    "uzb": ("Uzbek", 6319),
    "uzb_cyrl": ("Uzbek (Cyrillic)", 1526),
    "vie": ("Vietnamese", 518),
    "yid": ("Yiddish", 532),
    "yor": ("Yoruba", 940),
}


class LanguageMissingError(EngineError):
    def __init__(self, codes: list[str]) -> None:
        names = ", ".join(LANGUAGES.get(code, (code, 0))[0] for code in codes)
        super().__init__(
            "language_missing", f"The OCR language data is not installed: {names}.", 400
        )
        self.details = {"languages": codes}


# --- Language data folders ------------------------------------------------------


def bundled_dir() -> Path:
    configured = os.environ.get("PDFENGINE_TESSDATA_BUNDLED")
    if configured:
        return Path(configured)
    # Development layout: <project>/engine/pdfengine/ocr.py -> <project>/resources/tessdata
    return Path(__file__).resolve().parents[2] / "resources" / "tessdata"


def user_dir() -> Path | None:
    configured = os.environ.get("PDFENGINE_TESSDATA_DIR")
    return Path(configured) if configured else None


def _codes_in(folder: Path | None) -> set[str]:
    if folder is None or not folder.is_dir():
        return set()
    return {path.name[: -len(SUFFIX)] for path in folder.glob(f"*{SUFFIX}") if path.is_file()}


def list_languages() -> list[dict[str, Any]]:
    bundled = _codes_in(bundled_dir())
    downloaded = _codes_in(user_dir())
    return [
        {
            "code": code,
            "name": name,
            "sizeKb": size,
            "installed": code in bundled or code in downloaded,
            "bundled": code in bundled,
        }
        for code, (name, size) in sorted(LANGUAGES.items(), key=lambda item: item[1][0])
    ]


def _check_code(code: str) -> None:
    if code not in LANGUAGES:
        raise BadRequestError(f"Unknown OCR language '{code}'.")


def tessdata_for(languages: list[str]) -> str:
    """One folder that holds every language in ``languages`` (Tesseract reads
    all of them from one place). Bundled files are copied into the download
    folder when a run mixes bundled and downloaded languages."""
    bundled_folder, downloads = bundled_dir(), user_dir()
    bundled, downloaded = _codes_in(bundled_folder), _codes_in(downloads)
    missing = [code for code in languages if code not in bundled | downloaded]
    if missing:
        raise LanguageMissingError(missing)
    if all(code in bundled for code in languages):
        return str(bundled_folder)
    assert downloads is not None
    for code in languages:
        if code not in downloaded:
            shutil.copyfile(bundled_folder / f"{code}{SUFFIX}", downloads / f"{code}{SUFFIX}")
    return str(downloads)


def remove_language(code: str) -> None:
    _check_code(code)
    folder = user_dir()
    path = folder / f"{code}{SUFFIX}" if folder else None
    if path is None or not path.is_file():
        if code in _codes_in(bundled_dir()):
            raise BadRequestError(f"{LANGUAGES[code][0]} comes with PDFnix and cannot be removed.")
        raise NotFoundError(f"{LANGUAGES[code][0]} is not installed.")
    path.unlink()


# --- Recognition (child process) --------------------------------------------------

_IMAGE_DO = re.compile(rb"/[^\s/<>\[\]()]+\s+Do\b")


def _text_layer_only(ocr: pymupdf.Document) -> None:
    """Removes the page picture from Tesseract's one-page PDF."""
    page = ocr[0]
    for xref in page.get_contents():
        ocr.update_stream(xref, _IMAGE_DO.sub(b"", ocr.xref_stream(xref)))
    ocr.xref_set_key(page.xref, "Resources/XObject", "null")


def page_dpi(page: pymupdf.Page, dpi: int) -> int:
    """``dpi``, lowered for very large pages to stay within ``MAX_PIXELS``."""
    area = (page.rect.width / 72) * (page.rect.height / 72)
    limit = int((MAX_PIXELS / max(area, 1e-6)) ** 0.5)
    return max(MIN_DPI // 2, min(dpi, limit))


def ocr_worker(payload: dict[str, Any], report: Any) -> list[dict[str, Any]]:
    """Child process. ``payload``: ``input``, ``password``, ``pages`` (0-based),
    ``languages``, ``dpi``, ``tessdata``, ``output``. Writes one text-layer page
    per input page to ``output`` and returns ``[{page, words}]`` in order."""
    doc = pymupdf.open(payload["input"])
    if doc.needs_pass:
        doc.authenticate(payload.get("password") or "")
    language = "+".join(payload["languages"])
    out = pymupdf.open()
    results = []
    pages = payload["pages"]
    try:
        for done, index in enumerate(pages):
            report(done / len(pages), f"Recognising page {index + 1} ({done + 1} of {len(pages)})")
            page = doc[index]
            # RGB: with a grey picture MuPDF's OCR writer recognises nothing.
            pixmap = page.get_pixmap(
                dpi=page_dpi(page, payload["dpi"]), colorspace=pymupdf.csRGB, annots=False
            )
            data = pixmap.pdfocr_tobytes(
                compress=True, language=language, tessdata=payload["tessdata"]
            )
            ocr = pymupdf.open(stream=data, filetype="pdf")
            words = len(ocr[0].get_text("words"))
            _text_layer_only(ocr)
            out.insert_pdf(ocr)
            ocr.close()
            results.append({"page": index, "words": words})
        report(1.0, "Writing")
        out.save(payload["output"], garbage=3, deflate=True)
    finally:
        out.close()
        doc.close()
    return results


# --- Job ---------------------------------------------------------------------------


class OcrParams(_Body):
    #: 0-based pages; omit for all.
    pages: list[int] | None = None
    languages: list[str] = Field(default_factory=lambda: ["eng"], min_length=1, max_length=5)
    dpi: int = Field(default=300, ge=MIN_DPI, le=MAX_DPI)
    skip_pages_with_text: bool = True


@dataclass
class OcrPlan:
    params: OcrParams
    pages: list[int]
    tessdata: str


def prepare_ocr(session: Session | None, params: OcrParams) -> OcrPlan:
    assert session is not None
    for code in params.languages:
        _check_code(code)
    tessdata = tessdata_for(params.languages)
    with session.lock:
        count = session.page_count
    pages = sorted(set(params.pages)) if params.pages is not None else list(range(count))
    if not pages:
        raise BadRequestError("No pages were given.")
    bad = [index for index in pages if not 0 <= index < count]
    if bad:
        raise BadRequestError(f"Page index {bad[0]} is out of range (0 to {count - 1}).")
    return OcrPlan(params, pages, tessdata)


def run_ocr(context: JobContext, plan: OcrPlan) -> dict[str, Any]:
    session = context.session
    assert session is not None
    params = plan.params
    folder = tempfile.mkdtemp(prefix="pdfnix-ocr-")
    try:
        context.progress(0.0, "Preparing")
        targets = []
        skipped = 0
        for index in plan.pages:
            context.check()
            with session.lock:
                if params.skip_pages_with_text and has_text(session.doc[index]):
                    skipped += 1
                    continue
            targets.append(index)
        summary = {"pagesProcessed": len(targets), "pagesSkipped": skipped, "wordsFound": 0}
        if not targets:
            return {**summary, "hasTextLayer": session.has_text_layer()}

        source = os.path.join(folder, "input.pdf")
        with session.lock:
            data = session.history.serialise()
            revision = session.revision
        with open(source, "wb") as handle:
            handle.write(data)
        output = os.path.join(folder, "text.pdf")
        results = run_in_process(
            context,
            "pdfengine.ocr:ocr_worker",
            {
                "input": source,
                "password": session.password,
                "pages": targets,
                "languages": params.languages,
                "dpi": params.dpi,
                "tessdata": plan.tessdata,
                "output": output,
            },
            span=(0.03, 0.95),
        )
        context.check()
        context.progress(0.96, "Adding the text to the pages")
        summary["wordsFound"] = sum(item["words"] for item in results)
        layers = pymupdf.open(output)
        try:
            with session.lock:
                if session.revision != revision:
                    raise DocumentChangedError()
                if summary["wordsFound"] == 0:
                    return {**summary, "hasTextLayer": session.has_text_layer()}
                doc = session.doc
                with session.edit("Recognise Text") as step:
                    for position, item in enumerate(results):
                        if item["words"] == 0:
                            continue
                        page = doc[item["page"]]
                        page.show_pdf_page(
                            page.rect * page.derotation_matrix,
                            layers,
                            position,
                            rotate=page.rotation,
                            overlay=True,
                        )
                        step.pages.add(item["page"])
                    doc.Graftmaps.pop(layers._graft_id, None)
                mutation = session.mutated(step.pages)
                return {**summary, **mutation, "hasTextLayer": session.has_text_layer()}
        finally:
            layers.close()
    finally:
        shutil.rmtree(folder, ignore_errors=True)


OCR_JOB = JobType(
    name="ocr",
    params=OcrParams,
    prepare=prepare_ocr,
    run=run_ocr,
    document="required",
    changes_document=True,
)


# --- Downloading a language ---------------------------------------------------------


class LanguageParams(_Body):
    code: str = Field(min_length=2, max_length=20)


def prepare_download(_session: Session | None, params: LanguageParams) -> LanguageParams:
    _check_code(params.code)
    if user_dir() is None:
        raise EngineError("downloads_unavailable", "Language downloads are not set up.", 500)
    return params


def run_download(context: JobContext, params: LanguageParams) -> dict[str, Any]:
    folder = user_dir()
    assert folder is not None
    folder.mkdir(parents=True, exist_ok=True)
    name = LANGUAGES[params.code][0]
    target = folder / f"{params.code}{SUFFIX}"
    temp = folder / f".{params.code}{SUFFIX}.download"
    context.progress(0.0, f"Downloading {name}")
    url = DOWNLOAD_URL.format(code=params.code)
    try:
        with urllib.request.urlopen(url, timeout=30) as response, open(temp, "wb") as handle:
            total = int(response.headers.get("Content-Length") or 0) or (
                LANGUAGES[params.code][1] * 1024
            )
            received = 0
            while True:
                context.check()
                chunk = response.read(64 * 1024)
                if not chunk:
                    break
                handle.write(chunk)
                received += len(chunk)
                context.progress(
                    min(0.99, received / total),
                    f"Downloading {name} ({received // 1024:,} of {total // 1024:,} KB)",
                )
        if received < 1024:
            raise EngineError("download_failed", f"The {name} language data was empty.", 502)
        os.replace(temp, target)
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        reason = getattr(exc, "reason", None) or exc
        raise EngineError(
            "download_failed",
            f"Could not download the {name} language data ({reason}). "
            "Check the internet connection and try again.",
            502,
        ) from None
    finally:
        if temp.exists():
            temp.unlink()
    return {"code": params.code, "name": name, "size": target.stat().st_size}


DOWNLOAD_JOB = JobType(
    name="ocr-language",
    params=LanguageParams,
    prepare=prepare_download,
    run=run_download,
    document="none",
)
