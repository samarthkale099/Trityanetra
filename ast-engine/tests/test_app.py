import pytest
from fastapi.testclient import TestClient
from app import app
from tests.conftest import TEST_SECRET

AUTH_HEADERS = {"X-Internal-Secret": TEST_SECRET}

# Authorized client (sends the internal secret, as the backend does)
client = TestClient(app, headers=AUTH_HEADERS)
# Unauthenticated client (simulates an external caller)
anon = TestClient(app)


class TestHealthEndpoint:
    def test_health_returns_ok(self):
        response = anon.get("/health")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "ok"
        assert "version" in data


class TestInternalAuth:
    """Rule 8: the engine is only reachable via an authenticated internal request."""

    VALID_BODY = {
        "submissions": [
            {"id": "sub1", "code": "x = 1", "studentId": "s1"},
            {"id": "sub2", "code": "y = 2", "studentId": "s2"},
        ]
    }

    def test_missing_header_rejected(self):
        response = anon.post("/api/v1/plagiarism/check", json=self.VALID_BODY)
        assert response.status_code == 401
        assert response.json()["detail"]["code"] == "UNAUTHORIZED"

    def test_wrong_secret_rejected(self):
        response = anon.post(
            "/api/v1/plagiarism/check",
            json=self.VALID_BODY,
            headers={"X-Internal-Secret": "wrong-secret"},
        )
        assert response.status_code == 401
        assert response.json()["detail"]["code"] == "UNAUTHORIZED"

    def test_empty_secret_header_rejected(self):
        response = anon.post(
            "/api/v1/plagiarism/check",
            json=self.VALID_BODY,
            headers={"X-Internal-Secret": ""},
        )
        # Empty header value may be dropped by the client — either way it
        # must not authenticate.
        assert response.status_code == 401

    def test_valid_secret_accepted(self):
        response = client.post("/api/v1/plagiarism/check", json=self.VALID_BODY)
        assert response.status_code == 200

    def test_fail_closed_when_no_secret_configured(self, monkeypatch):
        """With INTERNAL_SECRET unset, even a 'correct' header is rejected."""
        import auth.internalAuth as internal_auth

        monkeypatch.setattr(internal_auth, "INTERNAL_SECRET", "")
        response = client.post("/api/v1/plagiarism/check", json=self.VALID_BODY)
        assert response.status_code == 401
        assert response.json()["detail"]["code"] == "UNAUTHORIZED"

    def test_fail_closed_applies_even_without_header_when_unconfigured(self, monkeypatch):
        import auth.internalAuth as internal_auth

        monkeypatch.setattr(internal_auth, "INTERNAL_SECRET", "")
        response = anon.post("/api/v1/plagiarism/check", json=self.VALID_BODY)
        assert response.status_code == 401

    def test_health_still_public_when_unconfigured(self, monkeypatch):
        import auth.internalAuth as internal_auth

        monkeypatch.setattr(internal_auth, "INTERNAL_SECRET", "")
        response = anon.get("/health")
        assert response.status_code == 200


class TestPlagiarismCheck:
    """Happy path tests"""

    def test_check_identical_code(self):
        """Two identical submissions should be flagged as high."""
        response = client.post(
            "/api/v1/plagiarism/check",
            json={
                "submissions": [
                    {"id": "sub1", "code": "def add(a, b):\n    return a + b", "studentId": "student1"},
                    {"id": "sub2", "code": "def add(a, b):\n    return a + b", "studentId": "student2"},
                ]
            },
        )
        assert response.status_code == 200
        data = response.json()
        assert len(data["pairs"]) == 1
        assert data["pairs"][0]["flagLevel"] == "high"
        assert len(data["flagged"]) == 1

    def test_check_different_code(self):
        """Two completely different submissions should not be flagged."""
        response = client.post(
            "/api/v1/plagiarism/check",
            json={
                "submissions": [
                    {"id": "sub1", "code": "def add(a, b):\n    return a + b", "studentId": "student1"},
                    {"id": "sub2", "code": "import os\nprint(os.getcwd())", "studentId": "student2"},
                ]
            },
        )
        assert response.status_code == 200
        data = response.json()
        assert len(data["pairs"]) == 1
        assert data["pairs"][0]["flagLevel"] == "none"

    def test_check_returns_summary(self):
        """Response should include summary statistics."""
        response = client.post(
            "/api/v1/plagiarism/check",
            json={
                "submissions": [
                    {"id": "sub1", "code": "x = 1", "studentId": "s1"},
                    {"id": "sub2", "code": "y = 2", "studentId": "s2"},
                    {"id": "sub3", "code": "z = 3", "studentId": "s3"},
                ]
            },
        )
        assert response.status_code == 200
        data = response.json()
        assert data["summary"]["totalSubmissions"] == 3
        assert data["summary"]["totalPairs"] == 3  # C(3,2) = 3

    def test_all_metrics_within_bounds(self):
        """Rule 8: every metric the backend consumes is a number in [0, 1]."""
        response = client.post(
            "/api/v1/plagiarism/check",
            json={
                "submissions": [
                    {"id": "sub1", "code": "def add(a, b):\n    return a + b", "studentId": "s1"},
                    {"id": "sub2", "code": "def add(a, b):\n    return a + b", "studentId": "s2"},
                    {"id": "sub3", "code": "print('hello')", "studentId": "s3"},
                ]
            },
        )
        assert response.status_code == 200
        data = response.json()
        metric_names = [
            "cosine_similarity", "ted_score", "identifier_overlap",
            "operator_overlap", "combined_score",
        ]
        for collection in (data["pairs"], data["flagged"]):
            for pair in collection:
                for name in metric_names:
                    value = pair["metrics"][name]
                    assert isinstance(value, (int, float)), name
                    assert 0.0 <= value <= 1.0, f"{name}={value} out of bounds"
                assert pair["flagLevel"] in ("none", "low", "medium", "high")
        assert data["summary"]["processingTimeMs"] >= 0


