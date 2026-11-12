import pytest
from fastapi.testclient import TestClient

from pdfengine.server import TOKEN_HEADER, create_app

TEST_TOKEN = "test-token-123"
TEST_ORIGIN = "http://localhost:5173"


@pytest.fixture
def app():
    return create_app(TEST_TOKEN, [TEST_ORIGIN])


@pytest.fixture
def anonymous_client(app):
    """A client that sends no token."""
    with TestClient(app, raise_server_exceptions=False) as client:
        yield client


@pytest.fixture
def client(app):
    """A client that sends the correct token on every request."""
    with TestClient(
        app, headers={TOKEN_HEADER: TEST_TOKEN}, raise_server_exceptions=False
    ) as client:
        yield client
