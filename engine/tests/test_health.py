import pymupdf
import pytest

from pdfengine import __version__
from pdfengine.server import TOKEN_HEADER, create_app

from .conftest import TEST_ORIGIN


def test_health_with_valid_token(client):
    response = client.get("/v1/health")

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["engineVersion"] == __version__
    assert body["pymupdfVersion"] == pymupdf.__version__
    assert body["mupdfVersion"]
    assert body["openDocuments"] == 0


def test_health_without_token_is_401(anonymous_client):
    response = anonymous_client.get("/v1/health")

    assert response.status_code == 401
    assert response.json() == {
        "error": {"code": "unauthorized", "message": "Missing or invalid engine token."}
    }


def test_health_with_wrong_token_is_401(anonymous_client):
    response = anonymous_client.get("/v1/health", headers={TOKEN_HEADER: "wrong"})

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "unauthorized"


def test_unknown_route_uses_error_shape(client):
    response = client.get("/v1/does-not-exist")

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "not_found"


def test_unknown_route_without_token_does_not_leak(anonymous_client):
    # Outside /v1 nothing exists, so the answer is a plain 404 in the error shape.
    response = anonymous_client.get("/health")

    assert response.status_code == 404
    assert "error" in response.json()


def test_cors_preflight_needs_no_token(anonymous_client):
    response = anonymous_client.options(
        "/v1/health",
        headers={
            "Origin": TEST_ORIGIN,
            "Access-Control-Request-Method": "GET",
            "Access-Control-Request-Headers": "x-engine-token",
        },
    )

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == TEST_ORIGIN


def test_cors_rejects_other_origins(anonymous_client):
    response = anonymous_client.options(
        "/v1/health",
        headers={
            "Origin": "https://example.com",
            "Access-Control-Request-Method": "GET",
            "Access-Control-Request-Headers": "x-engine-token",
        },
    )

    assert "access-control-allow-origin" not in response.headers


def test_app_requires_a_token():
    with pytest.raises(ValueError):
        create_app("")