class TestPlagiarismCheckErrors:
    """Error case tests"""

    def test_empty_submissions(self):
        """Should return 400 for empty submissions list."""
        response = client.post(
            "/api/v1/plagiarism/check",
            json={"submissions": []},
        )
        assert response.status_code == 422  # Pydantic validation

    def test_single_submission(self):
        """Should return 400 for only one submission (need at least 2)."""
        response = client.post(
            "/api/v1/plagiarism/check",
            json={"submissions": [{"id": "sub1", "code": "x = 1"}]},
        )
        assert response.status_code == 422  # Pydantic min_length=2

    def test_missing_code(self):
        """Should return 400 for submission without code."""
        response = client.post(
            "/api/v1/plagiarism/check",
            json={
                "submissions": [
                    {"id": "sub1", "studentId": "s1"},
                    {"id": "sub2", "code": "x = 1", "studentId": "s2"},
                ]
            },
        )
        # Pydantic validation or batch runner validation
        assert response.status_code in [400, 422]

    def test_missing_id(self):
        """Should return 400 for submission without id."""
        response = client.post(
            "/api/v1/plagiarism/check",
            json={
                "submissions": [
                    {"code": "x = 1", "studentId": "s1"},
                    {"id": "sub2", "code": "y = 2", "studentId": "s2"},
                ]
            },
        )
        # Pydantic validation or batch runner validation
        assert response.status_code in [400, 422]

    def test_malformed_body(self):
        """Should return 400/422 for completely malformed body."""
        response = client.post(
            "/api/v1/plagiarism/check",
            json={"not_submissions": "garbage"},
        )
        assert response.status_code == 422


class TestAdversarialCases:
    """Adversarial and edge case tests"""

    def test_same_student_not_compared(self):
        """Submissions from the same student should be excluded."""
        response = client.post(
            "/api/v1/plagiarism/check",
            json={
                "submissions": [
                    {"id": "sub1", "code": "def add(a, b):\n    return a + b", "studentId": "same_student"},
                    {"id": "sub2", "code": "def add(a, b):\n    return a + b", "studentId": "same_student"},
                ]
            },
        )
        assert response.status_code == 200
        data = response.json()
        # Same student — should be excluded
        assert len(data["pairs"]) == 0
        assert len(data["flagged"]) == 0

    def test_empty_code_handled_gracefully(self):
        """Empty code should be handled without crashing."""
        response = client.post(
            "/api/v1/plagiarism/check",
            json={
                "submissions": [
                    {"id": "sub1", "code": "", "studentId": "s1"},
                    {"id": "sub2", "code": "x = 1", "studentId": "s2"},
                ]
            },
        )
        assert response.status_code in [200, 400]

    def test_syntax_error_in_code(self):
        """Code with syntax errors should not crash the engine."""
        response = client.post(
            "/api/v1/plagiarism/check",
            json={
                "submissions": [
                    {"id": "sub1", "code": "def (broken", "studentId": "s1"},
                    {"id": "sub2", "code": "x = 1", "studentId": "s2"},
                ]
            },
        )
        assert response.status_code == 200  # Should handle gracefully

    def test_very_large_code(self):
        """Very large code submissions should be handled."""
        large_code = "x = 1\n" * 10000
        response = client.post(
            "/api/v1/plagiarism/check",
            json={
                "submissions": [
                    {"id": "sub1", "code": large_code, "studentId": "s1"},
                    {"id": "sub2", "code": "y = 2", "studentId": "s2"},
                ]
            },
        )
        assert response.status_code == 200

    def test_no_student_ids(self):
        """Submissions without student IDs should all be compared."""
        response = client.post(
            "/api/v1/plagiarism/check",
            json={
                "submissions": [
                    {"id": "sub1", "code": "x = 1"},
                    {"id": "sub2", "code": "y = 2"},
                ]
            },
        )
        assert response.status_code == 200
        data = response.json()
        assert len(data["pairs"]) == 1
