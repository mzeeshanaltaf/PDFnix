# Phase 6 — Processing Jobs

**Goal:** the heavier whole-document operations: compress, password-protect, OCR, convert PDF to Word and other formats, and print. This phase introduces background jobs with progress and cancel.

**Depends on:** phases 1–5.

## Scope

Included: job framework; compression presets; add, change and remove password protection with permissions; OCR with language management; PDF → Word (.docx); PDF → images; PDF → text; images → PDF; Word → PDF when a converter is installed; printing.

Not included: batch processing of folders; PDF → Excel/PowerPoint.

## Job framework

Engine module `jobs.py`.

| Endpoint | Purpose |
|---|---|
| `POST /v1/jobs` `{ type, docId?, params }` | Start a job; returns `{ jobId }` |
| `GET /v1/jobs/{jobId}` | `{ status: "queued" \| "running" \| "done" \| "failed" \| "cancelled", progress: 0..1, message, result?, error? }` |
| `POST /v1/jobs/{jobId}/cancel` | Request cancellation; jobs check the flag between pages |

- Jobs run in worker threads, or in a separate process for work that would otherwise block rendering for long (OCR, Word conversion).
- A job that changes the open document works on a copy and swaps it in at the end as a single undo step, so cancelling or failing leaves the document untouched.
- A job that produces a file writes to a temporary name and renames on success.
- Renderer: one `JobProgress` dialog component (title, progress bar, current step, Cancel) and a `useJob` hook that polls about twice a second. On completion: a toast with "Open file" / "Show in folder".

## Compress

Engine module `compress.py`. Job type `compress` `{ preset, outPath? }`.

| Preset | Image handling | Other |
|---|---|---|
| Light | Recompress only, high quality | Clean-up only |
| Balanced | Downsample to about 150 dpi, medium JPEG quality | Subset fonts |
| Strong | Downsample to about 96 dpi, lower quality, optional greyscale | Subset fonts, drop thumbnails and unused objects |

- Images: PyMuPDF's image rewriting (`doc.rewrite_images`) for downsampling and recompression. Confirm its availability and parameters in the pinned version; if it is missing, fall back to replacing images one by one via `page.replace_image`.
- Structure: `doc.subset_fonts()`, then save with `garbage=4, deflate=True` and object streams enabled.
- The dialog shows the current size and, after the job, the new size and percentage saved. If the result is not smaller, say so and keep the original.
- Output choice: replace the open document (undoable, saved on the next Save) or write a separate file.

## Protect

Engine module `security.py`.

| Endpoint | Purpose |
|---|---|
| `POST /v1/docs/{id}/security` `{ userPassword?, ownerPassword?, permissions: { print, copy, modify, annotate, fillForms } }` | Set protection to be applied on save |
| `DELETE /v1/docs/{id}/security` | Remove protection on save (requires that the document was opened with sufficient rights) |
| `GET /v1/docs/{id}/security` | Current and pending state |

- Encryption is AES-256 (`save(encryption=PDF_ENCRYPT_AES_256, user_pw=…, owner_pw=…, permissions=…)`).
- "Password to open" (user password) and "password to change permissions" (owner password) are separate fields; if only an open password is given, the owner password is set to the same value.
- Dialog: password with confirmation, show/hide, a strength hint, permission checkboxes, and a plain note that permission restrictions are honoured by PDF readers by convention, while the open password genuinely encrypts the file.
- Passwords are held in memory only for the session, never logged, never written to settings.

## OCR

Engine module `ocr.py`. Job type `ocr` `{ pages, languages, dpi, skipPagesWithText }`.

