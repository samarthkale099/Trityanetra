"""
Part 2: property-based tests (hypothesis).

Invariants, each checked across 150 generated examples:
  (a) a snippet compared with itself always scores the maximum achievable
      score for that pair (self-score is an upper bound on any pair score)
  (b) compare(A, B) == compare(B, A)          — symmetry
  (c) every metric is in [0, 1], finite, never None/NaN
  (d) comparing the same input pair twice gives the same score — determinism

If hypothesis finds a counterexample, the fix belongs in the comparator/scorer
source — never in a weakened assertion.
"""
import ast
import math

import pytest
from hypothesis import given, settings, strategies as st

from parser.ast_builder import parse_code
from comparator.comparator import compare

NAMES = [
    "alpha", "beta", "gamma", "total", "count", "value", "items",
    "result", "index", "entry", "acc", "limit",
]
BIN_OPS = ["+", "-", "*", "//", "%"]
CMP_OPS = ["<", ">", "<=", ">=", "==", "!="]
MAX_DEPTH = 2
METRIC_NAMES = [
    "cosine_similarity", "ted_score", "identifier_overlap",
    "operator_overlap", "combined_score",
]


def _name(draw) -> str:
    return draw(st.sampled_from(NAMES))


def _spacing(draw) -> str:
    return draw(st.sampled_from([" ", "  "]))


def _expr(draw, depth: int = 0) -> str:
    kind = draw(st.sampled_from(
        ["int", "name", "binop", "cmp", "call", "paren"]
    ))
    if kind == "int":
        return str(draw(st.integers(-99, 99)))
    if kind == "name":
        return _name(draw)
    if kind == "binop":
        sp = _spacing(draw)
        return f"{_expr(draw, depth + 1)}{sp}{draw(st.sampled_from(BIN_OPS))}{sp}{_expr(draw, depth + 1)}"
    if kind == "cmp":
        sp = _spacing(draw)
        return f"{_expr(draw, depth + 1)}{sp}{draw(st.sampled_from(CMP_OPS))}{sp}{_expr(draw, depth + 1)}"
    if kind == "call":
        fn = draw(st.sampled_from(["len", "abs", "str", "round", "int"]))
        return f"{fn}({_expr(draw, depth + 1)})"
    return f"({_expr(draw, depth + 1)})"


def _condition(draw, depth: int = 0) -> str:
    kind = draw(st.sampled_from(
        ["cmp", "name", "not", "boolop"] if depth < MAX_DEPTH else ["cmp", "name"]
    ))
    if kind == "cmp":
        sp = _spacing(draw)
        return f"{_expr(draw, depth + 1)}{sp}{draw(st.sampled_from(CMP_OPS))}{sp}{_expr(draw, depth + 1)}"
    if kind == "name":
        return _name(draw)
    if kind == "not":
        return f"not {_name(draw)}"
    joiner = draw(st.sampled_from([" and ", " or "]))
    return f"{_name(draw)}{joiner}{_name(draw)}"


@st.composite
def _statement(draw, indent: int = 0, depth: int = 0):
    """One logical statement (possibly multi-line), already indented."""
    pad = "    " * indent
    kinds = ["assign", "augassign", "call_stmt", "pass_stmt"]
    if depth < MAX_DEPTH:
        kinds += ["if", "for", "while", "def"]
    kind = draw(st.sampled_from(kinds))

    if kind == "assign":
        sp = _spacing(draw)
        return [f"{pad}{_name(draw)}{sp}={sp}{_expr(draw, depth)}"]
    if kind == "augassign":
        sp = _spacing(draw)
        op = draw(st.sampled_from(BIN_OPS))
        return [f"{pad}{_name(draw)}{sp}{op}={sp}{_expr(draw, depth)}"]
    if kind == "call_stmt":
        fn = draw(st.sampled_from(["print", "append", "update"]))
        return [f"{pad}{fn}({_expr(draw, depth)})"]
    if kind == "pass_stmt":
        return [f"{pad}pass"]

    if kind == "if":
        body = draw(_block(indent + 1, depth + 1))
        lines = [f"{pad}if {_condition(draw, depth)}:"] + body
        if draw(st.booleans()):
            other = draw(_block(indent + 1, depth + 1))
            lines += [f"{pad}else:"] + other
        return lines
    if kind == "for":
        body = draw(_block(indent + 1, depth + 1))
        return [f"{pad}for {_name(draw)} in {_expr(draw, depth)}:"] + body
    if kind == "while":
        body = draw(_block(indent + 1, depth + 1))
        return [f"{pad}while {_condition(draw, depth)}:"] + body

    # def
    n_params = draw(st.integers(0, 3))
    params = ", ".join(_name(draw) for _ in range(n_params))
    body = draw(_block(indent + 1, depth + 1, allow_return=True))
    return [f"{pad}def {draw(st.sampled_from(NAMES))}({params}):"] + body


