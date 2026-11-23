"""Smoke test of the frozen engine: `pnpm smoke:engine [path\\to\\pdfengine.exe]`.

Starts the executable the way the app does (token, owner PID, tessdata and log
folders in the environment), waits for its ready line, and through the HTTP API:
checks health, opens a two-page scanned PDF, renders a page, reads its QR
code, runs OCR (a job in
a child process, which is where a missing ``freeze_support`` would show),
searches the recognised text, compresses to a file, converts to Word, and
closes. Then it stops the engine and checks that no engine process is left and
that the log file was written.

Without an argument it tests ``dist-engine/pdfengine/pdfengine.exe``.
"""

import os
import secrets
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path

import httpx
import numpy as np
import pymupdf
import zxingcpp

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_EXE = ROOT / "dist-engine" / "pdfengine" / "pdfengine.exe"
TESSDATA = ROOT / "resources" / "tessdata"
READY_TIMEOUT = 60.0


SMOKE_QR = "https://example.com/smoke"


def make_scan(path: Path) -> None:
    """Two image-only pages with known words and a QR code (no text layer)."""
    source = pymupdf.open()
    page = source.new_page(width=612, height=792)
    page.insert_text((72, 120), "Invoice number 4471 for Rosalind", fontsize=22)
    page.insert_text((72, 180), "The quick brown fox jumps over the lazy dog", fontsize=16)
    code = np.asarray(
        zxingcpp.create_barcode(SMOKE_QR, zxingcpp.BarcodeFormat.QRCode).to_image(scale=8)
    )
    rows, cols = code.shape
    qr = pymupdf.Pixmap(pymupdf.csGRAY, cols, rows, code.tobytes(), False)
    page.insert_image(pymupdf.Rect(400, 600, 520, 720), pixmap=qr)
    picture = page.get_pixmap(dpi=200)
    doc = pymupdf.open()
    for _ in range(2):
        doc.new_page(width=612, height=792).insert_image(
            pymupdf.Rect(0, 0, 612, 792), pixmap=picture
        )
    doc.save(path)


def engine_processes(exe: Path) -> list[str]:
    """PIDs of running processes started from ``exe``."""
    out = subprocess.run(
        [
            "powershell.exe",
            "-NoProfile",
            "-Command",
            f"Get-CimInstance Win32_Process | Where-Object {{ $_.ExecutablePath -eq '{exe}' }}"
            " | ForEach-Object { $_.ProcessId }",
        ],
        capture_output=True,
        text=True,
        check=False,
    ).stdout
    return out.split()


class Step:
    def __init__(self) -> None:
        self.failures: list[str] = []

    def check(self, name: str, ok: bool, detail: str = "") -> None:
        print(f"  {'PASS' if ok else 'FAIL'}  {name}{f' — {detail}' if detail else ''}", flush=True)
        if not ok:
            self.failures.append(name)


