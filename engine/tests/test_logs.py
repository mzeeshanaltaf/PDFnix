"""The engine's log: stderr plus a rotating file in the app's log folder."""

import logging
import sys
import threading

import pytest

from pdfengine import logs


@pytest.fixture
def clean_logging():
    """configure() changes process-wide state; put it back afterwards."""
    root = logging.getLogger()
    handlers, level = root.handlers[:], root.level
    engine_level = logs.logger.level
    hooks = (sys.excepthook, threading.excepthook)
    streams = (sys.stdout, sys.stderr)
    yield
    for handler in root.handlers[:]:
        if handler not in handlers:
            root.removeHandler(handler)
            handler.close()
    root.setLevel(level)
    logs.logger.setLevel(engine_level)
    sys.excepthook, threading.excepthook = hooks
    sys.stdout, sys.stderr = streams


def test_records_go_to_the_log_file(tmp_path, clean_logging):
    path = logs.configure(str(tmp_path / "logs"))
    assert path == str(tmp_path / "logs" / logs.LOG_FILE)
    logs.logger.warning("something to remember")
    logging.getLogger("uvicorn.error").error("server trouble")
    logging.getLogger("other").info("chatter")  # below the root level
    for handler in logging.getLogger().handlers:
        handler.flush()
    text = (tmp_path / "logs" / logs.LOG_FILE).read_text(encoding="utf-8")
    assert "WARNING pdfengine: something to remember" in text
    assert "ERROR uvicorn.error: server trouble" in text
    assert "chatter" not in text


def test_unhandled_thread_errors_are_logged(tmp_path, clean_logging):
    logs.configure(str(tmp_path))

    def fail() -> None:
        raise RuntimeError("boom in a thread")

    thread = threading.Thread(target=fail, name="worker-x")
    thread.start()
    thread.join()
    for handler in logging.getLogger().handlers:
        handler.flush()
    text = (tmp_path / logs.LOG_FILE).read_text(encoding="utf-8")
    assert "Unhandled error in thread worker-x" in text
    assert "RuntimeError: boom in a thread" in text


def test_no_log_folder_means_no_file(clean_logging, monkeypatch):
    monkeypatch.delenv("PDFENGINE_LOG_DIR", raising=False)
    assert logs.configure() is None


def test_missing_streams_are_replaced(clean_logging):
    # A windowed executable starts with sys.stderr (and stdout) set to None.
    sys.stdout = None
    sys.stderr = None
    logs.ensure_streams()
    assert sys.stdout is not None and sys.stderr is not None
    print("goes nowhere", file=sys.stderr)
