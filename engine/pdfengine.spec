# PyInstaller spec for the frozen engine: `pnpm build:engine`
# (uv run --group build pyinstaller pdfengine.spec ... from engine/).
#
# One-folder build (faster start-up than one-file, friendlier to antivirus),
# windowed (no console): dist-engine/pdfengine/pdfengine.exe at the project
# root. The app ships that folder as resources/engine.

import os

from PyInstaller.utils.hooks import collect_submodules

block_cipher = None

ENGINE_DIR = os.path.abspath(SPECPATH)  # noqa: F821 - provided by PyInstaller

hiddenimports = [
    # Job children import their target by name (worker.py: "module:function").
    "pdfengine.ocr",
    "pdfengine.compress",
    "pdfengine.convert",
    # Imported on first use by the codes route (keeps numpy out of the start).
    "pdfengine.codes",
    # uvicorn picks its loop, protocol and lifespan implementations at run time.
    *collect_submodules("uvicorn"),
]

excludes = [
    # Hard dependencies of PyMuPDF 2.1 that the engine never imports
    # (checked against sys.modules after importing every engine module).
    "pymupdf.layout",
    "pymupdf4llm",
    "onnxruntime",
    "networkx",
    "psutil",
    "yaml",
    "tabulate",
    # pdf2docx's command line only.
    "fire",
    "termcolor",
    # Development and GUI toolkits that hooks may drag in.
    "tkinter",
    "PIL",
    "matplotlib",
    "IPython",
    "pytest",
    "_pytest",
    "pygments",
    "setuptools",
    "pkg_resources",
]

# Files that come with collected packages but are never used.
DROP_BINARIES = (
    "opencv_videoio_ffmpeg",  # cv2's video I/O; pdf2docx only works on images
)
DROP_DATA_PREFIXES = (
    os.path.join("pymupdf", "mupdf-devel"),  # C headers and import libraries
    os.path.join("pymupdf", "layout"),
)

a = Analysis(  # noqa: F821
    [os.path.join(ENGINE_DIR, "engine_entry.py")],
    pathex=[ENGINE_DIR],
    binaries=[],
    datas=[],
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=excludes,
    noarchive=False,
)

a.binaries = [
    entry for entry in a.binaries if not any(part in entry[0] for part in DROP_BINARIES)
]
a.datas = [
    entry
    for entry in a.datas
    if not any(os.path.normpath(entry[0]).startswith(prefix) for prefix in DROP_DATA_PREFIXES)
]

pyz = PYZ(a.pure)  # noqa: F821

exe = EXE(  # noqa: F821
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="pdfengine",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=False,
    disable_windowed_traceback=True,
    icon=os.path.join(ENGINE_DIR, "..", "build", "icon.ico"),
)

coll = COLLECT(  # noqa: F821
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=False,
    name="pdfengine",
)
