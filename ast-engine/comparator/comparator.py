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
    cosine = cosine_similarity(parsed_a["node_types"], parsed_b["node_types"])
    ted = structural_similarity(parsed_a, parsed_b)
    id_overlap = jaccard_similarity(parsed_a["identifiers"], parsed_b["identifiers"])
    op_overlap = jaccard_similarity(parsed_a["operators"], parsed_b["operators"])

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
