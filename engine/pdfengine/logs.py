"""Where the engine's log goes.

Records go to stderr (the app shows its tail when the engine fails to start,
and prints it in development) and, when ``PDFENGINE_LOG_DIR`` is set, to a
rotating file there (the app passes ``<userData>/logs``). The installed engine
is a windowed executable, so the file is the only lasting record of what went
wrong on a user's machine.

A windowed executable may also start without a stderr at all (Python then sets
``sys.stderr`` to ``None``); it is pointed at the null device so that nothing
that writes to it (uvicorn, tracebacks) fails.
"""

import logging
import logging.handlers
import os
import sys
import threading

LOG_FILE = "engine.log"
MAX_BYTES = 1_000_000
BACKUPS = 3
FORMAT = "%(asctime)s %(process)d %(levelname)s %(name)s: %(message)s"

logger = logging.getLogger("pdfengine")


def ensure_streams() -> None:
    """Gives a process without stdio (windowed executable, its children)
    harmless streams instead of ``None``."""
    for name in ("stdout", "stderr"):
        if getattr(sys, name) is None:
            setattr(sys, name, open(os.devnull, "w", encoding="utf-8"))  # noqa: SIM115


def configure(log_dir: str | None = None) -> str | None:
    """Sets up logging for the engine process. Returns the log file's path, or
    ``None`` when there is no log folder or it cannot be written."""
    ensure_streams()
    root = logging.getLogger()
    root.setLevel(logging.WARNING)
    logger.setLevel(logging.INFO)
    formatter = logging.Formatter(FORMAT)

    stream = logging.StreamHandler(sys.stderr)
    stream.setFormatter(formatter)
    root.addHandler(stream)

    path = None
    log_dir = log_dir if log_dir is not None else os.environ.get("PDFENGINE_LOG_DIR")
    if log_dir:
        try:
            os.makedirs(log_dir, exist_ok=True)
            path = os.path.join(log_dir, LOG_FILE)
            handler = logging.handlers.RotatingFileHandler(
                path, maxBytes=MAX_BYTES, backupCount=BACKUPS, encoding="utf-8", delay=True
            )
        except OSError as exc:
            logger.warning("Cannot write the log file in %s: %s", log_dir, exc)
            path = None
        else:
            handler.setFormatter(formatter)
            root.addHandler(handler)

    def log_thread_exception(args: threading.ExceptHookArgs) -> None:
        if args.exc_type is SystemExit:
            return
        logger.error(
            "Unhandled error in thread %s",
            args.thread.name if args.thread else "?",
            exc_info=(args.exc_type, args.exc_value, args.exc_traceback),  # type: ignore[arg-type]
        )

    def log_exception(exc_type, exc_value, exc_traceback) -> None:  # type: ignore[no-untyped-def]
        if issubclass(exc_type, KeyboardInterrupt):
            sys.__excepthook__(exc_type, exc_value, exc_traceback)
            return
        logger.critical("Unhandled error", exc_info=(exc_type, exc_value, exc_traceback))

    threading.excepthook = log_thread_exception
    sys.excepthook = log_exception
    return path
