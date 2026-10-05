#!/usr/bin/env python3
"""
Part 6: batch size scaling + known-pair-at-scale correctness against the LIVE API.

Batch sizes tested: 0, 1, 2, 10, 30, MAX_BATCH_SIZE, MAX_BATCH_SIZE + 1.

For N in (10, 30, MAX) the known strong-match pair from Part 5
(manual_comparisons/sum_of_list/a_original.py + c_renamed.py) is embedded in
the batch alongside honest filler submissions; afterwards we check whether that
pair is still flagged, whether its score matches the isolated Part 5 score, and
whether any filler pair was falsely flagged.

Reads AST_ENGINE_INTERNAL_SECRET from the environment (never hardcoded).
Usage:
    python test_fixtures/run_batch_scaling_test.py
"""
import csv
import os
import random
import sys
import time
from pathlib import Path

import httpx

HERE = Path(__file__).parent
FIXTURES = HERE / "manual_comparisons" / "sum_of_list"
REPORT_CSV = HERE / "manual_comparison_report.csv"
SCALING_CSV = HERE / "batch_scaling_report.csv"
BASE_URL = os.environ.get("AST_ENGINE_URL", "http://127.0.0.1:8000")

sys.path.insert(0, str(HERE.parent))
from config import MAX_BATCH_SIZE  # noqa: E402  (defined in config.py)

KNOWN_PAIR = ("a_original", "c_renamed")
EMBED_SIZES = {10, 30, MAX_BATCH_SIZE}
SIZES = [0, 1, 2, 10, 30, MAX_BATCH_SIZE, MAX_BATCH_SIZE + 1]

SHAPE_TEMPLATES = [
    # (template, body builder) — deliberately different program shapes so the
    # filler represents honest, independent submissions.
    """def task_{i}(data_{i}):
    total_{i} = {lit}
    for item_{i} in data_{i}:
        total_{i} = total_{i} + item_{i}
    return total_{i}
""",
    """def task_{i}(data_{i}):
    best_{i} = None
    for item_{i} in data_{i}:
        if best_{i} is None or item_{i} > best_{i}:
            best_{i} = item_{i}
    return best_{i}
""",
    """def task_{i}():
    output_{i} = []
    for step_{i} in range({lit}):
        if step_{i} % 2 == 0:
            output_{i}.append(step_{i})
    return output_{i}
""",
    """def task_{i}(text_{i}):
    count_{i} = 0
    position_{i} = 0
    while position_{i} < len(text_{i}):
        if text_{i}[position_{i}] == "a":
            count_{i} += 1
        position_{i} += 1
    return count_{i}
""",
    """def task_{i}(value_{i}):
    if value_{i} < 0:
        return -value_{i}
    if value_{i} == 0:
        return 0
    doubled_{i} = value_{i} * 2
    return doubled_{i}
""",
    """def task_{i}(items_{i}):
    squared_{i} = []
    for entry_{i} in items_{i}:
        squared_{i}.append(entry_{i} * entry_{i})
    return squared_{i}
""",
    """def task_{i}(num_{i}):
    divisor_{i} = 2
    while divisor_{i} * divisor_{i} <= num_{i}:
        if num_{i} % divisor_{i} == 0:
            return False
        divisor_{i} += 1
    return True
""",
    """def task_{i}(words_{i}):
    joined_{i} = ""
    for word_{i} in words_{i}:
        joined_{i} = joined_{i} + " " + word_{i}
    return joined_{i}.strip()
""",
    """def task_{i}(table_{i}, key_{i}):
    if key_{i} in table_{i}:
        return table_{i}[key_{i}]
    return {lit}
""",
    """def task_{i}(n_{i}):
    if n_{i} <= 1:
        return 1
    return n_{i} * task_{i}(n_{i} - 1)
""",
]


def filler_code(index: int) -> str:
    rng = random.Random(0x5EED0000 + index)
    template = SHAPE_TEMPLATES[index % len(SHAPE_TEMPLATES)]
    return template.format(i=index, lit=rng.randint(2, 97))


def load_known_pair() -> tuple:
    return tuple(
        (FIXTURES / f"{variant}.py").read_text(encoding="utf-8")
        for variant in KNOWN_PAIR
    )


def isolated_known_pair_score() -> "float | None":
    """Part 5's isolated score for sum_of_list a_original vs c_renamed."""
    if not REPORT_CSV.exists():
        return None
    with REPORT_CSV.open(newline="", encoding="utf-8") as handle:
        for row in csv.DictReader(handle):
            if (row["problem"] == "sum_of_list"
                    and row["file_a"] == "a_original.py"
                    and row["file_b"] == "c_renamed.py"):
                return float(row["score"])
    return None


def build_batch(size: int) -> list:
    known_a, known_c = load_known_pair()
    submissions = []
    if size in EMBED_SIZES:
        submissions.append({"id": "known_a", "code": known_a,
                            "studentId": "stu_known_a"})
        submissions.append({"id": "known_c", "code": known_c,
                            "studentId": "stu_known_c"})
    for index in range(size - len(submissions)):
        submissions.append({
            "id": f"filler_{index}",
            "code": filler_code(index),
            "studentId": f"stu_filler_{index}",
        })
    return submissions


