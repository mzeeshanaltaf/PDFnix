# Phase 7 — Packaging and Release

**Goal:** a Windows installer that sets the app up on a clean machine with no Node or Python present, registers it for `.pdf` files, and has been tested end to end.

**Depends on:** phases 1–6.

## Scope

Included: freezing the Python engine, the Electron installer, file association, app identity (name, icon, version), end-to-end tests, performance and robustness pass, user-facing polish, a short user guide.

Not included: auto-update, code signing with a purchased certificate, Microsoft Store distribution.

## Tasks

### 1. Freeze the engine

- Build `engine/` with PyInstaller in **one-folder** mode (faster start-up than one-file and friendlier to antivirus) into `dist-engine/pdfengine/pdfengine.exe`.
- Write a `pdfengine.spec` that collects the data files and hidden imports the libraries need (PyMuPDF, `pdf2docx` and its dependencies such as OpenCV and `python-docx`, uvicorn's workers).
- Run without a console window; log to a rotating file in the app-data folder.
- Note from phase 1: PyMuPDF 2.1 declares hard dependencies on `pymupdf-layout`, `pymupdf4llm`, `onnxruntime`, `numpy`, `networkx`, `psutil`, `pyyaml` and `tabulate`. The engine does not use them, but they are installed with it. Exclude what the engine never imports from the frozen build (PyInstaller `excludes`) and measure the result; the size estimate below assumed PyMuPDF alone.
- Note from phase 1: the engine watches the PID in `PDFENGINE_PARENT_PID` (set by main), which keeps working when the engine is a frozen executable. A page loaded from `file://` sends the origin `null`, and main already passes that as the allowed CORS origin when no dev server is in use.
- Note from phase 6: OCR, Compress and PDF → Word run in **child processes** (`multiprocessing`, `spawn`; `pdfengine/worker.py`). A frozen engine must call `multiprocessing.freeze_support()` first thing in `__main__.main()`, or each child starts a second engine. The children import their target by module name (`pdfengine.ocr`, `pdfengine.compress`, `pdfengine.convert`): list these as hidden imports. `pdf2docx` 0.5.13 brings `opencv-python-headless` 5.0 (large), `fonttools`, `lxml`, `python-docx`, `fire`, `termcolor`; measure the frozen size with them. Word → PDF starts `powershell.exe` (COM automation of Word); nothing to bundle.
- Script: `pnpm build:engine`.
- Smoke-test the frozen engine on its own: start it, call health, open a PDF, render a page, run OCR (this exercises the child process), compress, convert to Word.

### 2. Package the app

- `electron-builder.yml`:
  - `extraResources`: the frozen engine folder → `resources/engine`; `resources/tessdata` → `resources/tessdata` (phase 6: `eng.traineddata` from `tessdata_fast` and its Apache-2.0 `LICENSE`; main passes `process.resourcesPath/tessdata` as `PDFENGINE_TESSDATA_BUNDLED` when packaged, and downloads go to `<userData>/tessdata`).
  - `asarUnpack` for `node_modules/pdf-to-printer/dist/*.exe` (phase 6): printing runs the SumatraPDF 3.4.6 that `pdf-to-printer` bundles, which cannot run from inside the asar archive; `pdf-to-printer` itself rewrites the path to `app.asar.unpacked`. SumatraPDF is GPLv3; add its notice to the About dialog. (Phase 4 bundles no engine fonts: text uses MuPDF's built-in fonts. The four handwriting fonts for typed signatures are renderer assets in `src/renderer/src/assets/fonts/`, bundled by Vite, with their `OFL-*.txt` licences beside them; include those licences in the About dialog's notices.)
  - Target: NSIS installer, x64; per-user install by default with the option to install for all users; Start-menu and optional desktop shortcut; uninstaller that leaves user data unless asked.
  - `fileAssociations` for `.pdf` so the app appears under "Open with" and can be chosen as the default.
- `src/main/engine.ts` uses the packaged path when `app.isPackaged`.
- Resource paths (tessdata) are passed to the engine through environment variables so the same code runs in development and production.
- Script: `pnpm dist` runs lint, type-check, tests, `build:engine`, then electron-builder.

### 3. App identity

- Product name is **PDFnix**, `appId` `com.pdfnix.app`. Confirm both are used consistently in `package.json`, `electron-builder.yml`, the window title, the installer and the About dialog.
- Application icon (`.ico` with sizes 16–256) and a document icon for associated PDF files. Until then `build/icon.ico`, `build/icon.png` and `resources/icon.png` are the electron-vite template's placeholder icons and must be replaced here.
- About dialog: version, engine and PyMuPDF versions, and open-source licence notices. PyMuPDF/MuPDF are AGPL; this build is for personal/internal use, and the notices record that so the question is revisited if distribution plans change.

### 4. File opening from Windows

- Double-clicking a PDF, "Open with", and dragging a file onto the app icon all pass the path as an argument; the single-instance hand-off from phase 2 opens it as a new tab in the running window.
- Jump list / taskbar recent files via `app.addRecentDocument`.

### 5. End-to-end tests

Playwright driving the Electron app (`tests/e2e/`), against the development build and at least a smoke subset against the packaged build:

- Launch, open a sample PDF, scroll, zoom, rotate, search.
- Highlight text, add a comment, undo, redo, save, reopen and verify.
- Add text, place a signature, save.
- Reorder pages, fill a form, apply a redaction.
- Run compress, protect, OCR and PDF → Word once each.
- Close with unsaved changes and exercise each choice in the prompt.

### 6. Performance and robustness

- Cold-start time: show the window immediately with a brief "starting engine" state rather than waiting for the engine.
- Large files (1,000+ pages, 500 MB+): memory stays bounded by the render cache limits; thumbnail rendering is throttled.
- Malformed and unusual PDFs: collect a small corpus (damaged cross-reference tables, unusual page sizes, right-to-left text, heavy vector drawings, portfolios) and confirm the app shows a clear message instead of crashing.
- Engine crash during an operation: the app reports it, restarts the engine and offers the recovery copy.
- High-DPI and multi-monitor: crisp rendering when a window moves between displays with different scaling.

### 7. Polish

- Keyboard shortcut reference (Help → Keyboard Shortcuts) and a consistent set across tools.
- Accessibility: keyboard reachability of toolbars and dialogs, visible focus, sufficient contrast in both themes, labels on icon buttons.
- Empty, loading and error states for every panel and dialog.
- Settings dialog gathering options introduced across the phases: theme, default zoom and layout, author name, default highlight colour, OCR languages, recovery interval.
- `README.md` with developer setup and build steps; a short user guide in `docs/`.

## Verification

- On a **clean Windows 11 machine or virtual machine** with no Node, Python, Word or LibreOffice installed: run the installer, launch from the Start menu, and run through every feature group. Word → PDF should be disabled with its explanation.
- Set the app as the default for `.pdf` and double-click several files; they open as tabs in one window.
- Uninstall and confirm the program files are removed.
- Installer size and installed size are recorded (expected around 250 MB installed because of the two runtimes; measured in phase 7: ~530 MB unpacked, since Electron 44 alone is ~370 MB and pdf2docx brings OpenCV — see STATUS.md, Deviations).
- Windows SmartScreen will warn about an unsigned installer; this is expected for a personal build and is noted in the README.
- The full automated suite (engine, renderer, end-to-end) passes on the packaged build's smoke subset.

## Done when

A single installer file produces a working, file-associated app on a clean machine, and the complete test pass is green.
