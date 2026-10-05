"""
Root-level engine tests (file architecture: test_engine.py at the root).

Covers the restructured modules directly:
  parser/ast_builder.py, parser/normalizer.py,
  comparator/prefilter.py, comparator/tree_edit_distance.py,
  comparator/scorer.py — plus shim and end-to-end checks.
"""
import pytest

from parser.ast_builder import parse_code
from parser.normalizer import normalize_identifiers, normalize_whitespace, is_builtin
from comparator.prefilter import should_compare
from comparator.tree_edit_distance import sequence_edit_similarity, structural_similarity
from comparator.scorer import cosine_similarity, jaccard_similarity, combined_score, clamp01
from comparator.comparator import compare
from comparator import ast_parser
from comparator.batch_runner import run_batch


class TestParserLayout:
    def test_parse_code_importable_from_spec_location(self):
        result = parse_code("x = 1", "python")
        assert result["node_types"]

    def test_legacy_ast_parser_shim_reexports_same_function(self):
        assert ast_parser.parse_code is parse_code

    def test_shim_and_direct_parse_agree(self):
        code = "def add(a, b):\n    return a + b"
        assert ast_parser.parse_code(code, "python") == parse_code(code, "python")


class TestNormalizer:
    def test_filters_builtins(self):
        names = ["print", "my_var", "len", "custom_func", ""]
        assert normalize_identifiers(names) == ["my_var", "custom_func"]

    def test_is_builtin(self):
        assert is_builtin("len")
        assert not is_builtin("my_custom_name")

    def test_normalize_whitespace(self):
        source = "x = 1   \n\ty = 2\t  \n"
        assert normalize_whitespace(source) == "x = 1\n\ty = 2"


class TestPrefilter:
    def test_same_student_excluded(self):
        assert should_compare("s1", "s1") is False

    def test_different_students_included(self):
        assert should_compare("s1", "s2") is True

    def test_empty_student_ids_still_compared(self):
        assert should_compare("", "") is True
        assert should_compare("s1", "") is True


class TestTreeEditDistance:
    def test_identical_sequences_score_one(self):
        assert sequence_edit_similarity(["a", "b", "c"], ["a", "b", "c"]) == 1.0

    def test_both_empty_scores_one(self):
        assert sequence_edit_similarity([], []) == 1.0

    def test_one_empty_scores_zero(self):
        assert sequence_edit_similarity([], ["a"]) == 0.0
        assert sequence_edit_similarity(["a"], []) == 0.0

    def test_disjoint_sequences_score_zero(self):
        assert sequence_edit_similarity(["a", "b"], ["x", "y"]) == 0.0

    def test_result_always_in_bounds(self):
        for a in ([], ["a"], ["a", "b", "c"], ["a"] * 20):
            for b in ([], ["x"], ["x", "y", "z"], ["b"] * 20):
                score = sequence_edit_similarity(a, b)
                assert 0.0 <= score <= 1.0

    def test_structural_similarity_uses_node_types(self):
        parsed = parse_code("def add(a, b):\n    return a + b", "python")
        assert structural_similarity(parsed, parsed) == 1.0


class TestScorer:
    def test_cosine_bounds(self):
        assert cosine_similarity([], ["a"]) == 0.0
        assert cosine_similarity(["a", "b"], ["a", "b"]) == pytest.approx(1.0)
        for value in [cosine_similarity(["a"], ["b"]), cosine_similarity(["a", "a"], ["b", "b"])]:
            assert 0.0 <= value <= 1.0

    def test_jaccard_bounds(self):
        assert jaccard_similarity([], []) == 0.0
        assert jaccard_similarity(["a"], []) == 0.0
        assert jaccard_similarity(["a"], ["a"]) == pytest.approx(1.0)
        assert jaccard_similarity(["a", "b"], ["b", "c"]) == pytest.approx(1 / 3)

    def test_combined_score_bounds_and_weights(self):
        assert combined_score(1.0, 1.0, 1.0, 1.0) == pytest.approx(1.0)
        assert combined_score(0.0, 0.0, 0.0, 0.0) == 0.0
        # Weighted mix stays in bounds
        value = combined_score(1.0, 0.0, 1.0, 0.0)
        assert value == pytest.approx(0.6)
        assert 0.0 <= value <= 1.0

    def test_clamp01(self):
        assert clamp01(-0.5) == 0.0
        assert clamp01(1.5) == 1.0
        assert clamp01(0.42) == 0.42
        assert clamp01(float("nan")) == 0.0


class TestCompareEndToEnd:
    def test_identical_code_scores_at_bounds(self):
        parsed = parse_code("def add(a, b):\n    return a + b", "python")
        metrics = compare(parsed, parsed)
        assert metrics["cosine_similarity"] == 1.0
        assert metrics["combined_score"] > 0.9
        for key, value in metrics.items():
            assert 0.0 <= value <= 1.0, f"{key}={value} out of [0,1]"

    def test_renamed_variables_still_high(self):
        a = parse_code("def add(x, y):\n    return x + y", "python")
        b = parse_code("def add(a, b):\n    return a + b", "python")
        metrics = compare(a, b)
        assert metrics["cosine_similarity"] > 0.8

    def test_run_batch_flag_levels_valid_enum(self):
        result = run_batch([
            {"id": "s1", "code": "def add(a, b):\n    return a + b", "studentId": "a"},
            {"id": "s2", "code": "def add(a, b):\n    return a + b", "studentId": "b"},
            {"id": "s3", "code": "import os\nprint(os.getcwd())", "studentId": "c"},
        ])
        assert result["summary"]["totalSubmissions"] == 3
        for pair in result["pairs"]:
            assert pair["flagLevel"] in ("none", "low", "medium", "high")
            for name, value in pair["metrics"].items():
                assert 0.0 <= value <= 1.0, f"{name}={value}"