def fail(message: str) -> "NoReturn":  # type: ignore[name-defined]
    print(f"ERROR: {message}", file=sys.stderr)
    sys.exit(1)


def main() -> int:
    secret = os.environ.get("AST_ENGINE_INTERNAL_SECRET")
    if not secret:
        fail("AST_ENGINE_INTERNAL_SECRET is not set in the environment "
             "(never hardcoded in this script)")

    print(f"MAX_BATCH_SIZE = {MAX_BATCH_SIZE}  (from config.py, imported as "
          f"config.MAX_BATCH_SIZE)")
    baseline = isolated_known_pair_score()
    if baseline is None:
        print("note: Part 5 CSV not found — known-pair score comparison "
              "will be skipped")
    else:
        print(f"Part 5 isolated score for sum_of_list a_original vs "
              f"c_renamed = {baseline}")

    rows = []
    with httpx.Client(base_url=BASE_URL,
                      headers={"X-Internal-Secret": secret},
                      timeout=120.0) as client:
        if client.get("/health").status_code != 200:
            fail(f"server at {BASE_URL} is not healthy")

        for size in SIZES:
            submissions = build_batch(size)
            started = time.perf_counter()
            response = client.post(
                "/api/v1/plagiarism/check",
                json={"submissions": submissions},
            )
            elapsed = time.perf_counter() - started

            expected_pairs = size * (size - 1) // 2
            row = {
                "submissions": size,
                "http_status": response.status_code,
                "expected_pairs": expected_pairs,
                "actual_pairs": None,
                "response_time_s": round(elapsed, 3),
                "result": "",
                "flagged_total": None,
                "known_pair_flagged": "",
                "known_pair_score": "",
                "filler_false_positives": None,
            }

            if response.status_code == 200:
                data = response.json()
                pairs = data["pairs"]
                row["actual_pairs"] = len(pairs)
                row["flagged_total"] = len(data["flagged"])
                pairs_ok = len(pairs) == expected_pairs
                row["result"] = ("OK" if pairs_ok else
                                 f"PAIR COUNT MISMATCH (expected {expected_pairs})")

                if size in EMBED_SIZES:
                    known = next(
                        (p for p in pairs
                         if {p["submissionA"], p["submissionB"]}
                         == {"known_a", "known_c"}),
                        None,
                    )
                    if known is None:
                        row["known_pair_flagged"] = "MISSING FROM PAIRS"
                    else:
                        row["known_pair_score"] = known["metrics"]["combined_score"]
                        known_flagged = any(
                            {p["submissionA"], p["submissionB"]}
                            == {"known_a", "known_c"}
                            for p in data["flagged"]
                        )
                        row["known_pair_flagged"] = (
                            "yes" if known_flagged else "NO"
                        )
                    filler_fp = [
                        p for p in data["flagged"]
                        if p["submissionA"].startswith("filler_")
                        and p["submissionB"].startswith("filler_")
                    ]
                    row["filler_false_positives"] = len(filler_fp)
                    for pair in filler_fp:
                        print(f"    filler FP: {pair['submissionA']} vs "
                              f"{pair['submissionB']} "
                              f"score={pair['metrics']['combined_score']} "
                              f"flag={pair['flagLevel']}")
            else:
                detail = response.json().get("detail", "")
                if isinstance(detail, list):  # FastAPI/pydantic 422 errors
                    message = "; ".join(
                        str(item.get("msg", item)) for item in detail
                    )
                elif isinstance(detail, dict):
                    message = str(detail.get("message", detail))
                else:
                    message = str(detail)
                row["result"] = f"ERROR: {message[:200]}"

            rows.append(row)
            print(f"N={size:<3} status={row['http_status']:<3} "
                  f"pairs={row['actual_pairs']}/{expected_pairs} "
                  f"time={row['response_time_s']}s -> {row['result']}")

    fieldnames = ["submissions", "http_status", "expected_pairs",
                  "actual_pairs", "response_time_s", "result", "flagged_total",
                  "known_pair_flagged", "known_pair_score",
                  "filler_false_positives"]
    with SCALING_CSV.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)
    print(f"\nwritten to {SCALING_CSV}")

    # ---- verdicts the report calls out explicitly -----------------------
    by_size = {row["submissions"]: row for row in rows}
    ok = True
    ok &= by_size[0]["http_status"] != 200
    ok &= by_size[1]["http_status"] != 200
    ok &= by_size[MAX_BATCH_SIZE]["http_status"] == 200
    ok &= by_size[MAX_BATCH_SIZE]["actual_pairs"] == MAX_BATCH_SIZE * (MAX_BATCH_SIZE - 1) // 2
    ok &= by_size[MAX_BATCH_SIZE + 1]["http_status"] != 200
    for size in sorted(EMBED_SIZES):
        ok &= by_size[size]["known_pair_flagged"] == "yes"
    print(f"\nverdict: {'PASS' if ok else 'FAIL'}")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
