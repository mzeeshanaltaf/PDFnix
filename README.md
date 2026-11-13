# PDFnix

A PDF reader and editor for Windows. The app is built with Electron, React and TypeScript, and a bundled Python engine (FastAPI + PyMuPDF) does all the PDF work: it opens documents, renders pages, extracts text and searches.

The project is built in seven phases. Phases 1 (foundation) and 2 (viewer) are complete, so PDFnix is currently a **read-only reader**:

- Open PDFs from the Open dialog, by dragging them onto the window, from the command line, or from the recent-files list. Password-protected files are supported.
- One tab per document. Each tab keeps its own page, zoom, layout, side panel and search.
- Zoom from 10 % to 800 % (Ctrl+wheel, Ctrl +/−/0, fit width, fit page). Continuous, single-page and two-page layouts. Rotate one page or all pages.
- Select and copy text. Search with match case and whole word; hits are highlighted on the pages.
- Page thumbnails, the document outline, and a properties dialog.

Annotations and saving arrive in phase 3. The full plan is in [docs/plan](docs/plan), and the current state is in [docs/plan/STATUS.md](docs/plan/STATUS.md).

## Requirements

- Windows 10 or 11 (x64)
- [Node.js](https://nodejs.org/) 24 and [pnpm](https://pnpm.io/) 10
- [Python](https://www.python.org/) 3.12 and [uv](https://docs.astral.sh/uv/)
- Git

## Getting started

Clone the repository and install the app's dependencies:

```powershell
git clone https://github.com/mzeeshanaltaf/PDFnix.git
cd PDFnix
pnpm install
```

Install the engine's Python environment:

```powershell
uv sync --directory engine
```

Skipping this step also works: the first start runs `uv`, which creates the environment itself. That first start then takes a minute or two.

## Running the application

```powershell
pnpm dev
```

This starts the app in development mode with hot reload. The app starts the Python engine itself; you never start it by hand. When the status bar at the bottom right reads **Engine connected**, open a PDF with **Open PDF…**, Ctrl+O, or by dropping a file onto the window.

To open a file on start, run the app with its path. To get a production build that runs without the development server:

```powershell
pnpm build
node_modules\electron\dist\electron.exe . "C:\path\to\document.pdf"
```

Only one copy of PDFnix runs at a time. Starting it again with a file path opens that file in the window that is already open.

> **Running from a terminal inside VS Code?** VS Code's terminal (and tools running in it) can set `ELECTRON_RUN_AS_NODE=1`, which makes Electron start as plain Node. The app then fails with `Cannot read properties of undefined (reading 'isPackaged')`. Clear the variable first:
>
> ```powershell
> Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
> pnpm dev
> ```

Development keeps its settings (theme and recent files) in `%APPDATA%\PDFnix-dev`.

## Keyboard shortcuts

| Action                   | Keys                                              |
| ------------------------ | ------------------------------------------------- |
| Open                     | Ctrl+O                                            |
| Close tab                | Ctrl+W, or middle-click the tab                   |
| Next / previous tab      | Ctrl+Tab / Ctrl+Shift+Tab                         |
| Find                     | Ctrl+F; then Enter / Shift+Enter or F3 / Shift+F3 |
| Zoom in / out / 100 %    | Ctrl + / Ctrl − / Ctrl+0, or Ctrl+mouse wheel     |
| Fit width / fit page     | Ctrl+1 / Ctrl+2                                   |
| Rotate page right / left | Ctrl+R / Ctrl+Shift+R                             |
| Next / previous page     | → / ←                                             |
| First / last page        | Home / End                                        |
| Side panel               | F4                                                |
| Document properties      | Ctrl+D                                            |

## Development commands

Run these from the project root.

| Purpose                           | Command            |
| --------------------------------- | ------------------ |
| Run the app in development        | `pnpm dev`         |
| App tests (Vitest)                | `pnpm test`        |
| Engine tests (pytest)             | `pnpm test:engine` |
| Lint (ESLint and ruff)            | `pnpm lint`        |
| Type-check                        | `pnpm typecheck`   |
| Format (Prettier and ruff format) | `pnpm format`      |
| Production build of the app code  | `pnpm build`       |

Building an installer is set up in phase 7.

## Project layout

```
src/
  main/       Electron main process: window, menu, engine lifecycle, files, recent files
  preload/    The small typed bridge exposed to the page as window.api
  shared/     Types and IPC channel names shared by main, preload and renderer
  renderer/   React UI: shell, viewer, side panels, dialogs, state stores
engine/
  pdfengine/  The Python engine: HTTP API, sessions, rendering, text, search, pages
  tests/      Engine tests
docs/plan/    The phase plans and STATUS.md
```

The engine listens only on `127.0.0.1`, on a random port. It accepts requests only with a token generated for each launch, and it exits when the app does.

## Licence

PDFnix uses PyMuPDF/MuPDF, which are licensed under the AGPL. The project is intended for personal and internal use.
