"""Running a job's heavy part in a child process.

PyMuPDF holds the GIL while it works and is guarded by one process-wide lock,
so OCR or compressing a large document in a thread would stall page rendering
for the whole time. Such work runs in a separate process instead: started with
the ``spawn`` method (the only one on Windows), given its input through files
in a temporary folder, reporting progress through a queue. Cancelling a job
terminates the process; it only ever works on copies, so nothing is lost.

The target is named as ``"module:function"`` and is called as
``function(payload, report)`` where ``report(fraction, message=None)`` sends
progress. It returns a small picklable value (paths, counts), or raises
``EngineError`` for a failure the user should read.

The child exits by itself if the engine disappears (the same watchdog the
engine uses for the app). It writes nothing to stdout: the engine's stdout
carries the ``ENGINE_READY`` line for the app.

The frozen engine calls ``multiprocessing.freeze_support()`` first thing
(``engine_entry.py``, ``__main__.main``); target modules are listed as hidden
imports in ``pdfengine.spec``, since they are only imported by name here.
"""

import contextlib
import importlib
import logging
import multiprocessing
import os
import queue
import sys
import traceback
from collections.abc import Callable
from typing import Any

from .errors import EngineError
from .jobs import JobCancelled, JobContext

Report = Callable[..., None]

logger = logging.getLogger("pdfengine")

#: How long to wait for a terminated child to go.
_JOIN_SECONDS = 5.0


class WorkerFailedError(EngineError):
    def __init__(self, message: str = "The worker process stopped unexpectedly.") -> None:
        super().__init__("worker_failed", message, 500)


def _child_main(target: str, payload: Any, messages: Any, parent_pid: int) -> None:
    # A child of the windowed (frozen) engine has no stdio at all.
    from .logs import ensure_streams

    ensure_streams()
    # Keep stdout clean: it belongs to the engine's start-up protocol.
    with contextlib.suppress(Exception):
        sys.stdout.flush()
        os.dup2(sys.stderr.fileno(), 1)
        sys.stdout = sys.stderr

    from .watchdog import start_parent_watchdog

    start_parent_watchdog(parent_pid, lambda: os._exit(1))

    def report(fraction: float, message: str | None = None) -> None:
        messages.put(("progress", float(fraction), message))

    try:
        module_name, function_name = target.split(":")
        function = getattr(importlib.import_module(module_name), function_name)
        result = function(payload, report)
        messages.put(("done", result))
    except EngineError as exc:
        messages.put(("error", exc.code, exc.message, exc.status, exc.details))
    except BaseException as exc:  # noqa: BLE001 - everything must reach the parent
        # The engine logs the traceback: a child of the frozen engine has
        # nowhere to print it.
        messages.put(
            ("error", "internal_error", f"The job failed: {exc}", 500, {}, traceback.format_exc())
        )


def run_in_process(
    context: JobContext,
    target: str,
    payload: Any,
    *,
    span: tuple[float, float] = (0.0, 1.0),
) -> Any:
    """Runs ``target(payload, report)`` in a child process and returns its
    result. Progress reported by the child is mapped into ``span`` of the job's
    progress. Raises ``JobCancelled`` (after terminating the child) when the job
    is cancelled, and the child's ``EngineError`` when it fails."""
    context.check()
    spawn = multiprocessing.get_context("spawn")
    messages = spawn.Queue()
    process = spawn.Process(
        target=_child_main,
        args=(target, payload, messages, os.getpid()),
        name=f"pdfengine-{target.rsplit(':', 1)[-1]}",
        daemon=True,
    )
    process.start()
    low, high = span
    try:
        while True:
            try:
                message = messages.get(timeout=0.1)
            except queue.Empty:
                if context.cancelled:
                    raise JobCancelled() from None
                if not process.is_alive():
                    # A last message may still be in the pipe.
                    try:
                        message = messages.get(timeout=0.5)
                    except queue.Empty:
                        raise WorkerFailedError() from None
                else:
                    continue
            kind = message[0]
            if kind == "progress":
                _, fraction, text = message
                context.progress(low + (high - low) * max(0.0, min(1.0, fraction)), text)
                if context.cancelled:
                    raise JobCancelled()
            elif kind == "done":
                return message[1]
            elif kind == "error":
                _, code, text, status, details, *trace = message
                if trace:
                    logger.error("Job child %s failed:\n%s", target, trace[0])
                raise EngineError(code, text, status).with_details(**details)
    finally:
        if process.is_alive():
            process.terminate()
        process.join(_JOIN_SECONDS)
        with contextlib.suppress(Exception):
            messages.close()
            messages.cancel_join_thread()
