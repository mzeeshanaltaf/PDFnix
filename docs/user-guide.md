# PDFnix user guide

PDFnix opens, annotates, edits and converts PDF files. Everything happens on your computer; files are never uploaded anywhere.

## Installing

Run `PDFnix-<version>-setup.exe`. Windows may warn that the publisher is unknown ("Windows protected your PC"): choose **More info**, then **Run anyway**. The installer asks whether to install for you only (no administrator rights needed) or for everyone on the computer, and on its last page offers a desktop shortcut.

To make PDFnix open PDF files when you double-click them: right-click any PDF → **Open with** → **Choose another app** → **PDFnix** → **Always**. You can also pick it in **Settings → Apps → Default apps**.

## Opening files

- **File → Open** (Ctrl+O), drag files onto the window, double-click a PDF in Explorer, or pick one from **File → Open Recent** or the start page.
- Each document opens in its own tab. Opening a file that is already open switches to its tab.
- Password-protected files ask for their password.

## Reading

- Scroll with the mouse wheel or the arrow keys; Page Up/Down and Space move a screen at a time; Home and End go to the first and last page. Type a page number in the toolbar to jump there.
- Zoom with Ctrl+mouse wheel, Ctrl + and Ctrl −, or the zoom box. Ctrl+1 fits the width, Ctrl+2 fits the whole page, Ctrl+0 is 100 %.
- **View** offers continuous, single-page and two-page layouts. Ctrl+R turns the current page right, Ctrl+Shift+R left.
- F4 shows the side panel: page thumbnails, the document's bookmarks, search and comments.
- **Find** (Ctrl+F) searches the text; Enter or F3 goes to the next result. A scanned document has no text to search until you run **Recognise Text (OCR)**.

## Comments and markup

- Select text, then press **H** (highlight), **U** (underline) or **K** (strikeout), or use the small toolbar that appears over the selection.
- **N** places a sticky note: click on the page and type. Any comment is saved with Ctrl+Enter.
- Click a highlight or note to change its colour, add a comment or delete it. All comments are listed in the Comments panel.
- Every change can be undone (Ctrl+Z) and redone (Ctrl+Y).

## Adding and editing content

- **T** adds a text box, **S** draws rectangles, ellipses, lines and arrows, **D** draws freehand, **I** adds a picture (or paste one with Ctrl+V).
- **E** edits the page's own text: click a paragraph, change it, click elsewhere.
- **X** deletes a paragraph or a picture from the page.
- **Sign** (toolbar) creates a signature or initials (draw, type or upload a scan) and places it. Saved signatures are kept for next time.

## Pages, forms and redaction

- **Document → Organise Pages** (Ctrl+Shift+O) shows all pages: drag to reorder, Delete to remove, right-click to rotate or duplicate. You can also insert pages, extract them to a new file, split a document and merge several.
- Form fields can be filled in directly on the page; Tab moves to the next field. The form bar can reset or flatten the form.
- **Redact** removes text and pictures for good: mark areas (R), or search for words and mark every occurrence, then apply. Once you save, the removed content is gone from the file itself (Undo still works while the document stays open).
- **Watermark** and **Header and Footer** add text, pictures or page numbers to every page.

## Tools

- **Compress** makes files with many pictures smaller (three strengths).
- **Protect with Password** sets a password to open the file and, separately, what others may do with it.
- **Recognise Text (OCR)** makes scanned pages searchable and selectable. English is included; **OCR Languages** downloads others.
- **Convert** saves the PDF as a Word document, pictures or text, makes a PDF from pictures, and turns Word documents into PDFs (this needs Microsoft Word or LibreOffice).
- **Print** (Ctrl+P) prints all pages or a range.

Long jobs show their progress and can be cancelled.

## Saving

- **Save** (Ctrl+S) writes your changes into the file; **Save As** (Ctrl+Shift+S) writes a new file. A dot on the tab means there are unsaved changes.
- When you close a tab or PDFnix with unsaved changes, it asks whether to save them.
- If PDFnix closes unexpectedly, it offers to restore your unsaved changes when it next starts. How often these recovery copies are made is set in Settings.

## Settings

**File → Settings** (Ctrl+,) sets the theme (same as Windows, light or dark), how documents open (zoom and page layout), your name for comments, the default highlight colour, the OCR languages to start with, and how often recovery copies are made.

**Help → Keyboard Shortcuts** (Ctrl+/ or F1) lists every shortcut.

## Uninstalling

Use **Settings → Apps → Installed apps → PDFnix → Uninstall**. The uninstaller asks whether to delete your settings, saved signatures, recovery copies and downloaded OCR languages as well; choose **No** to keep them for a later installation.

## If something goes wrong

- If a file cannot be opened, PDFnix says why (for example, it is not a PDF or it is damaged beyond repair). Slightly damaged files are repaired as they open.
- If the PDF engine stops, PDFnix restarts it by itself and reopens your documents, restoring unsaved changes from the last recovery copy.
- A log for troubleshooting is kept in `%APPDATA%\PDFnix\logs\engine.log`.
