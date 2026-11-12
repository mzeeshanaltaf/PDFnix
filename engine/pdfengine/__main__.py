"""Engine entry point: ``python -m pdfengine``.

Environment:
- ``PDFENGINE_TOKEN`` (required): shared secret expected in ``X-Engine-Token``.
- ``PDFENGINE_PARENT_PID`` (optional): PID to watch; the engine exits when that
  process disappears. Defaults to the direct parent.
- ``PDFENGINE_ALLOWED_ORIGINS`` (optional): comma-separated origins for CORS.

Stdout carries exactly one line, ``ENGINE_READY port=<n>``, printed once the
server is accepting connections. Logs go to stderr.
"""

import os
import socket
import sys

import uvicorn

from .server import create_app
from .watchdog import start_parent_watchdog

HOST = "127.0.0.1"


class _Server(uvicorn.Server):
    """Announces the port on stdout after startup has completed."""

    def __init__(self, config: uvicorn.Config, port: int) -> None:
        super().__init__(config)
        self._port = port

    async def startup(self, sockets: list[socket.socket] | None = None) -> None:
        await super().startup(sockets=sockets)
        if self.started:
            print(f"ENGINE_READY port={self._port}", flush=True)


def main() -> int:
    token = os.environ.get("PDFENGINE_TOKEN", "")
    if not token:
        print("pdfengine: PDFENGINE_TOKEN is not set", file=sys.stderr, flush=True)
        return 2

    origins = [o.strip() for o in os.environ.get("PDFENGINE_ALLOWED_ORIGINS", "").split(",")]
    app = create_app(token, [o for o in origins if o])

    parent_pid = int(os.environ.get("PDFENGINE_PARENT_PID") or os.getppid())
    start_parent_watchdog(parent_pid)

    # Port 0 lets the OS pick a free port; binding here means we know the port
    # before the server starts and nothing else can take it in between.
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.bind((HOST, 0))
    port = sock.getsockname()[1]

    config = uvicorn.Config(app, log_level="warning", access_log=False)
    _Server(config, port).run(sockets=[sock])
    return 0


if __name__ == "__main__":
    sys.exit(main())
