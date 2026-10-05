"""
Part 1: golden test set — known pairs with known expected direction.

(a) exact copy-paste            -> near-maximum similarity
(b) renamed vars + reformatting -> close to (a)   [cosmetic-rewriting detection]
(c) safe statement reordering   -> REPORT actual score (judgment call)
(d) different algorithm         -> LOW despite same problem
(e) unrelated short programs    -> LOW
(f) independent trivial answers -> REPORT actual score (judgment call)
(g) gap between (b) and (f)     -> REPORT the engine's safety margin
(h) blank / near-empty          -> LOW  (end-to-end proof of the Step 0 fix)

Judgment-call cases (c), (f), (g) only assert bounds and print the real
numbers; nothing is tuned toward a preferred score.
"""
import pytest

from parser.ast_builder import parse_code
from comparator.comparator import compare
from comparator.batch_runner import run_batch, _determine_flag_level


# --------------------------------------------------------------------------- #
# Golden snippets
# --------------------------------------------------------------------------- #

# (a)/(b)/(c) all solve the same problem: word frequency counting.
EXACT_COPY = """def count_words(text):
    counts = {}
    words = text.split()
    for word in words:
        if word in counts:
            counts[word] += 1
        else:
            counts[word] = 1
    return counts
"""

# (b) same logic, every identifier renamed, reformatting + comments changed
RENAMED_REFORMATTED = '''def word_frequencies(input_string):
    # build a frequency table
    tally    =   {}
    tokens   =   input_string.split()

    for token in tokens:
        if token in tally:
            tally[token] += 1
        else:
            tally[token] = 1
    return tally
'''

# (c) same identifiers/operators, two independent statements swapped
REORDERED = """def count_words(text):
    words = text.split()
    counts = {}
    for word in words:
        if word in counts:
            counts[word] += 1
        else:
            counts[word] = 1
    return counts
"""

# (d) same problem (binary search), genuinely different algorithm
RECURSIVE_ALGO = """def binary_search(nums, target):
    def helper(lo, hi):
        if lo > hi:
            return -1
        mid = (lo + hi) // 2
        if nums[mid] == target:
            return mid
        if nums[mid] < target:
            return helper(mid + 1, hi)
        return helper(lo, mid - 1)
    return helper(0, len(nums) - 1)
"""

ITERATIVE_ALGO = """def search(items, value):
    low = 0
    high = len(items) - 1
    while low <= high:
        middle = (low + high) // 2
        if items[middle] == value:
            return middle
        elif items[middle] < value:
            low = middle + 1
        else:
            high = middle - 1
    return -1
"""

# (e) two completely unrelated short programs
UNRELATED_A = """import os
print(os.getcwd())
"""
UNRELATED_B = """for i in range(3):
    print("hi")
"""

# (f) two independently written trivial solutions to "add two numbers"
TRIVIAL_A = "def add(a, b):\n    return a + b\n"
TRIVIAL_B = "def sum_two(x, y):\n    return x + y\n"

# (h) blank / near-empty submissions
BLANK = ""
NEAR_EMPTY = "   \n\t\n   \n"
COMMENT_ONLY = "# nothing to see here\n# still nothing\n"
COMMENT_ONLY_OTHER = "# a completely different comment\n"


def metrics(code_a: str, code_b: str) -> dict:
    return compare(parse_code(code_a, "python"), parse_code(code_b, "python"))


def flag_level(code_a: str, code_b: str) -> str:
    return _determine_flag_level(metrics(code_a, code_b))


def report(label: str, result: dict, flag: str) -> None:
    print(f"\n[Part 1{label}] combined={result['combined_score']} flag={flag} "
          f"metrics={result}")


# --------------------------------------------------------------------------- #
# Cases
# --------------------------------------------------------------------------- #

