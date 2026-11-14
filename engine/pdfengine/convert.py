"""Conversions. Every one is a job that writes new files; none changes the
open document.

| Job type | Method |
|---|---|
| ``pdf-to-docx {pages?, outPath}`` | ``pdf2docx`` in a child process |
| ``pdf-to-images {pages?, format, dpi, outDir, overwrite}`` | ``page.get_pixmap`` per page |
| ``pdf-to-text {pages?, outPath, layout}`` | the page content's text |
| ``images-to-pdf {inputs, pageSize, orientation, margin, outPath}`` | one page per picture |
| ``docx-to-pdf {input, outPath}`` | Microsoft Word (COM, through PowerShell), else LibreOffice |

Files are written under temporary names next to their targets and renamed
when complete; a cancelled or failed job leaves nothing behind (several files
are all renamed at the end).

``pdf2docx`` 0.5.13 is pinned together with PyMuPDF (STATUS.md): it imports
PyMuPDF under the old ``fitz`` name; re-run ``test_convert.py`` on any upgrade
of either.
"""

import contextlib
import logging
import os
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Literal

import pymupdf
from pydantic import Field

from .api import _Body
from .errors import BadRequestError, EngineError, FileNotFound
from .jobs import JobCancelled, JobContext, JobType
from .pages import FilesExistError
from .save import check_target, commit_temp, discard_temp, reserve_temp, write_document
from .sessions import MUPDF_LOCK, Session
from .textpages import content_text_page
from .worker import run_in_process

# --- Shared helpers ------------------------------------------------------------


def _pages(session: Session, pages: list[int] | None) -> list[int]:
    with session.lock:
        count = session.page_count
    if pages is None:
        return list(range(count))
    if not pages:
        raise BadRequestError("No pages were given.")
    bad = [index for index in pages if not 0 <= index < count]
    if bad:
        raise BadRequestError(f"Page index {bad[0]} is out of range (0 to {count - 1}).")
    return sorted(set(pages))


def _target(out_path: str, session: Session | None = None) -> str:
    target = os.path.abspath(out_path)
    if session is not None and os.path.normcase(target) == os.path.normcase(session.path):
        raise BadRequestError("Choose a different file than the open document.")
    check_target(target)
    return target


def _written(target: str, size: int, **extra: Any) -> dict[str, Any]:
    return {"path": target, "fileName": os.path.basename(target), "size": size, **extra}


def _snapshot(session: Session, folder: str) -> str:
    """The document as it is now, in a file for a child process."""
    path = os.path.join(folder, "input.pdf")
    with session.lock:
        data = session.history.serialise()
    with open(path, "wb") as handle:
        handle.write(data)
    return path


# --- PDF to Word ----------------------------------------------------------------

_PHASES = {"[3/4]": (0.05, 0.6, "Reading page"), "[4/4]": (0.6, 0.98, "Writing page")}
_PAGE = re.compile(r"\((\d+)/(\d+)\) Page \d+")


class _ProgressLog(logging.Handler):
    """Turns pdf2docx's log lines into progress reports."""

    def __init__(self, report: Callable[..., None]) -> None:
        super().__init__(logging.INFO)
        self.report = report
        self.phase = (0.0, 0.05, "Opening")
        self.failed_pages: list[str] = []

    def emit(self, record: logging.LogRecord) -> None:
        text = record.getMessage()
        for marker, phase in _PHASES.items():
            if marker in text:
                self.phase = phase
                self.report(phase[0], f"{phase[2]}s")
                return
        match = _PAGE.search(text)
        if match:
            done, total = int(match.group(1)), int(match.group(2))
            low, high, label = self.phase
            self.report(low + (high - low) * done / max(total, 1), f"{label} {done} of {total}")
        elif record.levelno >= logging.ERROR and "Ignore page" in text:
            self.failed_pages.append(text)