- Uses the Tesseract engine built into PyMuPDF; only language data files are needed, pointed to by `TESSDATA_PREFIX` (or the `tessdata` argument).
- Per page: run `page.get_textpage_ocr(language=…, dpi=…, full=True)`, read the recognised words with their boxes, then write each word onto the page as **invisible text** (text render mode 3) scaled to its box. The page keeps its exact appearance and becomes searchable and selectable.
- Pages that already have a real text layer are skipped by default.
- After the job, `hasTextLayer` is refreshed, and the search panel's "needs OCR" hint from phase 2 now has an action button that opens this dialog.
- **Languages:** English data is bundled in `resources/tessdata`. `dialogs/OcrLanguages` lists other languages and downloads their data files on demand from the official tessdata repository into the app-data folder. Several languages can be combined for one run.
- Accuracy note in the dialog: results depend on scan quality; 300 dpi is the default.

## Convert

Engine module `convert.py`. All are jobs that write new files.

| Job type | Method |
|---|---|
| `pdf-to-docx` `{ pages, outPath }` | `pdf2docx` (`Converter(...).convert(...)`), run in a separate process |
| `pdf-to-images` `{ pages, format: png \| jpg, dpi, outDir }` | `page.get_pixmap` per page |
| `pdf-to-text` `{ pages, outPath, layout }` | `page.get_text` |
| `images-to-pdf` `{ inputs, pageSize, margin, outPath }` | Each image becomes a page (`fitz.open(image).convert_to_pdf()` or `insert_image` on a sized page) |
| `docx-to-pdf` `{ input, outPath }` | Microsoft Word through COM automation if installed; otherwise LibreOffice (`soffice --headless --convert-to pdf`) if found; otherwise the menu entry is disabled with an explanation |

- `pdf2docx` depends on specific PyMuPDF versions. Pin a compatible pair in `pyproject.toml` at the start of this phase and run the whole engine test suite against it, since this may constrain the PyMuPDF version used by earlier phases. Checking this compatibility early (a short spike during phase 1 or 2) avoids a late surprise. **Spike done in phase 1 (2026-11-12):** `pdf2docx` 0.5.13 installs alongside PyMuPDF 2.1 without a resolver conflict and converted a two-page test PDF correctly. It imports PyMuPDF through the legacy `fitz` name, which PyMuPDF 2.1 reports as deprecated ("will be removed in future"), so re-run the conversion tests whenever PyMuPDF is upgraded and pin both packages together.
- If the PDF has no text layer, the Word dialog recommends running OCR first and offers to do so.
- The dialog sets expectations: text, headings, simple tables and images convert well; complex multi-column or heavily designed layouts will need manual clean-up in Word.

## Print

- Main process, using the `pdf-to-printer` package (it bundles SumatraPDF for silent printing on Windows).
- The current document state is written to a temporary file by the engine and sent to the printer; the temp file is removed afterwards.
- `dialogs/Print`: printer list with the default preselected, page range, copies, orientation, fit-to-page or actual size, colour or monochrome, duplex where the printer supports it.
- Ctrl+P opens the dialog.

## Tests

Engine: job lifecycle (progress increases, done, failed with a readable error, cancel leaves the document unchanged); compress output is smaller for an image-heavy fixture, opens, and keeps page count and text; a protected file cannot be opened without the password, opens with it, and reports the chosen permissions; removing protection yields an unencrypted file; OCR on a generated image-only page with known text finds those words at roughly the right place and the page image is unchanged; pages with text are skipped; `pdf-to-docx` output opens with `python-docx` and contains the source text; image export produces the right number of files at the right pixel size; images-to-PDF page count; converter detection logic for Word and LibreOffice.

Renderer: `useJob` polling and cancellation; password dialog validation; page-range input.

## Verification

- Compress a scan-heavy PDF with each preset and compare size and visual quality.
- Protect a file, reopen it here and in Adobe Reader with the password; confirm copy/print restrictions show up there. Then remove the password.
- OCR a scanned multi-page document, then search for and copy text from it. Add a second language and OCR a document in that language.
- Convert a report with headings, a table and images to Word and open it in Word.
- Export pages as PNG; build a PDF from several photos.
- Print a page range to a real printer and to "Microsoft Print to PDF".
- Cancel a long OCR job midway and confirm the document is unchanged.

## Done when

Every operation above completes with visible progress, can be cancelled safely, and tests pass.
