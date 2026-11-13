"""Exit the engine when the process that owns it disappears.

The Electron main process passes its own PID in ``PDFENGINE_PARENT_PID``. That
is deliberate: in development the engine's direct parent is ``uv`` (and, on
Windows, the venv's ``python.exe`` launcher), not Electron, so ``os.getppid()``
would watch the wrong process.
"""

import contextlib
import os
import sys
import threading
import time
from collections.abc import Callable

_SYNCHRONIZE = 0x00100000
_INFINITE = 0xFFFFFFFF


def _wait_windows(pid: int) -> None:
    import ctypes
    from ctypes import wintypes

    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel32.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
    kernel32.OpenProcess.restype = wintypes.HANDLE
    kernel32.WaitForSingleObject.argtypes = [wintypes.HANDLE, wintypes.DWORD]
    kernel32.WaitForSingleObject.restype = wintypes.DWORD
    kernel32.CloseHandle.argtypes = [wintypes.HANDLE]

    # Holding a handle means the PID cannot be reused while we wait on it.
    handle = kernel32.OpenProcess(_SYNCHRONIZE, False, pid)
    if not handle:
        # The owner is already gone (or cannot be opened): treat it as dead.
        return
    try:
        kernel32.WaitForSingleObject(handle, _INFINITE)
    finally:
        kernel32.CloseHandle(handle)


def _wait_posix(pid: int) -> None:
    while True:
        try:
            os.kill(pid, 0)
        except ProcessLookupError:
            return
        except PermissionError:
            pass  # exists, owned by another user
        time.sleep(1.0)


def wait_for_exit(pid: int) -> None:
    """Block until the process with ``pid`` no longer exists."""
    if sys.platform == "win32":
        _wait_windows(pid)
    else:
        _wait_posix(pid)


def exit_now() -> None:
    with contextlib.suppress(Exception):
        sys.stderr.write("pdfengine: owner process exited, shutting down\n")
        sys.stderr.flush()
    os._exit(0)


def start_parent_watchdog(pid: int, on_exit: Callable[[], None] = exit_now) -> threading.Thread:
    """Start a daemon thread that calls ``on_exit`` once ``pid`` is gone."""

    def run() -> None:
        wait_for_exit(pid)
        on_exit()

    thread = threading.Thread(target=run, name="parent-watchdog", daemon=True)
    thread.start()
    return thread