def docx_worker(payload: dict[str, Any], report: Any) -> dict[str, Any]:
    """Child process: converts ``input`` to Word at ``output``."""
    import warnings

    warnings.filterwarnings("ignore", category=DeprecationWarning)
    from pdf2docx import Converter

    handler = _ProgressLog(report)
    root = logging.getLogger()
    root.addHandler(handler)
    root.setLevel(logging.INFO)
    converter = Converter(payload["input"], password=payload.get("password"))
    try:
        converter.convert(payload["output"], pages=payload["pages"])
    finally:
        converter.close()
        root.removeHandler(handler)
    return {"failedPages": len(handler.failed_pages)}


class DocxParams(_Body):
    pages: list[int] | None = None
    out_path: str = Field(min_length=1)


@dataclass
class DocxPlan:
    pages: list[int]
    target: str


def prepare_docx(session: Session | None, params: DocxParams) -> DocxPlan:
    assert session is not None
    return DocxPlan(_pages(session, params.pages), _target(params.out_path, session))


def run_docx(context: JobContext, plan: DocxPlan) -> dict[str, Any]:
    session = context.session
    assert session is not None
    folder = tempfile.mkdtemp(prefix="pdfnix-docx-")
    temp = reserve_temp(plan.target)
    try:
        context.progress(0.0, "Preparing")
        source = _snapshot(session, folder)
        result = run_in_process(
            context,
            "pdfengine.convert:docx_worker",
            {
                "input": source,
                "password": session.password,
                "pages": plan.pages,
                "output": temp,
            },
            span=(0.02, 0.99),
        )
        size = commit_temp(temp, plan.target)
        temp = None
        return _written(plan.target, size, pageCount=len(plan.pages), **result)
    finally:
        discard_temp(temp)
        shutil.rmtree(folder, ignore_errors=True)


DOCX_JOB = JobType("pdf-to-docx", DocxParams, run_docx, prepare_docx)


# --- PDF to images --------------------------------------------------------------

#: Largest picture written per page (pixels).
MAX_IMAGE_PIXELS = 150_000_000


class ImagesParams(_Body):
    pages: list[int] | None = None
    format: Literal["png", "jpg"] = "png"
    dpi: int = Field(default=150, ge=36, le=600)
    out_dir: str = Field(min_length=1)
    overwrite: bool = False


@dataclass
class ImagesPlan:
    params: ImagesParams
    pages: list[int]
    targets: list[str]


def image_file_names(stem: str, pages: list[int], page_count: int, extension: str) -> list[str]:
    """``<stem>-<page>.<ext>`` with page numbers padded to the same width."""
    width = len(str(page_count))
    return [f"{stem}-{index + 1:0{width}d}.{extension}" for index in pages]


def prepare_images(session: Session | None, params: ImagesParams) -> ImagesPlan:
    assert session is not None
    pages = _pages(session, params.pages)
    folder = os.path.abspath(params.out_dir)
    if not os.path.isdir(folder):
        raise EngineError("folder_not_found", f"The folder does not exist: {folder}", 404)
    with session.lock:
        count = session.page_count
        for index in pages:
            rect = session.doc[index].rect
            pixels = rect.width * rect.height * (params.dpi / 72) ** 2
            if pixels > MAX_IMAGE_PIXELS:
                raise BadRequestError(
                    f"Page {index + 1} would be too large at {params.dpi} dpi. "
                    "Choose a lower resolution."
                )
    stem = os.path.splitext(os.path.basename(session.path))[0]
    names = image_file_names(stem, pages, count, params.format)
    targets = [os.path.join(folder, name) for name in names]
    existing = [path for path in targets if os.path.exists(path)]
    if existing and not params.overwrite:
        raise FilesExistError(existing)
    return ImagesPlan(params, pages, targets)


