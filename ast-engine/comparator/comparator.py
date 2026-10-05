"""
Compare two parsed code structures and return similarity metrics.

Thin orchestration layer over comparator.scorer and
comparator.tree_edit_distance. The original module surface (compare and the
_-prefixed helpers) is preserved so existing imports keep working.
"""
from typing import Dict, Any, List

from comparator.tree_edit_distance import structural_similarity, sequence_edit_similarity
from comparator.scorer import (
    cosine_similarity,
    jaccard_similarity,
    combined_score,
    clamp01,
)

GENERIC_NODE_TYPES = ["generic"]


def _structural_sequences(parsed: Dict[str, Any]):
    """
    Sequences fed to cosine/TED: (sequences, is_generic_placeholder).

    When structural extraction was impossible (invalid Python syntax or a
    non-Python language) the parser reports the placeholder node type
    ["generic"].  A single shared placeholder is NOT evidence of similarity —
    it made any two unrelated broken programs score as near-identical — so in
    that case the raw token streams are compared instead.
    """
    if parsed["node_types"] != GENERIC_NODE_TYPES:
        return parsed["node_types"], False
    return parsed.get("tokens") or [], True


def _has_content(parsed: Dict[str, Any]) -> bool:
    """
    True when a submission carries any vocabulary that could actually be
    copied: at least one (non-builtin) identifier or one operator.

    Blank, comment-only, `pass`-only and docstring-stub submissions have
    neither.  Their tiny identical structure (a bare Module, Module+Pass, ...)
    is not evidence of plagiarism — two different empty stubs must never be
    reported as a high-confidence match.
    """
    return bool(parsed["identifiers"]) or bool(parsed["operators"])


def compare(
    parsed_a: Dict[str, Any],
    parsed_b: Dict[str, Any],
) -> Dict[str, Any]:
    """
    Compare two parsed code structures and return similarity metrics.

    Returns:
      - cosine_similarity: 0.0 to 1.0 (higher = more similar)
      - ted_score: 0.0 to 1.0 (higher = more similar, based on structural distance)
      - identifier_overlap: fraction of shared identifiers
      - operator_overlap: fraction of shared operators
      - combined_score: weighted combination of metrics

    Every returned metric is clamped to [0.0, 1.0].
    """
    if not _has_content(parsed_a) or not _has_content(parsed_b):
        # No content to compare: every metric is 0.0. This keeps
        # "self-comparison is the maximum" true for empty submissions too,
        # because comparing an empty submission with anything else is 0.0.
        cosine, ted, id_overlap, op_overlap = 0.0, 0.0, 0.0, 0.0
    else:
        seq_a, generic_a = _structural_sequences(parsed_a)
        seq_b, generic_b = _structural_sequences(parsed_b)

        if generic_a != generic_b or (generic_a and (not seq_a or not seq_b)):
            # One side has real structure and the other only a placeholder
            # (or a generic side produced no usable tokens): structural
            # metrics are undefined — they score 0.0 rather than being
            # inflated by the placeholder.
            cosine, ted = 0.0, 0.0
        else:
            cosine = cosine_similarity(seq_a, seq_b)
            ted = sequence_edit_similarity(seq_a, seq_b)

        id_overlap = jaccard_similarity(parsed_a["identifiers"],
                                        parsed_b["identifiers"])
        op_overlap = jaccard_similarity(parsed_a["operators"],
                                        parsed_b["operators"])

    combined = combined_score(cosine, ted, id_overlap, op_overlap)

    return {
        "cosine_similarity": round(clamp01(cosine), 4),
        "ted_score": round(clamp01(ted), 4),
        "identifier_overlap": round(clamp01(id_overlap), 4),
        "operator_overlap": round(clamp01(op_overlap), 4),
        "combined_score": round(clamp01(combined), 4),
    }


# Backwards-compatible private aliases (original module surface)
_cosine_similarity = cosine_similarity
_structural_similarity = structural_similarity
_sequence_similarity = sequence_edit_similarity
_jaccard_similarity = jaccard_similarity
