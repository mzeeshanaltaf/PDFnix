"""Writes resources/licenses/THIRD-PARTY-NOTICES.txt:
`uv run --directory engine python ../scripts/collect_licenses.py` (part of `pnpm dist`).

Collects the licence of everything the installed app contains:
- the engine's Python packages (the runtime dependency closure of the engine,
  minus what pdfengine.spec excludes) and Python itself,
- the app's production npm packages (`pnpm licenses list --prod`),
- files bundled as they are: SumatraPDF (printing), Tesseract language data,
  the handwriting fonts for typed signatures.
Electron's and Chromium's notices are written by electron-builder next to
PDFnix.exe (LICENSE.electron.txt, LICENSES.chromium.html).
"""

import importlib.metadata as metadata
import json
import re
import subprocess
import sys
from pathlib import Path

from packaging.requirements import Requirement

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "resources" / "licenses" / "THIRD-PARTY-NOTICES.txt"

# Kept in step with the dependencies in engine/pyproject.toml.
ENGINE_ROOTS = ["fastapi", "numpy", "pdf2docx", "pymupdf", "uvicorn", "zxing-cpp"]
# Kept in step with the excludes in engine/pdfengine.spec.
EXCLUDED = {
    "pymupdf4llm",
    "pymupdf-layout",
    "onnxruntime",
    "networkx",
    "psutil",
    "pyyaml",
    "tabulate",
    "fire",
    "termcolor",
}
LICENSE_FILE = re.compile(r"^(LICEN[CS]E|COPYING|NOTICE)", re.IGNORECASE)
RULE = "=" * 78

HEADER = """PDFnix — third-party notices

PDFnix is built from the open-source components listed below. Each is
distributed under its own licence, reproduced in full in this file.

Licence note on PyMuPDF and MuPDF
  The PDF engine uses PyMuPDF and MuPDF (Artifex Software), which are licensed
  under the GNU Affero General Public License v3 (AGPL-3.0), or commercially.
  SumatraPDF (used for printing) is GPL-3.0.
  This build of PDFnix is for personal and internal use. If it is ever
  distributed to others, the AGPL/GPL obligations (offering the complete
  corresponding source) or a commercial MuPDF licence must be revisited first.

Electron and Chromium
  Their notices are in LICENSE.electron.txt and LICENSES.chromium.html in the
  PDFnix program folder.
"""


def normalise(name: str) -> str:
    return re.sub(r"[-_.]+", "-", name).lower()


def licence_name(dist: metadata.Distribution) -> str:
    meta = dist.metadata
    expression = meta.get("License-Expression")
    if expression:
        return expression
    classifiers = [
        c.split("::")[-1].strip()
        for c in meta.get_all("Classifier") or []
        if c.startswith("License ::")
    ]
    if classifiers:
        return "; ".join(classifiers)
    text = (meta.get("License") or "").strip()
    return text.splitlines()[0][:80] if text else "see licence text"


def python_closure() -> list[metadata.Distribution]:
    seen: dict[str, metadata.Distribution] = {}
    queue = list(ENGINE_ROOTS)
    while queue:
        name = normalise(queue.pop())
        if name in seen or name in EXCLUDED:
            continue
        try:
            dist = metadata.distribution(name)
        except metadata.PackageNotFoundError:
            continue
        seen[name] = dist
        for raw in dist.requires or []:
            requirement = Requirement(raw)
            marker = requirement.marker
            if marker is not None and ("extra" in str(marker) or not marker.evaluate()):
                continue
            queue.append(requirement.name)
    return sorted(seen.values(), key=lambda d: normalise(d.metadata["Name"]))


def python_licence_texts(dist: metadata.Distribution) -> list[tuple[str, str]]:
    texts = []
    for file in dist.files or []:
        if LICENSE_FILE.match(Path(str(file)).name):
            path = Path(str(dist.locate_file(file)))
            if path.is_file():
                texts.append((str(file), path.read_text(encoding="utf-8", errors="replace")))
    return texts


def node_packages() -> list[dict]:
    output = subprocess.run(
        "pnpm licenses list --prod --json",
        cwd=ROOT,
        capture_output=True,
        text=True,
        encoding="utf-8",
        shell=True,
        check=True,
    ).stdout
    packages = []
    for licence, entries in json.loads(output).items():
        for entry in entries:
            if entry["name"].startswith("@types/"):
                continue  # type declarations, not shipped
            packages.append({**entry, "license": licence})
    return sorted(packages, key=lambda p: p["name"])