@st.composite
def _block(draw, indent: int = 0, depth: int = 0, allow_return: bool = False):
    """A non-empty block body (a comment-only block is a syntax error)."""
    lines = []
    if allow_return and draw(st.booleans()):
        lines.append(f"{'    ' * indent}return {_expr(draw, depth)}")
    n_real = draw(st.integers(1, 3))
    for _ in range(n_real):
        lines += draw(_statement(indent, depth))
    for _ in range(draw(st.integers(0, 2))):
        # comment or blank line — never a semantic change
        lines.append(draw(st.sampled_from(
            ["", "# a comment", f"# {_name(draw)}", "    # indented comment"]
        )))
    return lines


@st.composite
def python_snippet(draw):
    """A varied, syntactically valid Python program."""
    n = draw(st.integers(0, 6))
    lines = []
    for _ in range(n):
        if draw(st.sampled_from(["stmt", "stmt", "noise"])):
            lines += draw(_statement(0, 0))
        else:
            lines.append(draw(st.sampled_from(
                ["", "# comment", "    # leading indented comment"]
            )))
    if not lines:
        lines = [draw(st.sampled_from(["x = 1", "# only a comment", ""]))]
    return "\n".join(lines)


STRATEGY = python_snippet()
COMMON_SETTINGS = settings(max_examples=150, deadline=None)


def _metrics(code_a: str, code_b: str) -> dict:
    return compare(parse_code(code_a, "python"), parse_code(code_b, "python"))


class TestGeneratorValidity:
    @COMMON_SETTINGS
    @given(STRATEGY)
    def test_generated_snippets_are_valid_python(self, snippet: str):
        ast.parse(snippet)  # raises on invalid syntax -> test failure


class TestSelfIsMaximum:
    @COMMON_SETTINGS
    @given(STRATEGY)
    def test_self_comparison_hits_every_metrics_maximum(self, snippet: str):
        parsed = parse_code(snippet, "python")
        m = compare(parsed, parsed)

        has_content = bool(parsed["identifiers"]) or bool(parsed["operators"])
        if not has_content:
            # blank / comment-only / `pass` / docstring stub: no vocabulary
            # means no evidence — every metric must be 0.0 (never the
            # "both empty = identical" score)
            expected_cos = expected_ted = expected_id = expected_op = 0.0
        else:
            # cosine / TED of a sequence with itself is 1.0
            expected_cos = 1.0 if parsed["node_types"] else 0.0
            expected_ted = 1.0
            # jaccard of a set with itself is 1.0 unless empty (Step 0 fix)
            expected_id = 1.0 if parsed["identifiers"] else 0.0
            expected_op = 1.0 if parsed["operators"] else 0.0

        assert m["cosine_similarity"] == expected_cos
        assert m["ted_score"] == expected_ted
        assert m["identifier_overlap"] == expected_id
        assert m["operator_overlap"] == expected_op

        expected = round(
            0.4 * expected_cos
            + 0.3 * expected_ted
            + 0.2 * expected_id
            + 0.1 * expected_op,
            4,
        )
        assert abs(m["combined_score"] - expected) <= 0.0002

    @COMMON_SETTINGS
    @given(STRATEGY, STRATEGY)
    def test_self_score_is_an_upper_bound_for_any_pair(self, a: str, b: str):
        self_a = _metrics(a, a)["combined_score"]
        self_b = _metrics(b, b)["combined_score"]
        cross = _metrics(a, b)["combined_score"]
        # every metric of (a, b) is bounded by the same metric of (a, a) and
        # of (b, b), so the weighted combination is too (small rounding slack)
        assert cross <= min(self_a, self_b) + 0.0002


class TestSymmetry:
    @COMMON_SETTINGS
    @given(STRATEGY, STRATEGY)
    def test_compare_is_symmetric(self, a: str, b: str):
        assert _metrics(a, b) == _metrics(b, a)


class TestBounds:
    @COMMON_SETTINGS
    @given(STRATEGY, STRATEGY)
    def test_every_metric_in_unit_interval_and_finite(self, a: str, b: str):
        result = _metrics(a, b)
        for name in METRIC_NAMES:
            value = result[name]
            assert value is not None, name
            assert isinstance(value, (int, float)), name
            assert math.isfinite(value), f"{name}={value} is NaN/inf"
            assert 0.0 <= value <= 1.0, f"{name}={value} outside [0, 1]"
        # combined really is the documented weighted combination
        expected = round(
            0.4 * result["cosine_similarity"]
            + 0.3 * result["ted_score"]
            + 0.2 * result["identifier_overlap"]
            + 0.1 * result["operator_overlap"],
            4,
        )
        assert abs(result["combined_score"] - expected) <= 0.0002


class TestDeterminism:
    @COMMON_SETTINGS
    @given(STRATEGY, STRATEGY)
    def test_same_pair_compared_twice_gives_same_score(self, a: str, b: str):
        first = _metrics(a, b)
        second = _metrics(a, b)
        assert first == second
        assert _metrics(b, a) == first
