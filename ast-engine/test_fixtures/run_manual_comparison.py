#!/usr/bin/env python3
"""
Part 5: real-file black-box comparison against the LIVE API.

Reads AST_ENGINE_INTERNAL_SECRET from the environment (never hardcoded),
submits every pairwise combination of the 6 fixture files for each of the 4
problems (15 pairs x 4 problems = 60 authenticated HTTP requests), prints a
table and writes manual_comparison_report.csv next to this script.

Output order per problem: a_vs_b, a_vs_c, a_vs_d, a_vs_e, a_vs_f first,
then the remaining pairs in file order.

Usage:
    set AST_ENGINE_INTERNAL_SECRET=...     (and have the server running)
    python test_fixtures/run_manual_comparison.py
"""
import csv
import itertools
import os
import sys
from pathlib import Path

import httpx

FIXTURES = Path(__file__).parent / "manual_comparisons"
REPORT_CSV = Path(__file__).parent / "manual_comparison_report.csv"
BASE_URL = os.environ.get("AST_ENGINE_URL", "http://127.0.0.1:8000")

PROBLEMS = ["sum_of_list", "is_prime", "bubble_sort", "reverse_string"]
# itertools.combinations already yields a_vs_b, a_vs_c, a_vs_d, a_vs_e,
# a_vs_f first, then the rest.
VARIANTS = [
    "a_original",
    "b_exact_copy",
    "c_renamed",
    "d_reordered",
    "e_different_algo",
    "f_honest_independent",
]

METRIC_KEYS = [
    "cosine_similarity",
    "ted_score",
    "identifier_overlap",
    "operator_overlap",
    "combined_score",
]


def fail(message: str) -> "NoReturn":  # type: ignore[name-defined]
    print(f"ERROR: {message}", file=sys.stderr)
    sys.exit(1)


def main() -> int:
    secret = os.environ.get("AST_ENGINE_INTERNAL_SECRET")
    if not secret:
        fail("AST_ENGINE_INTERNAL_SECRET is not set in the environment "
             "(never hardcoded in this script)")

    headers = {"X-Internal-Secret": secret}

    try:
        with httpx.Client(base_url=BASE_URL, headers=headers, timeout=60.0) as client:
            health = client.get("/health")
            if health.status_code != 200:
                fail(f"/health returned {health.status_code}")

            auth_probe = client.post(
                "/api/v1/plagiarism/check",
                json={"submissions": [
                    {"id": "probe_a", "code": "x = 1", "studentId": "p1"},
                    {"id": "probe_b", "code": "y = 2", "studentId": "p2"},
                ]},
            )
            if auth_probe.status_code == 401:
                fail("server rejected AST_ENGINE_INTERNAL_SECRET (401)")
            if auth_probe.status_code != 200:
                fail(f"authenticated probe failed: {auth_probe.status_code} "
                     f"{auth_probe.text[:300]}")

            rows = []
            for problem in PROBLEMS:
                problem_dir = FIXTURES / problem
                sources = {
                    variant: (problem_dir / f"{variant}.py").read_text(
                        encoding="utf-8"
                    )
                    for variant in VARIANTS
                }
                for variant_a, variant_b in itertools.combinations(VARIANTS, 2):
                    response = client.post(
                        "/api/v1/plagiarism/check",
                        json={
                            "submissions": [
                                {
                                    "id": f"{problem}__{variant_a}",
                                    "code": sources[variant_a],
                                    "studentId": f"stu_{problem}_{variant_a}",
                                },
                                {
                                    "id": f"{problem}__{variant_b}",
                                    "code": sources[variant_b],
                                    "studentId": f"stu_{problem}_{variant_b}",
                                },
                            ]
                        },
                    )
                    if response.status_code != 200:
                        fail(f"{problem} {variant_a} vs {variant_b}: "
                             f"HTTP {response.status_code} {response.text[:300]}")
                    data = response.json()
                    if len(data["pairs"]) != 1:
                        fail(f"{problem} {variant_a} vs {variant_b}: expected "
                             f"1 pair, got {len(data['pairs'])} (prefilter?)")
                    pair = data["pairs"][0]
                    row = {
                        "problem": problem,
                        "file_a": f"{variant_a}.py",
                        "file_b": f"{variant_b}.py",
                        "score": pair["metrics"]["combined_score"],
                        "flagged": pair["flagLevel"],
                    }
                    row.update({k: pair["metrics"][k] for k in METRIC_KEYS[:-1]})
                    rows.append(row)
    except httpx.HTTPError as exc:
        fail(f"HTTP error talking to {BASE_URL}: {exc}")

    expected = len(PROBLEMS) * len(VARIANTS) * (len(VARIANTS) - 1) // 2
    if len(rows) != expected:
        fail(f"expected {expected} pairs, collected {len(rows)}")

    # ------------------------------------------------------------- print
    header = (f"{'problem':<14} {'pair':<34} {'score':>6} {'flag':<7} "
              f"{'cos':>6} {'ted':>6} {'id':>6} {'op':>6}")
    print(header)
    print("-" * len(header))
    for row in rows:
        pair_name = f"{row['file_a'][:-3]}_vs_{row['file_b'][:-3]}"
        print(f"{row['problem']:<14} {pair_name:<34} {row['score']:>6.4f} "
              f"{row['flagged']:<7} {row['cosine_similarity']:>6.4f} "
              f"{row['ted_score']:>6.4f} {row['identifier_overlap']:>6.4f} "
              f"{row['operator_overlap']:>6.4f}")

    # --------------------------------------------------------------- csv
    fieldnames = ["problem", "file_a", "file_b", "score", "flagged"] + METRIC_KEYS[:-1]
    with REPORT_CSV.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)

    print(f"\n{len(rows)} pairs written to {REPORT_CSV}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