class TestGoldenCases:

    def test_a_exact_copy_near_maximum(self):
        result = metrics(EXACT_COPY, EXACT_COPY)
        flag = _determine_flag_level(result)
        report("a exact copy-paste", result, flag)
        assert result["combined_score"] >= 0.99
        assert result["cosine_similarity"] == 1.0
        assert result["ted_score"] == 1.0
        assert flag == "high"

    def test_b_renamed_and_reformatted_close_to_a(self):
        exact = metrics(EXACT_COPY, EXACT_COPY)
        renamed = metrics(EXACT_COPY, RENAMED_REFORMATTED)
        flag = _determine_flag_level(renamed)
        report("b renamed+reformatted", renamed, flag)
        # cosmetic rewriting must still be caught
        assert flag == "high"
        assert renamed["combined_score"] >= 0.75
        # and it should land near the exact-copy score
        assert exact["combined_score"] - renamed["combined_score"] <= 0.3
        # renaming moves exactly the identifier metric
        assert renamed["identifier_overlap"] < 1.0

    def test_c_reordered_statements_report_actual(self):
        result = metrics(EXACT_COPY, REORDERED)
        flag = _determine_flag_level(result)
        report("c reordered (judgment call)", result, flag)
        # no target score is assumed — only that it is a sane bounded number
        for name, value in result.items():
            assert 0.0 <= value <= 1.0, f"{name}={value}"

    def test_d_different_algorithm_low(self):
        result = metrics(RECURSIVE_ALGO, ITERATIVE_ALGO)
        flag = _determine_flag_level(result)
        report("d different algorithm", result, flag)
        # solving the same problem with a different algorithm must never be
        # treated as a strong match
        assert flag in ("none", "low"), flag
        assert result["combined_score"] < 0.7

    def test_e_unrelated_programs_low(self):
        result = metrics(UNRELATED_A, UNRELATED_B)
        flag = _determine_flag_level(result)
        report("e unrelated programs", result, flag)
        assert flag == "none"
        assert result["combined_score"] < 0.5

    def test_f_independent_trivial_solutions_report_actual(self):
        result = metrics(TRIVIAL_A, TRIVIAL_B)
        flag = _determine_flag_level(result)
        report("f independent trivial pair (judgment call)", result, flag)
        for name, value in result.items():
            assert 0.0 <= value <= 1.0, f"{name}={value}"

    def test_g_safety_margin_between_b_and_f(self):
        b = metrics(EXACT_COPY, RENAMED_REFORMATTED)
        f = metrics(TRIVIAL_A, TRIVIAL_B)
        gap = round(abs(b["combined_score"] - f["combined_score"]), 4)
        print(f"\n[Part 1g] (b) renamed-copy={b['combined_score']}  "
              f"(f) independent-trivial={f['combined_score']}  gap={gap}")
        assert 0.0 <= gap <= 1.0

    def test_h_blank_and_near_empty_low(self):
        blank = metrics(BLANK, BLANK)
        blank_flag = _determine_flag_level(blank)
        report("h blank vs blank", blank, blank_flag)
        # Step 0: two blank submissions must never look identical
        assert blank["identifier_overlap"] == 0.0
        assert blank["operator_overlap"] == 0.0
        assert blank["combined_score"] <= 0.35
        assert blank_flag == "none"

        near = metrics(NEAR_EMPTY, NEAR_EMPTY)
        near_flag = _determine_flag_level(near)
        report("h whitespace-only vs whitespace-only", near, near_flag)
        assert near["identifier_overlap"] == 0.0
        assert near["operator_overlap"] == 0.0
        assert near["combined_score"] <= 0.35
        assert near_flag == "none"

        mixed = metrics(BLANK, NEAR_EMPTY)
        mixed_flag = _determine_flag_level(mixed)
        report("h blank vs near-empty", mixed, mixed_flag)
        assert mixed["combined_score"] <= 0.35
        assert mixed_flag == "none"

        # comment-only submissions are "near-empty" too: they parse to an
        # empty Module, which must not read as structural evidence
        comments = metrics(COMMENT_ONLY, COMMENT_ONLY_OTHER)
        comments_flag = _determine_flag_level(comments)
        report("h comment-only vs other comment-only", comments, comments_flag)
        assert comments["cosine_similarity"] == 0.0
        assert comments["combined_score"] <= 0.35
        assert comments_flag == "none"

        # `pass`-only and docstring-only stubs are near-empty as well
        stub_a = metrics("pass\n", "pass\n")
        stub_b = metrics('"""my solution"""\n', '"""a different stub"""\n')
        report("h pass-only vs pass-only", stub_a, _determine_flag_level(stub_a))
        report("h docstring-only vs docstring-only", stub_b,
               _determine_flag_level(stub_b))
        for stub in (stub_a, stub_b):
            assert stub["combined_score"] <= 0.35, stub
            assert _determine_flag_level(stub) == "none"

    def test_h_blank_through_batch_endpoint_path(self):
        """The same low score must survive run_batch (the API's code path)."""
        result = run_batch([
            {"id": "blank1", "code": BLANK, "studentId": "s1"},
            {"id": "blank2", "code": NEAR_EMPTY, "studentId": "s2"},
        ])
        pair = result["pairs"][0]
        print(f"\n[Part 1h via run_batch] metrics={pair['metrics']} "
              f"flag={pair['flagLevel']}")
        assert pair["flagLevel"] == "none"
        assert pair["metrics"]["combined_score"] <= 0.35
        assert result["flagged"] == []
