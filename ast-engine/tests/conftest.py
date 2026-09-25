"""
Shared pytest configuration: patch the internal secret used by the AST
engine auth so endpoint tests exercise the real authenticated path
(rule 8: the engine is only reachable via an authenticated internal request).
"""
import pytest

TEST_SECRET = "test-internal-secret"


@pytest.fixture(autouse=True)
def _configure_internal_secret(monkeypatch):
    import auth.internalAuth as internal_auth

    monkeypatch.setattr(internal_auth, "INTERNAL_SECRET", TEST_SECRET)
    yield
