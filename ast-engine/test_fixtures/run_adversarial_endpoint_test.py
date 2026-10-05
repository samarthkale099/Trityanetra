#!/usr/bin/env python3
"""
Part 3: adversarial inputs against the LIVE /api/v1/plagiarism/check endpoint
over real HTTP with correct auth.

Every case must either process sensibly (200 + bounded metrics) or return a
specific 4xx naming what is wrong — never a bare 500, never a hang.

Reads AST_ENGINE_INTERNAL_SECRET from the environment (never hardcoded).
Usage:
    python test_fixtures/run_adversarial_endpoint_test.py
"""
import os
import sys
import time
from pathlib import Path

import httpx

BASE_URL = os.environ.get("AST_ENGINE_URL", "http://127.0.0.1:8000")
MAX_CASE_SECONDS = 60

BIG_FILE = "\n".join(f"value_{i} = {i} * {i} - {i}" for i in range(3000))

CASES = [
    ("empty string code", {"submissions": [
        {"id": "adv_1", "code": "", "studentId": "s1"},
        {"id": "adv_2", "code": "", "studentId": "s2"},
    ]}),
    ("comments-only code", {"submissions": [
        {"id": "adv_1", "code": "# just a comment\n# another\n",
         "studentId": "s1"},
        {"id": "adv_2", "code": "# different comment\n", "studentId": "s2"},
    ]}),
    ("whitespace-only code", {"submissions": [
        {"id": "adv_1", "code": "   \n\t\n", "studentId": "s1"},
        {"id": "adv_2", "code": "\n\n   \n", "studentId": "s2"},
    ]}),
    ("one multi-thousand-line file", {"submissions": [
        {"id": "adv_1", "code": BIG_FILE, "studentId": "s1"},
        {"id": "adv_2", "code": "x = 1", "studentId": "s2"},
    ]}),
    ("two multi-thousand-line files", {"submissions": [
        {"id": "adv_1", "code": BIG_FILE, "studentId": "s1"},
        {"id": "adv_2", "code": BIG_FILE.replace("value_", "other_"),
         "studentId": "s2"},
    ]}),
    ("unicode identifiers", {"submissions": [
        {"id": "adv_1",
         "code": "def \u8ba1\u7b97(\u6570\u503c):\n    \u603b\u548c = 0\n"
                 "    for \u5143\u7d20 in \u6570\u503c:\n"
                 "        \u603b\u548c += \u5143\u7d20\n    return \u603b\u548c\n",
         "studentId": "s1"},
        {"id": "adv_2",
         "code": "def calc(values):\n    total = 0\n    for el in values:\n"
                 "        total += el\n    return total\n",
         "studentId": "s2"},
    ]}),
    ("deeply nested (2000 brackets)", {"submissions": [
        {"id": "adv_1", "code": "x = " + "[" * 2000 + "]" * 2000,
         "studentId": "s1"},
        {"id": "adv_2", "code": "y = 2", "studentId": "s2"},
    ]}),
    ("deeply nested (400 if-blocks)", {"submissions": [
        {"id": "adv_1",
         "code": "x = 0\n" + "".join("  " * i + "if True:\n" for i in range(400))
                 + "  " * 400 + "x = 1\n",
         "studentId": "s1"},
        {"id": "adv_2", "code": "y = 2", "studentId": "s2"},
    ]}),
    ("syntactically invalid (unrelated)", {"submissions": [
        {"id": "adv_1", "code": "def (broken", "studentId": "s1"},
        {"id": "adv_2", "code": "@@@ !!! not code ~~~", "studentId": "s2"},
    ]}),
    ("syntactically invalid (identical)", {"submissions": [
        {"id": "adv_1", "code": "def (broken", "studentId": "s1"},
        {"id": "adv_2", "code": "def (broken", "studentId": "s2"},
    ]}),
    ("null bytes in code", {"submissions": [
        {"id": "adv_1", "code": "def f(:\x00", "studentId": "s1"},
        {"id": "adv_2", "code": "zzz )) \x00", "studentId": "s2"},
    ]}),
    ("duplicate submission ids", {"submissions": [
        {"id": "same_id", "code": "x = 1", "studentId": "s1"},
        {"id": "same_id", "code": "y = 2", "studentId": "s2"},
    ]}),
    ("missing required field (code)", {"submissions": [
        {"id": "adv_1", "studentId": "s1"},
        {"id": "adv_2", "code": "y = 2", "studentId": "s2"},
    ]}),
    ("missing required field (id)", {"submissions": [
        {"code": "x = 1", "studentId": "s1"},
        {"id": "adv_2", "code": "y = 2", "studentId": "s2"},
    ]}),
    ("zero submissions", {"submissions": []}),
    ("single submission", {"submissions": [
        {"id": "adv_1", "code": "x = 1"},
    ]}),
    ("non-string code", {"submissions": [
        {"id": "adv_1", "code": 123, "studentId": "s1"},
        {"id": "adv_2", "code": "y = 2", "studentId": "s2"},
    ]}),
    ("valid baseline (control)", {"submissions": [
        {"id": "adv_1", "code": "def add(a, b):\n    return a + b",
         "studentId": "s1"},
        {"id": "adv_2", "code": "def add(a, b):\n    return a + b",
         "studentId": "s2"},
    ]}),
]


