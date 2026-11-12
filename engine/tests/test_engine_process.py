"""Start the real engine process and check its launch contract."""

import os
import re
import subprocess
import sys
import threading
from pathlib import Path

import httpx
import pytest

from pdfengine.server import TOKEN_HEADER
from pdfengine.watchdog import start_parent_watchdog

ENGINE_DIR = Path(__file__).resolve().parents[1]
TOKEN = "process-test-token"
READY = re.compile(r"^ENGINE_READY port=(\d+)$")


def _spawn(extra_env: dict[str, str]) -> subprocess.Popen:
    env = {**os.environ, "PDFENGINE_TOKEN": TOKEN, **extra_env}
    return subprocess.Popen(
        [sys.executable, "-m", "pdfengine"],
        cwd=ENGINE_DIR,
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )


def _read_ready_port(process: subprocess.Popen, timeout: float = 30.0) -> int:
    result: list[str] = []
    reader = threading.Thread(target=lambda: result.append(process.stdout.readline()), daemon=True)
    reader.start()
    reader.join(timeout)
    assert result, "engine did not print a ready line in time"
    match = READY.match(result[0].strip())
    assert match, f"unexpected first stdout line: {result[0]!r}"
    return int(match.group(1))


def test_engine_announces_port_and_serves_health():
    process = _spawn({"PDFENGINE_PARENT_PID": str(os.getpid())})
    try:
        port = _read_ready_port(process)
        base = f"http://127.0.0.1:{port}"

        ok = httpx.get(f"{base}/v1/health", headers={TOKEN_HEADER: TOKEN}, timeout=10)
        assert ok.status_code == 200
        assert ok.json()["status"] == "ok"

        denied = httpx.get(f"{base}/v1/health", timeout=10)
        assert denied.status_code == 401
    finally:
        process.kill()
        process.wait(timeout=10)


def test_engine_exits_when_owner_process_disappears():
    # A stand-in "owner" that we can end at will.
    owner = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(120)"])
    process = _spawn({"PDFENGINE_PARENT_PID": str(owner.pid)})
    try:
        _read_ready_port(process)
        assert process.poll() is None

        owner.kill()
        owner.wait(timeout=10)

        process.wait(timeout=10)
        assert process.returncode == 0
    finally:
        if owner.poll() is None:
            owner.kill()
        if process.poll() is None:
            process.kill()
            process.wait(timeout=10)


def test_engine_refuses_to_start_without_token():
    env = {k: v for k, v in os.environ.items() if k != "PDFENGINE_TOKEN"}
    result = subprocess.run(
        [sys.executable, "-m", "pdfengine"],
        cwd=ENGINE_DIR,
        env=env,
        capture_output=True,
        text=True,
        timeout=30,
    )

    assert result.returncode == 2
    assert "PDFENGINE_TOKEN" in result.stderr
    assert result.stdout == ""


def test_watchdog_fires_for_a_process_that_is_already_gone():
    finished = subprocess.Popen([sys.executable, "-c", "pass"])
    finished.wait(timeout=10)
    fired = threading.Event()

    start_parent_watchdog(finished.pid, on_exit=fired.set)

    assert fired.wait(timeout=10)


@pytest.mark.parametrize("header", [TOKEN_HEADER.lower(), TOKEN_HEADER.upper()])
def test_token_header_is_case_insensitive(client, header):
    from .conftest import TEST_TOKEN

    response = client.get("/v1/health", headers={header: TEST_TOKEN})

    assert response.status_code == 200