def run_images(context: JobContext, plan: ImagesPlan) -> dict[str, Any]:
    session = context.session
    assert session is not None
    params = plan.params
    temps: list[str] = []
    try:
        for done, (index, target) in enumerate(zip(plan.pages, plan.targets, strict=True)):
            context.check()
            context.progress(
                done / len(plan.pages), f"Page {index + 1} ({done + 1} of {len(plan.pages)})"
            )
            with session.lock:
                pixmap = session.doc[index].get_pixmap(dpi=params.dpi, alpha=False)
            if params.format == "png":
                data = pixmap.tobytes("png")
            else:
                data = pixmap.tobytes("jpeg", jpg_quality=90)
            del pixmap
            temp = reserve_temp(target, suffix=".pdfnix-tmp")
            temps.append(temp)
            with open(temp, "wb") as handle:
                handle.write(data)
        context.check()
        files = []
        for temp, target in zip(temps, plan.targets, strict=True):
            size = commit_temp(temp, target)
            files.append(_written(target, size))
        temps = []
        return {"files": files, "folder": os.path.dirname(plan.targets[0])}
    finally:
        for temp in temps:
            discard_temp(temp)


IMAGES_JOB = JobType("pdf-to-images", ImagesParams, run_images, prepare_images)


# --- PDF to text ----------------------------------------------------------------


class TextParams(_Body):
    pages: list[int] | None = None
    out_path: str = Field(min_length=1)
    #: Order the text by its position on the page (columns, reading order)
    #: rather than as stored.
    layout: bool = True


@dataclass
class TextPlan:
    params: TextParams
    pages: list[int]
    target: str


def prepare_text(session: Session | None, params: TextParams) -> TextPlan:
    assert session is not None
    return TextPlan(params, _pages(session, params.pages), _target(params.out_path, session))


def run_text(context: JobContext, plan: TextPlan) -> dict[str, Any]:
    session = context.session
    assert session is not None
    flags = pymupdf.TEXT_PRESERVE_WHITESPACE | pymupdf.TEXT_MEDIABOX_CLIP
    parts = []
    for done, index in enumerate(plan.pages):
        context.check()
        context.progress(done / len(plan.pages), f"Page {index + 1}")
        with session.lock:
            page = session.doc[index]
            text = content_text_page(page, flags, derotate=False).extractText(
                sort=plan.params.layout
            )
        parts.append(text.strip("\n"))
    temp = reserve_temp(plan.target)
    try:
        with open(temp, "w", encoding="utf-8", newline="\r\n") as handle:
            handle.write("\n\n".join(parts) + "\n")
        size = commit_temp(temp, plan.target)
        temp = None
    finally:
        discard_temp(temp)
    return _written(plan.target, size, pageCount=len(plan.pages))


TEXT_JOB = JobType("pdf-to-text", TextParams, run_text, prepare_text)


# --- Images to PDF --------------------------------------------------------------

#: Page sizes in points (portrait).
PAGE_SIZES = {"a4": (595.0, 842.0), "letter": (612.0, 792.0)}
#: "image" pages: the picture's shape with its longer side this long (A4 height).
IMAGE_PAGE_LONG_SIDE = 842.0


class ImagesToPdfParams(_Body):
    inputs: list[str] = Field(min_length=1, max_length=2000)
    page_size: Literal["image", "a4", "letter"] = "a4"
    orientation: Literal["auto", "portrait", "landscape"] = "auto"
    #: Space around each picture, in points.
    margin: float = Field(default=36, ge=0, le=144)
    out_path: str = Field(min_length=1)


@dataclass
class ImagesToPdfPlan:
    params: ImagesToPdfParams
    inputs: list[str]
    target: str


def prepare_images_to_pdf(_session: Session | None, params: ImagesToPdfParams) -> ImagesToPdfPlan:
    inputs = [os.path.abspath(path) for path in params.inputs]
    for path in inputs:
        if not os.path.isfile(path):
            raise FileNotFound(path)
    return ImagesToPdfPlan(params, inputs, _target(params.out_path))