def node_licence_texts(package: dict) -> list[tuple[str, str]]:
    texts = []
    for folder in package.get("paths", []):
        for path in sorted(Path(folder).iterdir()):
            if path.is_file() and LICENSE_FILE.match(path.name):
                texts.append((path.name, path.read_text(encoding="utf-8", errors="replace")))
        if texts:
            break
    return texts


def section(title: str, licence: str, texts: list[tuple[str, str]], note: str = "") -> str:
    parts = [RULE, title, f"Licence: {licence}"]
    if note:
        parts.append(note)
    parts.append(RULE)
    if not texts:
        parts.append("(No licence file is included in the package; see the licence named above.)")
    for name, text in texts:
        parts.append(f"--- {name} ---")
        parts.append(text.strip())
    return "\n".join(parts) + "\n\n"


def gpl3_text() -> str:
    """The GNU GPL v3 text, taken from numpy's licence file (which carries it
    for the GCC runtime inside OpenBLAS)."""
    text = metadata.distribution("numpy").read_text("licenses/LICENSE.txt") or ""
    lines = text.splitlines()
    for index, line in enumerate(lines[:-1]):
        if line.strip() == "GNU GENERAL PUBLIC LICENSE" and "29 June 2007" in lines[index + 1]:
            return "\n".join(lines[index:])
    raise SystemExit("GPL-3.0 text not found in numpy's licence file")


def bundled_sections() -> list[str]:
    sections = []
    sections.append(
        section(
            "SumatraPDF 3.4.6 (printing; bundled by pdf-to-printer)",
            "GPL-3.0",
            [("GNU General Public License v3", gpl3_text())],
            "Copyright Krzysztof Kowalczyk and contributors. Source code:\n"
            "https://github.com/sumatrapdfreader/sumatrapdf (tag 3.4.6).",
        )
    )
    tessdata = ROOT / "resources" / "tessdata" / "LICENSE"
    sections.append(
        section(
            "Tesseract OCR language data (tessdata_fast, eng.traineddata)",
            "Apache-2.0",
            [("LICENSE", tessdata.read_text(encoding="utf-8"))] if tessdata.is_file() else [],
            "https://github.com/tesseract-ocr/tessdata_fast. Languages downloaded later come\n"
            "from the same repository under the same licence.",
        )
    )
    fonts = ROOT / "src" / "renderer" / "src" / "assets" / "fonts"
    for licence in sorted(fonts.glob("OFL-*.txt")):
        family = licence.stem.removeprefix("OFL-").replace("-", " ")
        sections.append(
            section(
                f"{family} font (typed signatures)",
                "SIL Open Font License 1.1",
                [(licence.name, licence.read_text(encoding="utf-8"))],
            )
        )
    python_licence = Path(sys.base_prefix) / "LICENSE.txt"
    sections.append(
        section(
            f"Python {sys.version.split()[0]} (engine runtime)",
            "PSF-2.0",
            [("LICENSE.txt", python_licence.read_text(encoding="utf-8"))]
            if python_licence.is_file()
            else [],
        )
    )
    return sections


def main() -> None:
    out: list[str] = [HEADER, "\nContents\n"]
    sections: list[str] = []

    dists = python_closure()
    out.append("\nPDF engine (Python packages):\n")
    for dist in dists:
        name, version = dist.metadata["Name"], dist.version
        licence = licence_name(dist)
        out.append(f"  {name} {version} — {licence}\n")
        sections.append(section(f"{name} {version} (engine)", licence, python_licence_texts(dist)))

    packages = node_packages()
    out.append("\nApplication (npm packages):\n")
    for package in packages:
        version = ", ".join(package["versions"])
        out.append(f"  {package['name']} {version} — {package['license']}\n")
        sections.append(
            section(
                f"{package['name']} {version} (app)",
                package["license"],
                node_licence_texts(package),
            )
        )

    extra = bundled_sections()
    out.append("\nBundled files:\n")
    for text in extra:
        out.append(f"  {text.splitlines()[1]}\n")
    out.append("\n\n")

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(
        "".join(out) + "".join(extra) + "".join(sections), encoding="utf-8", newline="\r\n"
    )
    print(
        f"{OUT.relative_to(ROOT)}: {len(dists)} Python packages, {len(packages)} npm packages, "
        f"{len(extra)} bundled items, {OUT.stat().st_size:,} bytes"
    )


if __name__ == "__main__":
    main()
