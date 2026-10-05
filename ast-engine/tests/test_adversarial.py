"""
Part 3: adversarial / break-it inputs.

Each case must either process sensibly (200 with bounded metrics) or return a
specific 4xx error naming what is wrong — never a bare 500, never a hang.
Covers the endpoint (correct auth) and the underlying functions directly.
"""
import time

import pytest
from fastapi.testclient import TestClient

from app import app
from tests.conftest import TEST_SECRET
from comparator.batch_runner import (
    run_batch, BatchRunValidationError, BatchRunTimeout,
)
from parser.ast_builder import parse_code
from comparator.comparator import compare

AUTH_HEADERS = {"X-Internal-Secret": TEST_SECRET}
client = TestClient(app, headers=AUTH_HEADERS)

METRIC_NAMES = [
    "cosine_similarity", "ted_score", "identifier_overlap",
    "operator_overlap", "combined_score",
]


def check(body: dict):
    response = client.post("/api/v1/plagiarism/check", json=body)
    assert response.status_code != 500, (
        f"bare 500 for {body}: {response.text[:300]}"
    )
    if response.status_code == 200:
        data = response.json()
        for pair in data["pairs"]:
            for name in METRIC_NAMES:
                value = pair["metrics"][name]
                assert isinstance(value, (int, float))
                assert 0.0 <= value <= 1.0, f"{name}={value}"
            assert pair["flagLevel"] in ("none", "low", "medium", "high")
    return response


def two(code_a: str, code_b: str, **extra_a) -> dict:
    a = {"id": "adv_a", "code": code_a, "studentId": "adv_s1"}
    b = {"id": "adv_b", "code": code_b, "studentId": "adv_s2"}
    a.update(extra_a)
    return {"submissions": [a, b]}


BIG_FILE = "\n".join(f"value_{i} = {i} * {i} - {i}" for i in range(3000))


class TestEmptyAndTrivialInput:
    def test_empty_string_code(self):
        response = check(two("", ""))
        assert response.status_code == 200
        assert response.json()["flagged"] == []

    def test_empty_vs_valid_code(self):
        response = check(two("", "def f(x):\n    return x + 1"))
        assert response.status_code == 200

    def test_comments_only_code(self):
        response = check(two("# only a comment\n# another one\n",
                             "# different comment\n"))
        assert response.status_code == 200
        data = response.json()
        # two different comment-only programs must never look identical
        assert data["flagged"] == [], data["flagged"]
        assert data["pairs"][0]["metrics"]["combined_score"] <= 0.35

    def test_whitespace_only_code(self):
        response = check(two("   \n\t\n   ", "\n\n   \n"))
        assert response.status_code == 200


class TestLargeInput:
    def test_one_multithousand_line_file(self):
        started = time.perf_counter()
        response = check(two(BIG_FILE, "x = 1"))
        elapsed = time.perf_counter() - started
        assert response.status_code == 200
        assert elapsed < 30, f"took {elapsed:.1f}s"

    def test_two_multithousand_line_files_do_not_hang(self):
        """Regression: pure-Python Levenshtein hung here for >10 minutes."""
        started = time.perf_counter()
        response = check(two(BIG_FILE, BIG_FILE.replace("value_", "other_")))
        elapsed = time.perf_counter() - started
        assert response.status_code == 200
        assert elapsed < 30, f"took {elapsed:.1f}s (hang regression)"

    def test_two_large_files_directly(self):
        a = parse_code(BIG_FILE, "python")
        b = parse_code(BIG_FILE + "\nextra = 1", "python")
        started = time.perf_counter()
        metrics = compare(a, b)
        elapsed = time.perf_counter() - started
        assert elapsed < 30, f"compare() took {elapsed:.1f}s"
        for name, value in metrics.items():
            assert 0.0 <= value <= 1.0


class TestUnicodeAndEncoding:
    def test_unicode_identifiers(self):
        code_a = ("def \u8ba1\u7b97(\u6570\u503c):\n"
                  "    \u603b\u548c = 0\n"
                  "    for \u5143\u7d20 in \u6570\u503c:\n"
                  "        \u603b\u548c += \u5143\u7d20\n"
                  "    return \u603b\u548c\n")
        code_b = "def calc(values):\n    total = 0\n    for el in values:\n        total += el\n    return total\n"
        response = check(two(code_a, code_b))
        assert response.status_code == 200

    def test_null_bytes_in_code(self):
        response = check(two("def f(:\x00", "zzz )) \x00"))
        assert response.status_code == 200

    def test_emoji_and_non_latin_comments(self):
        response = check(two("# \U0001F600 emoji\nx = 1", "# \u4e2d\u6587\ny = 2"))
        assert response.status_code == 200