def page_layout(
    image_size: tuple[float, float], params: ImagesToPdfParams
) -> tuple[pymupdf.Rect, pymupdf.Rect]:
    """The page and where the picture goes on it (kept in proportion)."""
    width, height = image_size
    margin = params.margin
    if params.page_size == "image":
        scale = (IMAGE_PAGE_LONG_SIDE - 2 * margin) / max(width, height)
        page = pymupdf.Rect(0, 0, width * scale + 2 * margin, height * scale + 2 * margin)
    else:
        short, long = PAGE_SIZES[params.page_size]
        landscape = params.orientation == "landscape" or (
            params.orientation == "auto" and width > height
        )
        page = pymupdf.Rect(0, 0, long, short) if landscape else pymupdf.Rect(0, 0, short, long)
    box = pymupdf.Rect(margin, margin, page.width - margin, page.height - margin)
    scale = min(box.width / width, box.height / height)
    w, h = width * scale, height * scale
    x = box.x0 + (box.width - w) / 2
    y = box.y0 + (box.height - h) / 2
    return page, pymupdf.Rect(x, y, x + w, y + h)


def _picture_pages(path: str) -> pymupdf.Document:
    """The picture file as a PDF, one page per picture (a TIFF may hold
    several), upright as photo viewers show it: MuPDF's image documents apply
    the EXIF orientation, and JPEGs are embedded without re-encoding."""
    name = os.path.basename(path)
    try:
        image = pymupdf.open(path)
    except Exception:
        image = None
    if image is None or image.is_pdf or image.page_count < 1:
        raise EngineError(
            "unsupported_image",
            f"{name} is not a picture PDFnix can read (PNG, JPEG, TIFF, BMP and GIF work).",
            415,
        )
    try:
        return pymupdf.open(stream=image.convert_to_pdf(), filetype="pdf")
    finally:
        image.close()


def run_images_to_pdf(context: JobContext, plan: ImagesToPdfPlan) -> dict[str, Any]:
    params = plan.params
    with MUPDF_LOCK:
        doc = pymupdf.open()
    try:
        for done, path in enumerate(plan.inputs):
            context.check()
            context.progress(
                done / len(plan.inputs) * 0.9,
                f"Adding {os.path.basename(path)} ({done + 1} of {len(plan.inputs)})",
            )
            with MUPDF_LOCK:
                pictures = _picture_pages(path)
                try:
                    for picture in pictures:
                        size = (picture.rect.width, picture.rect.height)
                        page_rect, image_rect = page_layout(size, params)
                        page = doc.new_page(width=page_rect.width, height=page_rect.height)
                        page.show_pdf_page(image_rect, pictures, picture.number)
                    doc.Graftmaps.pop(pictures._graft_id, None)
                finally:
                    pictures.close()
        context.check()
        context.progress(0.92, "Writing")
        with MUPDF_LOCK:
            pages = doc.page_count
            size = write_document(doc, plan.target)
    finally:
        with MUPDF_LOCK:
            doc.close()
    return _written(plan.target, size, pageCount=pages)


IMAGES_TO_PDF_JOB = JobType(
    "images-to-pdf", ImagesToPdfParams, run_images_to_pdf, prepare_images_to_pdf, document="none"
)


# --- Word to PDF ----------------------------------------------------------------

WORD_EXTENSIONS = {".doc", ".docx", ".docm", ".dot", ".dotx", ".rtf", ".odt"}
#: Seconds a conversion may take before it is given up.
CONVERT_TIMEOUT = 300.0


def _registry_key_exists(root: str, path: str) -> bool:
    if sys.platform != "win32":
        return False
    import winreg

    hive = {"HKCR": winreg.HKEY_CLASSES_ROOT, "HKLM": winreg.HKEY_LOCAL_MACHINE}[root]
    try:
        with winreg.OpenKey(hive, path):
            return True
    except OSError:
        return False


def _registry_value(root: str, path: str, name: str) -> str | None:
    if sys.platform != "win32":
        return None
    import winreg

    hive = {"HKCR": winreg.HKEY_CLASSES_ROOT, "HKLM": winreg.HKEY_LOCAL_MACHINE}[root]
    try:
        with winreg.OpenKey(hive, path) as key:
            value, _ = winreg.QueryValueEx(key, name)
            return str(value)
    except OSError:
        return None


@dataclass
class Probe:
    """How converters are looked for; replaced in tests."""

    key_exists: Callable[[str, str], bool] = _registry_key_exists
    value: Callable[[str, str, str], str | None] = _registry_value
    is_file: Callable[[str], bool] = os.path.isfile
    which: Callable[[str], str | None] = shutil.which
    environ: Any = field(default_factory=lambda: os.environ)