def fail(message: str) -> "NoReturn":  # type: ignore[name-defined]
    print(f"ERROR: {message}", file=sys.stderr)
    sys.exit(1)


def main() -> int:
    secret = os.environ.get("AST_ENGINE_INTERNAL_SECRET")
    if not secret:
        fail("AST_ENGINE_INTERNAL_SECRET is not set in the environment "
             "(never hardcoded in this script)")

    failures = 0
    header = f"{'case':<36} {'status':>6} {'time':>7}  outcome"
    print(header)
    print("-" * (len(header) + 40))

    with httpx.Client(base_url=BASE_URL, timeout=120.0) as client:
        health = client.get("/health")
        if health.status_code != 200:
            fail(f"/health returned {health.status_code}")

        no_auth = client.post("/api/v1/plagiarism/check", json=CASES[-1][1])
        bad_auth = client.post(
            "/api/v1/plagiarism/check", json=CASES[-1][1],
            headers={"X-Internal-Secret": "not-the-secret"},
        )
        print(f"{'no auth header':<36} {no_auth.status_code:>6} {'-':>7}  "
              f"{'rejected (expect 401)' if no_auth.status_code == 401 else 'UNEXPECTED'}")
        print(f"{'wrong auth header':<36} {bad_auth.status_code:>6} {'-':>7}  "
              f"{'rejected (expect 401)' if bad_auth.status_code == 401 else 'UNEXPECTED'}")
        if no_auth.status_code != 401 or bad_auth.status_code != 401:
            failures += 1

        client.headers.update({"X-Internal-Secret": secret})

        for name, body in CASES:
            started = time.perf_counter()
            response = client.post("/api/v1/plagiarism/check", json=body)
            elapsed = time.perf_counter() - started

            status = response.status_code
            if status == 200:
                data = response.json()
                metrics_ok = True
                for pair in data["pairs"]:
                    for key, value in pair["metrics"].items():
                        if not isinstance(value, (int, float)) or not 0 <= value <= 1:
                            metrics_ok = False
                outcome = (f"200 OK pairs={len(data['pairs'])} "
                           f"flagged={len(data['flagged'])} "
                           f"metrics_bounded={metrics_ok}")
                ok = metrics_ok
            elif status in (400, 401, 408, 422):
                detail = response.json().get("detail", "")
                if isinstance(detail, dict):
                    message = str(detail.get("message", detail))
                elif isinstance(detail, list):
                    message = "; ".join(str(d.get("msg", d)) for d in detail)
                else:
                    message = str(detail)
                outcome = f"{status} specific error: {message[:150]}"
                ok = True
            else:
                outcome = f"{status} BARE/UNEXPECTED: {response.text[:150]}"
                ok = False

            if elapsed > MAX_CASE_SECONDS:
                outcome += f"  [SLOW: {elapsed:.1f}s]"
                ok = False
            if not ok:
                failures += 1

            print(f"{name:<36} {status:>6} {elapsed:>6.2f}s  {outcome}")

    print(f"\n{'PASS' if failures == 0 else 'FAIL'} — {failures} failing case(s)")
    return 0 if failures == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
