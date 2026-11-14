"""Compress: smaller files by recompressing images, subsetting fonts and
writing compactly. Job type ``compress`` with ``{ preset, grayscale?, output,
outPath? }``.

The work runs in a child process on a copy (``compress_worker``). With
``output: "replace"`` the changed objects are then applied to the open document
as one undoable step "Compress" (``swap.py``), saved with the next Save; with
``output: "file"`` the compacted copy is written to ``outPath`` and the open
document is untouched. If the result is not smaller, nothing changes and the
result says so.

Presets (docs/plan/phase-6-processing-jobs.md):

========  ===========================================  =====================
Preset    Images                                       Other
========  ===========================================  =====================
light     re-encode as JPEG at quality 85, only if     clean-up only
          that is smaller; no downsampling
balanced  downsample above 225 dpi to 150 dpi, JPEG 70  subset fonts
strong    downsample above 120 dpi to 96 dpi, JPEG 50;  subset fonts, drop
          optional greyscale                            thumbnails
========  ===========================================  =====================

Unused objects are dropped by the compacting save (``garbage=4``). Black and
white images (scans stored as fax/JBIG2) are left alone: they are already small
and downsampling hurts legibility. Downsampling is bicubic, which reaches the
target resolution exactly (MuPDF's averaging only halves).
"""

import os
import shutil
import tempfile
from dataclasses import dataclass
from typing import Any, Literal

import pymupdf
from pydantic import Field
from pymupdf import mupdf

from .api import _Body
from .errors import BadRequestError
from .jobs import JobContext, JobType
from .save import SAVE_OPTIONS, check_target, commit_temp, discard_temp, reserve_temp
from .sessions import Session
from .swap import ObjectSnapshot, apply_objects
from .worker import run_in_process

Preset = Literal["light", "balanced", "strong"]


@dataclass(frozen=True)
class PresetSettings:
    #: Images above this resolution are downsampled; None keeps the size.
    threshold_dpi: int | None
    target_dpi: int
    quality: int
    subset_fonts: bool
    drop_thumbnails: bool


PRESETS: dict[str, PresetSettings] = {
    "light": PresetSettings(None, 0, 85, subset_fonts=False, drop_thumbnails=False),
    "balanced": PresetSettings(225, 150, 70, subset_fonts=True, drop_thumbnails=False),
    "strong": PresetSettings(120, 96, 50, subset_fonts=True, drop_thumbnails=True),
}

#: Save options for a compressed file written separately (``garbage=4`` also
#: merges duplicate objects). Replacing the open document is measured with the
#: options Save uses (``SAVE_OPTIONS``).
COMPACT = {**SAVE_OPTIONS, "garbage": 4}

#: The result must be at least this much smaller to count.
MIN_GAIN = 0.01


def image_options(settings: PresetSettings) -> mupdf.PdfImageRewriterOptions:
    opts = mupdf.PdfImageRewriterOptions()
    opts.recompress_when = mupdf.FZ_RECOMPRESS_WHEN_SMALLER
    quality = str(settings.quality)
    for kind in ("color_lossless", "color_lossy", "gray_lossless", "gray_lossy"):
        setattr(opts, f"{kind}_image_recompress_method", mupdf.FZ_RECOMPRESS_JPEG)
        setattr(opts, f"{kind}_image_recompress_quality", quality)
        if settings.threshold_dpi:
            setattr(opts, f"{kind}_image_subsample_method", mupdf.FZ_SUBSAMPLE_BICUBIC)
            setattr(opts, f"{kind}_image_subsample_threshold", settings.threshold_dpi)
            setattr(opts, f"{kind}_image_subsample_to", settings.target_dpi)
    return opts


def plain_gray_images(doc: pymupdf.Document) -> int:
    """Points grey images with an ICC profile at plain ``/DeviceGray``.

    MuPDF 1.28.6's image rewriter mishandles them: it writes a three-channel
    JPEG but keeps the one-channel ICC colour space, and the picture renders as
    stripes (STATUS.md, Verified facts). Greyscale conversion (``recolor``)
    produces exactly such images. DeviceGray looks the same and is rewritten
    correctly. Returns how many images were changed."""
    changed = 0
    for xref in range(1, doc.xref_length()):
        if doc.xref_get_key(xref, "Subtype")[1] != "/Image":
            continue
        kind, value = doc.xref_get_key(xref, "ColorSpace")
        if kind == "xref":
            space = doc.xref_object(int(value.split()[0]), compressed=True)
        elif kind == "array":
            space = value
        else:
            continue
        parts = space.strip("[]").split()
        if (
            len(parts) >= 2
            and parts[0] == "/ICCBased"
            and parts[1].isdigit()
            and doc.xref_get_key(int(parts[1]), "N")[1] == "1"
        ):
            doc.xref_set_key(xref, "ColorSpace", "/DeviceGray")
            changed += 1
    return changed


def _open(path: str, password: str | None) -> pymupdf.Document:
    doc = pymupdf.open(path)
    if doc.needs_pass and not doc.authenticate(password or ""):
        doc.close()
        raise BadRequestError("The document's password is needed.")
    return doc


def _saved_size(path: str, password: str | None, **options: Any) -> int:
    """Size of the document at ``path`` written with ``options`` (on a
    throwaway copy: compacting renumbers objects)."""
    doc = _open(path, password)
    try:
        return len(doc.tobytes(encryption=pymupdf.PDF_ENCRYPT_KEEP, **options))
    finally:
        doc.close()


