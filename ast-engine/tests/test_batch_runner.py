import pytest
from comparator.batch_runner import run_batch, BatchRunValidationError, BatchRunTimeout
from comparator.ast_parser import parse_code
from comparator.comparator import compare


class TestParseCode:
    """Tests for AST parser"""
    
    def test_parse_valid_python(self):
        code = "def add(a, b):\n    return a + b"
        result = parse_code(code, "python")
        assert "node_types" in result
        assert "identifiers" in result
        assert "operators" in result
        assert result["token_count"] > 0
        assert result["line_count"] == 2
    
    def test_parse_empty_code(self):
        result = parse_code("", "python")
        assert result["node_types"] == []
        assert result["identifiers"] == []
        assert result["token_count"] == 0
    
    def test_parse_syntax_error(self):
        result = parse_code("def (broken", "python")
        # Should fall back to generic parsing
        assert result is not None
    
    def test_parse_generic_language(self):
        result = parse_code("int x = 5;", "c")
        assert "node_types" in result
        assert result["node_types"] == ["generic"]


class TestCompare:
    """Tests for comparator"""
    
    def test_identical_structures(self):
        parsed = parse_code("def add(a, b):\n    return a + b", "python")
        result = compare(parsed, parsed)
        assert result["cosine_similarity"] == 1.0
        assert result["combined_score"] > 0.9
    
    def test_different_structures(self):
        a = parse_code("def add(a, b):\n    return a + b", "python")
        b = parse_code("import os\nprint(os.getcwd())", "python")
        result = compare(a, b)
        assert result["cosine_similarity"] < 0.8
    
    def test_similar_structures(self):
        """Renamed variables should still show high similarity."""
        a = parse_code("def add(x, y):\n    return x + y", "python")
        b = parse_code("def add(a, b):\n    return a + b", "python")
        result = compare(a, b)
        # Structure is identical — should be high
        assert result["cosine_similarity"] > 0.8


class TestRunBatch:
    """Tests for batch runner"""
    
    def test_identical_submissions_flagged(self):
        code = "def add(a, b):\n    return a + b"
        result = run_batch([
            {"id": "sub1", "code": code, "studentId": "s1"},
            {"id": "sub2", "code": code, "studentId": "s2"},
        ])
        assert len(result["pairs"]) == 1
        assert result["pairs"][0]["flagLevel"] == "high"
        assert len(result["flagged"]) == 1
    
    def test_different_submissions_not_flagged(self):
        result = run_batch([
            {"id": "sub1", "code": "def add(a, b):\n    return a + b", "studentId": "s1"},
            {"id": "sub2", "code": "import os\nprint(os.getcwd())", "studentId": "s2"},
        ])
        assert len(result["pairs"]) == 1
        assert result["pairs"][0]["flagLevel"] == "none"
        assert len(result["flagged"]) == 0
    
    def test_same_student_excluded(self):
        code = "def add(a, b):\n    return a + b"
        result = run_batch([
            {"id": "sub1", "code": code, "studentId": "same"},
            {"id": "sub2", "code": code, "studentId": "same"},
        ])
        assert len(result["pairs"]) == 0
    
    def test_empty_list_raises_error(self):
        with pytest.raises(BatchRunValidationError):
            run_batch([])
    
    def test_missing_id_raises_error(self):
        with pytest.raises(BatchRunValidationError):
            run_batch([
                {"code": "x = 1", "studentId": "s1"},
                {"id": "sub2", "code": "y = 2", "studentId": "s2"},
            ])
    
    def test_missing_code_raises_error(self):
        with pytest.raises(BatchRunValidationError):
            run_batch([
                {"id": "sub1", "studentId": "s1"},
                {"id": "sub2", "code": "y = 2", "studentId": "s2"},
            ])
    
    def test_summary_stats(self):
        result = run_batch([
            {"id": "sub1", "code": "x = 1", "studentId": "s1"},
            {"id": "sub2", "code": "y = 2", "studentId": "s2"},
            {"id": "sub3", "code": "z = 3", "studentId": "s3"},
        ])
        assert result["summary"]["totalSubmissions"] == 3
        assert result["summary"]["totalPairs"] == 3
        assert "processingTimeMs" in result["summary"]
    
    def test_empty_code_handled(self):
        result = run_batch([
            {"id": "sub1", "code": "", "studentId": "s1"},
            {"id": "sub2", "code": "x = 1", "studentId": "s2"},
        ])
        assert len(result["pairs"]) == 1  # Should still produce a pair
    
    def test_syntax_error_handled(self):
        result = run_batch([
            {"id": "sub1", "code": "def (broken", "studentId": "s1"},
            {"id": "sub2", "code": "x = 1", "studentId": "s2"},
        ])
        assert len(result["pairs"]) == 1  # Should not crash
    
    def test_renamed_variables_high_similarity(self):
        """Renamed variables + reordered statements should be flagged."""
        a = "def add(a, b):\n    return a + b"
        b = "def sum(x, y):\n    return x + y"
        result = run_batch([
            {"id": "sub1", "code": a, "studentId": "s1"},
            {"id": "sub2", "code": b, "studentId": "s2"},
        ])
        assert len(result["pairs"]) == 1
        # Structure is nearly identical
        assert result["pairs"][0]["flagLevel"] in ["high", "medium"]