class TestDeepNesting:
    @pytest.mark.parametrize("depth", [50, 200, 2000])
    def test_deeply_nested_parentheses(self, depth):
        code = "x = " + "(" * depth + "1" + ")" * depth
        response = check(two(code, "y = 2"))
        assert response.status_code == 200

    @pytest.mark.parametrize("depth", [30, 120, 600])
    def test_deeply_nested_if_blocks(self, depth):
        code = ("x = 0\n"
                + "".join("  " * i + "if True:\n" for i in range(depth))
                + "  " * depth + "x = 1\n")
        response = check(two(code, "y = 2"))
        assert response.status_code == 200

    def test_deep_nesting_direct_functions(self):
        deep = "[" * 5000 + "]" * 5000
        features = parse_code(deep, "python")   # must not raise
        metrics = compare(features, features)
        assert all(0.0 <= v <= 1.0 for v in metrics.values())


class TestInvalidSyntax:
    def test_unrelated_invalid_programs_are_not_flagged(self):
        response = check(two("def (broken", "@@@ !!! not code ~~~"))
        assert response.status_code == 200
        data = response.json()
        # both fall back to generic token analysis; unrelated broken programs
        # must never be accused of plagiarism (was: flag=high, score 0.7)
        assert data["flagged"] == [], data["flagged"]
        assert data["pairs"][0]["metrics"]["combined_score"] < 0.5

    def test_identical_invalid_program_still_comparable(self):
        broken = "def (unclosed(\n    x ==== 1"
        response = check(two(broken, broken))
        assert response.status_code == 200

    def test_invalid_vs_valid_not_flagged(self):
        response = check(two("def (broken", "x = 1"))
        assert response.status_code == 200
        assert response.json()["flagged"] == []

    def test_non_python_language_pair(self):
        body = {
            "submissions": [
                {"id": "c1", "code": "int main(void){return 0;}",
                 "language": "c", "studentId": "s1"},
                {"id": "c2", "code": "puts(\"hello\");",
                 "language": "c", "studentId": "s2"},
            ]
        }
        response = check(body)
        assert response.status_code == 200
        assert response.json()["flagged"] == []


class TestBatchValidation:
    def test_duplicate_submission_ids_rejected(self):
        body = {
            "submissions": [
                {"id": "same_id", "code": "x = 1", "studentId": "s1"},
                {"id": "same_id", "code": "y = 2", "studentId": "s2"},
            ]
        }
        response = check(body)
        assert response.status_code == 400
        detail = response.json()["detail"]
        assert detail["code"] == "VALIDATION_ERROR"
        assert "same_id" in detail["message"]

    def test_missing_code_field_names_the_field(self):
        body = {
            "submissions": [
                {"id": "s1", "studentId": "s1"},
                {"id": "s2", "code": "x = 1", "studentId": "s2"},
            ]
        }
        response = check(body)
        assert response.status_code == 422
        text = response.text
        assert "code" in text

    def test_missing_id_field_names_the_field(self):
        body = {
            "submissions": [
                {"code": "x = 1", "studentId": "s1"},
                {"id": "s2", "code": "y = 2", "studentId": "s2"},
            ]
        }
        response = check(body)
        assert response.status_code == 422
        assert "id" in response.text

    def test_non_string_code_rejected(self):
        body = {
            "submissions": [
                {"id": "s1", "code": 123, "studentId": "s1"},
                {"id": "s2", "code": "y = 2", "studentId": "s2"},
            ]
        }
        response = check(body)
        assert response.status_code == 422

    def test_zero_submissions(self):
        response = check({"submissions": []})
        assert response.status_code == 422
        assert "at least 2" in response.text.lower() or "min" in response.text.lower()

    def test_single_submission(self):
        response = check({"submissions": [{"id": "s1", "code": "x = 1"}]})
        assert response.status_code == 422

    def test_over_max_batch_size(self):
        from config import MAX_BATCH_SIZE
        subs = [
            {"id": f"s{i}", "code": f"x = {i}", "studentId": f"st{i}"}
            for i in range(MAX_BATCH_SIZE + 1)
        ]
        started = time.perf_counter()
        response = check({"submissions": subs})
        elapsed = time.perf_counter() - started
        assert response.status_code == 422
        assert str(MAX_BATCH_SIZE) in response.text
        assert elapsed < 10

    def test_direct_run_batch_duplicate_ids(self):
        with pytest.raises(BatchRunValidationError) as excinfo:
            run_batch([
                {"id": "dup", "code": "x = 1", "studentId": "s1"},
                {"id": "dup", "code": "y = 2", "studentId": "s2"},
            ])
        assert "dup" in str(excinfo.value)

    def test_direct_run_batch_non_string_code(self):
        with pytest.raises(BatchRunValidationError):
            run_batch([
                {"id": "s1", "code": None, "studentId": "s1"},
                {"id": "s2", "code": "y = 2", "studentId": "s2"},
            ])

    def test_timeout_error_is_specific(self, monkeypatch):
        import comparator.batch_runner as batch_runner
        monkeypatch.setattr(batch_runner, "BATCH_TIMEOUT_SECONDS", -1)
        with pytest.raises(BatchRunTimeout):
            run_batch([
                {"id": "s1", "code": "x = 1", "studentId": "s1"},
                {"id": "s2", "code": "y = 2", "studentId": "s2"},
            ])
