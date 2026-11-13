"""Engine errors and the handlers that turn them into the API's error shape.

Every error response is ``{"error": {"code": "...", "message": "..."}}``.
"""

import logging

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

logger = logging.getLogger("pdfengine")


class EngineError(Exception):
    """An error with a stable machine-readable code, raised by engine code."""

    def __init__(self, code: str, message: str, status: int = 400) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status = status


class UnauthorizedError(EngineError):
    def __init__(self) -> None:
        super().__init__("unauthorized", "Missing or invalid engine token.", 401)


class NotFoundError(EngineError):
    def __init__(self, message: str = "Not found.") -> None:
        super().__init__("not_found", message, 404)


class BadRequestError(EngineError):
    def __init__(self, message: str) -> None:
        super().__init__("bad_request", message, 400)


class FileNotFound(EngineError):
    def __init__(self, path: str) -> None:
        super().__init__("file_not_found", f"The file does not exist: {path}", 404)


class FileUnreadableError(EngineError):
    def __init__(self, path: str, reason: str) -> None:
        super().__init__("file_unreadable", f"The file could not be read: {path} ({reason})", 403)


class InvalidPdfError(EngineError):
    def __init__(self, message: str = "The file is not a PDF or is damaged.") -> None:
        super().__init__("invalid_pdf", message, 422)


class PasswordRequiredError(EngineError):
    def __init__(self) -> None:
        super().__init__("password_required", "This document needs a password.", 401)


class PasswordIncorrectError(EngineError):
    def __init__(self) -> None:
        super().__init__("password_incorrect", "The password is not correct.", 401)


_STATUS_CODES = {
    400: "bad_request",
    401: "unauthorized",
    403: "forbidden",
    404: "not_found",
    405: "method_not_allowed",
    409: "conflict",
    422: "invalid_request",
}


def error_response(code: str, message: str, status: int) -> JSONResponse:
    return JSONResponse(status_code=status, content={"error": {"code": code, "message": message}})


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(EngineError)
    async def _engine_error(_request: Request, exc: EngineError) -> JSONResponse:
        return error_response(exc.code, exc.message, exc.status)

    @app.exception_handler(StarletteHTTPException)
    async def _http_error(_request: Request, exc: StarletteHTTPException) -> JSONResponse:
        code = _STATUS_CODES.get(exc.status_code, "http_error")
        return error_response(code, str(exc.detail), exc.status_code)

    @app.exception_handler(RequestValidationError)
    async def _validation_error(_request: Request, exc: RequestValidationError) -> JSONResponse:
        parts = []
        for err in exc.errors():
            location = ".".join(str(item) for item in err.get("loc", ()))
            parts.append(f"{location}: {err.get('msg', 'invalid value')}")
        return error_response("invalid_request", "; ".join(parts) or "Invalid request.", 422)

    @app.exception_handler(Exception)
    async def _unexpected_error(_request: Request, exc: Exception) -> JSONResponse:
        logger.exception("Unhandled engine error", exc_info=exc)
        return error_response("internal_error", "The engine hit an unexpected error.", 500)