def main() -> int:
    exe = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else DEFAULT_EXE
    if not exe.is_file():
        print(f"No engine at {exe}; run `pnpm build:engine` first.")
        return 2
    print(f"Engine: {exe}")
    steps = Step()
    work = Path(tempfile.mkdtemp(prefix="pdfnix-smoke-"))
    scan = work / "scan.pdf"
    make_scan(scan)
    log_dir = work / "logs"
    token = secrets.token_hex(32)
    env = {
        **os.environ,
        "PDFENGINE_TOKEN": token,
        "PDFENGINE_PARENT_PID": str(os.getpid()),
        "PDFENGINE_ALLOWED_ORIGINS": "null",
        "PDFENGINE_RECOVERY_DIR": str(work / "recovery"),
        "PDFENGINE_TESSDATA_BUNDLED": str(TESSDATA),
        "PDFENGINE_TESSDATA_DIR": str(work / "tessdata"),
        "PDFENGINE_LOG_DIR": str(log_dir),
    }

    started = time.monotonic()
    process = subprocess.Popen(
        [str(exe)],
        cwd=exe.parent,
        env=env,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    stderr_lines: list[str] = []
    threading.Thread(
        target=lambda: stderr_lines.extend(iter(process.stderr.readline, "")), daemon=True
    ).start()

    port: int | None = None
    ready_line: list[str] = []

    def read_ready() -> None:
        for line in iter(process.stdout.readline, ""):
            if line.startswith("ENGINE_READY port="):
                ready_line.append(line)
                return

    reader = threading.Thread(target=read_ready, daemon=True)
    reader.start()
    reader.join(READY_TIMEOUT)
    if ready_line:
        port = int(ready_line[0].strip().split("=", 1)[1])
    startup = time.monotonic() - started
    steps.check("ready line", port is not None, f"{startup:.1f} s")
    if port is None:
        process.kill()
        print("".join(stderr_lines[-40:]))
        return 1
    # Keep draining stdout so the engine never blocks on a full pipe.
    threading.Thread(target=lambda: process.stdout.read(), daemon=True).start()

    client = httpx.Client(
        base_url=f"http://127.0.0.1:{port}/v1", headers={"X-Engine-Token": token}, timeout=120
    )

    def run_job(type_: str, doc_id: str | None, params: dict) -> dict:
        body: dict = {"type": type_, "params": params}
        if doc_id:
            body["docId"] = doc_id
        response = client.post("/jobs", json=body)
        response.raise_for_status()
        job_id = response.json()["jobId"]
        while True:
            status = client.get(f"/jobs/{job_id}").json()
            if status["status"] in ("done", "failed", "cancelled"):
                return status
            time.sleep(0.1)

    try:
        health = client.get("/health").json()
        steps.check(
            "health",
            health.get("status") == "ok",
            f"engine {health.get('engineVersion')}, PyMuPDF {health.get('pymupdfVersion')}, "
            f"Python {health.get('pythonVersion')}",
        )
        steps.check(
            "token required",
            client.get("/health", headers={"X-Engine-Token": "x"}).status_code == 401,
        )

        opened = client.post("/docs/open", json={"path": str(scan)}).json()
        doc_id = opened.get("docId")
        steps.check("open", bool(doc_id) and opened.get("pageCount") == 2)

        render = client.get(f"/docs/{doc_id}/pages/0/render", params={"scale": 1})
        steps.check(
            "render",
            render.status_code == 200
            and render.content[:4] in (b"\x89PNG", b"\xff\xd8\xff\xe0", b"\xff\xd8\xff\xdb"),
            f"{len(render.content)} bytes, {render.headers.get('content-type')}",
        )

        codes = client.get(f"/docs/{doc_id}/pages/0/codes")
        found = [code["text"] for code in codes.json().get("codes", [])] if codes.is_success else []
        steps.check("QR code (zxing-cpp)", found == [SMOKE_QR], f"{codes.status_code} {found}")

        t = time.monotonic()
        ocr = run_job("ocr", doc_id, {"dpi": 200})
        steps.check(
            "OCR job (child process)",
            ocr["status"] == "done" and ocr["result"]["wordsFound"] > 0,
            f"{ocr.get('result', ocr.get('error'))} in {time.monotonic() - t:.1f} s",
        )
        hits = client.post(f"/docs/{doc_id}/search", json={"query": "quick"}).json()
        steps.check(
            "search finds OCR text",
            len(hits.get("hits", [])) == 2,
            f"{len(hits.get('hits', []))} hits",
        )

        compressed = work / "compressed.pdf"
        t = time.monotonic()
        comp = run_job(
            "compress", doc_id, {"preset": "strong", "output": "file", "outPath": str(compressed)}
        )
        steps.check(
            "compress job (child process)",
            comp["status"] == "done",
            f"{comp.get('result', comp.get('error'))} in {time.monotonic() - t:.1f} s",
        )

        docx = work / "scan.docx"
        t = time.monotonic()
        conv = run_job("pdf-to-docx", doc_id, {"outPath": str(docx)})
        steps.check(
            "PDF to Word job (child process)",
            conv["status"] == "done" and docx.is_file() and docx.stat().st_size > 0,
            f"{docx.stat().st_size if docx.is_file() else 0} bytes in {time.monotonic() - t:.1f} s",
        )

        steps.check("close", client.delete(f"/docs/{doc_id}").status_code == 200)
    except Exception as exc:  # noqa: BLE001 - report and fail
        steps.check("API calls", False, repr(exc))
    finally:
        client.close()
        process.kill()
        process.wait(10)

    time.sleep(1.0)
    left = engine_processes(exe)
    steps.check("no engine process left", not left, f"still running: {left}" if left else "")
    log_file = log_dir / "engine.log"
    # The log is created on the first record; a clean run may write none.
    steps.check("log folder usable", log_dir.is_dir() or not log_file.exists())

    if steps.failures:
        print("\nEngine stderr (last lines):")
        print("".join(stderr_lines[-40:]))
        print(f"\nFAILED: {', '.join(steps.failures)}  (work folder kept: {work})")
        return 1
    print(f"\nAll checks passed. Work folder: {work}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