def compress_worker(payload: dict[str, Any], report: Any) -> dict[str, Any]:
    """Child process. ``payload``: ``input`` (the document, as serialised),
    ``password``, ``preset``, ``grayscale``, ``mode`` ("replace" or "file"),
    ``output`` (where to write: the processed copy for "replace", the final
    compacted file's temporary name for "file")."""
    settings = PRESETS[payload["preset"]]
    password = payload.get("password")
    report(0.02, "Measuring the document")
    original_size = _saved_size(payload["input"], password, **SAVE_OPTIONS)

    doc = _open(payload["input"], password)
    try:
        snapshot = ObjectSnapshot(doc) if payload["mode"] == "replace" else None
        if payload.get("grayscale"):
            for index in range(doc.page_count):
                report(0.05 + 0.25 * index / doc.page_count, "Converting to greyscale")
                doc.load_page(index).recolor(1)
        report(0.3, "Recompressing images")
        plain_gray_images(doc)
        mupdf.pdf_rewrite_images(pymupdf._as_pdf_document(doc), image_options(settings))
        if settings.subset_fonts:
            report(0.6, "Subsetting fonts")
            doc.subset_fonts()
        if settings.drop_thumbnails:
            for page in doc:
                if doc.xref_get_key(page.xref, "Thumb")[0] != "null":
                    doc.xref_set_key(page.xref, "Thumb", "null")
        report(0.75, "Writing")
        if payload["mode"] == "replace":
            changed = snapshot.changed(doc) if snapshot else []
            doc.save(payload["output"], encryption=pymupdf.PDF_ENCRYPT_KEEP)
            new_size = _saved_size(payload["output"], password, **SAVE_OPTIONS)
        else:
            changed = []
            doc.save(payload["output"], encryption=pymupdf.PDF_ENCRYPT_KEEP, **COMPACT)
            new_size = os.path.getsize(payload["output"])
    finally:
        doc.close()
    report(1.0, "Done")
    return {"changed": changed, "originalSize": original_size, "newSize": new_size}


# --- Job ------------------------------------------------------------------------


class CompressParams(_Body):
    preset: Preset = "balanced"
    #: Strong only: convert colours to grey as well.
    grayscale: bool = False
    #: "replace" changes the open document (undoable); "file" writes ``outPath``.
    output: Literal["replace", "file"] = "replace"
    out_path: str | None = Field(default=None, min_length=1)


@dataclass
class CompressPlan:
    params: CompressParams
    target: str | None


def prepare_compress(session: Session | None, params: CompressParams) -> CompressPlan:
    assert session is not None
    if params.grayscale and params.preset != "strong":
        raise BadRequestError("Greyscale is part of the Strong preset only.")
    target = None
    if params.output == "file":
        if not params.out_path:
            raise BadRequestError("outPath is needed to write a separate file.")
        target = os.path.abspath(params.out_path)
        if os.path.normcase(target) == os.path.normcase(session.path):
            raise BadRequestError(
                "Choose a different file than the open document, or replace the open document."
            )
        check_target(target)
    return CompressPlan(params, target)


def write_snapshot(session: Session, path: str) -> int:
    """Writes the document as it is now (serialised, encryption kept) to
    ``path`` and returns its revision."""
    with session.lock:
        data = session.history.serialise()
        revision = session.revision
    with open(path, "wb") as handle:
        handle.write(data)
    return revision


def run_compress(context: JobContext, plan: CompressPlan) -> dict[str, Any]:
    session = context.session
    assert session is not None
    params = plan.params
    folder = tempfile.mkdtemp(prefix="pdfnix-compress-")
    final_temp: str | None = None
    try:
        context.progress(0.0, "Preparing")
        source = os.path.join(folder, "input.pdf")
        revision = write_snapshot(session, source)
        if plan.target:
            final_temp = reserve_temp(plan.target)
            output = final_temp
        else:
            output = os.path.join(folder, "output.pdf")
        result = run_in_process(
            context,
            "pdfengine.compress:compress_worker",
            {
                "input": source,
                "password": session.password,
                "preset": params.preset,
                "grayscale": params.grayscale,
                "mode": params.output,
                "output": output,
            },
            span=(0.02, 0.9),
        )
        original, new = result["originalSize"], result["newSize"]
        smaller = new <= original * (1 - MIN_GAIN)
        if params.output == "replace" and not result["changed"]:
            smaller = False
        summary = {
            "smaller": smaller,
            "originalSize": original,
            "newSize": new,
            "output": params.output,
        }
        if not smaller:
            return summary
        context.check()
        context.progress(0.92, "Applying")
        if plan.target:
            assert final_temp is not None
            size = commit_temp(final_temp, plan.target)
            final_temp = None
            return {
                **summary,
                "path": plan.target,
                "fileName": os.path.basename(plan.target),
                "size": size,
            }
        with session.lock:
            processed = pymupdf.open(output)
            try:
                if processed.needs_pass:
                    processed.authenticate(session.password or "")
                mutation = apply_objects(
                    session, processed, result["changed"], "Compress", expected_revision=revision
                )
            finally:
                processed.close()
        return {**summary, **mutation}
    finally:
        discard_temp(final_temp)
        shutil.rmtree(folder, ignore_errors=True)


COMPRESS_JOB = JobType(
    name="compress",
    params=CompressParams,
    prepare=prepare_compress,
    run=run_compress,
    document="required",
    changes_document=True,
)