def find_libreoffice(probe: Probe) -> str | None:
    candidates = []
    found = probe.which("soffice")
    if found:
        candidates.append(found)
    for variable in ("ProgramFiles", "ProgramFiles(x86)", "ProgramW6432"):
        base = probe.environ.get(variable)
        if base:
            candidates.append(os.path.join(base, "LibreOffice", "program", "soffice.exe"))
    install = probe.value("HKLM", r"SOFTWARE\LibreOffice\UNO\InstallPath", "")
    if install:
        candidates.append(os.path.join(install, "soffice.exe"))
    for candidate in candidates:
        if probe.is_file(candidate):
            return candidate
    return None


def detect_converters(probe: Probe | None = None) -> dict[str, Any]:
    """Which Word-to-PDF converter can be used: Microsoft Word (through COM)
    first, LibreOffice second."""
    probe = probe or Probe()
    word = probe.key_exists("HKCR", r"Word.Application\CLSID")
    libreoffice = find_libreoffice(probe)
    using = "word" if word else "libreoffice" if libreoffice else None
    return {"word": word, "libreOffice": libreoffice is not None, "using": using}


_WORD_SCRIPT = r"""
$ErrorActionPreference = 'Stop'
$before = @(Get-Process WINWORD -ErrorAction SilentlyContinue | ForEach-Object { $_.Id })
$word = New-Object -ComObject Word.Application
$after = @(Get-Process WINWORD -ErrorAction SilentlyContinue | ForEach-Object { $_.Id })
$new = @($after | Where-Object { $before -notcontains $_ })
[Console]::Out.WriteLine('PID ' + ($new -join ','))
[Console]::Out.Flush()
try {
  $word.Visible = $false
  $word.DisplayAlerts = 0
  # A dummy password makes Word fail instead of asking for one.
  $doc = $word.Documents.Open($env:PDFNIX_INPUT, $false, $true, $false, 'pdfnix-no-password')
  try {
    [Console]::Out.WriteLine('CONVERTING')
    [Console]::Out.Flush()
    $doc.ExportAsFixedFormat($env:PDFNIX_OUTPUT, 17)
  } finally {
    $doc.Close(0)
  }
} finally {
  $word.Quit()
  [void][Runtime.InteropServices.Marshal]::ReleaseComObject($word)
}
"""

_NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)


def _kill(pids: list[int]) -> None:
    for pid in pids:
        with contextlib.suppress(Exception):
            subprocess.run(
                ["taskkill", "/F", "/T", "/PID", str(pid)],
                capture_output=True,
                creationflags=_NO_WINDOW,
                timeout=10,
            )


def _run_converter(
    context: JobContext, command: list[str], env: dict[str, str], name: str, tool: str
) -> None:
    """Runs a converter process, following its ``PID``/``CONVERTING`` lines,
    killing it (and the Word it started) when cancelled or too slow."""
    process = subprocess.Popen(
        command,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        env=env,
        creationflags=_NO_WINDOW,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    helpers: list[int] = []
    lines: list[str] = []

    def read() -> None:
        assert process.stdout is not None
        for line in process.stdout:
            lines.append(line.strip())

    reader = threading.Thread(target=read, daemon=True)
    reader.start()
    started = time.monotonic()
    try:
        while process.poll() is None:
            for line in list(lines):
                if line.startswith("PID "):
                    helpers = [int(pid) for pid in line[4:].split(",") if pid.strip().isdigit()]
                    context.progress(0.3, f"Converting with {tool}")
                elif line == "CONVERTING":
                    context.progress(0.5, f"Converting with {tool}")
            if context.cancelled:
                raise JobCancelled()
            if time.monotonic() - started > CONVERT_TIMEOUT:
                raise EngineError(
                    "conversion_failed", f"{tool} took too long to convert {name}.", 504
                )
            time.sleep(0.2)
    except BaseException:
        _kill([process.pid, *helpers])
        raise
    reader.join(2)
    if process.returncode != 0:
        assert process.stderr is not None
        error = process.stderr.read().strip()
        detail = _last_error_line(error)
        raise EngineError(
            "conversion_failed",
            f"{tool} could not convert {name}" + (f": {detail}" if detail else "."),
            422,
        )


def _last_error_line(text: str) -> str:
    for line in text.splitlines():
        line = line.strip()
        if line and not line.startswith(("At line:", "+", "At ", "CategoryInfo")):
            return line[:300]
    return ""


class DocxToPdfParams(_Body):
    input: str = Field(min_length=1)
    out_path: str = Field(min_length=1)


@dataclass
class DocxToPdfPlan:
    source: str
    target: str
    converter: str


def prepare_docx_to_pdf(_session: Session | None, params: DocxToPdfParams) -> DocxToPdfPlan:
    source = os.path.abspath(params.input)
    if not os.path.isfile(source):
        raise FileNotFound(source)
    if os.path.splitext(source)[1].lower() not in WORD_EXTENSIONS:
        raise BadRequestError(f"{os.path.basename(source)} is not a Word document.")
    converters = detect_converters()
    if converters["using"] is None:
        raise EngineError(
            "converter_missing",
            "Converting Word documents needs Microsoft Word or LibreOffice, and neither was found.",
            501,
        )
    return DocxToPdfPlan(source, _target(params.out_path), converters["using"])


def run_docx_to_pdf(context: JobContext, plan: DocxToPdfPlan) -> dict[str, Any]:
    name = os.path.basename(plan.source)
    temp = reserve_temp(plan.target, suffix=".pdf")
    folder = tempfile.mkdtemp(prefix="pdfnix-word-")
    try:
        context.progress(0.05, "Starting the converter")
        env = dict(os.environ)
        # Converters write into the job's own folder (Word leaves scratch files
        # beside its output when it is stopped); the result is then moved next
        # to the target and renamed into place.
        if plan.converter == "word":
            produced = os.path.join(folder, "word-output.pdf")
            env["PDFNIX_INPUT"] = plan.source
            env["PDFNIX_OUTPUT"] = produced
            command = [
                "powershell.exe",
                "-NoProfile",
                "-NonInteractive",
                "-ExecutionPolicy",
                "Bypass",
                "-Command",
                _WORD_SCRIPT,
            ]
            _run_converter(context, command, env, name, "Microsoft Word")
        else:
            soffice = find_libreoffice(Probe())
            assert soffice is not None
            # Its own profile, so a LibreOffice the user has open does not interfere.
            profile = Path(folder, "profile").as_uri()
            command = [
                soffice,
                "--headless",
                "--norestore",
                f"-env:UserInstallation={profile}",
                "--convert-to",
                "pdf",
                "--outdir",
                folder,
                plan.source,
            ]
            _run_converter(context, command, env, name, "LibreOffice")
            produced = os.path.join(folder, os.path.splitext(name)[0] + ".pdf")
        if not os.path.isfile(produced):
            raise EngineError("conversion_failed", f"No PDF was produced from {name}.", 422)
        shutil.move(produced, temp)
        context.check()
        if not os.path.isfile(temp) or os.path.getsize(temp) == 0:
            raise EngineError("conversion_failed", f"No PDF was produced from {name}.", 422)
        with MUPDF_LOCK:
            check = pymupdf.open(temp)
            pages = check.page_count
            check.close()
        size = commit_temp(temp, plan.target)
        temp = None
        return _written(plan.target, size, pageCount=pages, converter=plan.converter)
    finally:
        discard_temp(temp)
        shutil.rmtree(folder, ignore_errors=True)


DOCX_TO_PDF_JOB = JobType(
    "docx-to-pdf", DocxToPdfParams, run_docx_to_pdf, prepare_docx_to_pdf, document="none"
)

CONVERT_JOBS = [DOCX_JOB, IMAGES_JOB, TEXT_JOB, IMAGES_TO_PDF_JOB, DOCX_TO_PDF_JOB]
