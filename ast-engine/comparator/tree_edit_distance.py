"""
Tree edit distance: normalized edit-distance similarity over AST node-type
sequences (an approximation of ordered tree edit distance).
"""
from typing import Dict, List


def sequence_edit_similarity(seq_a: List[str], seq_b: List[str]) -> float:
    """
    Normalized Levenshtein-style edit-distance similarity between two
    sequences, in [0.0, 1.0]. 1.0 = identical, 0.0 = completely different
    (or one side empty while the other is not).
    """
    if not seq_a and not seq_b:
        return 1.0
    if not seq_a or not seq_b:
        return 0.0

    n, m = len(seq_a), len(seq_b)
    prev = list(range(m + 1))
    for i in range(1, n + 1):
        curr = [i] + [0] * m
        for j in range(1, m + 1):
            cost = 0 if seq_a[i - 1] == seq_b[j - 1] else 1
            curr[j] = min(
                prev[j] + 1,      # deletion
                curr[j - 1] + 1,  # insertion
                prev[j - 1] + cost,  # substitution
            )
        prev = curr

    dist = prev[m]
    similarity = 1.0 - (dist / max(n, m))
    return _clamp01(similarity)


def structural_similarity(parsed_a: dict, parsed_b: dict) -> float:
    """
    Compute structural similarity based on AST node-type sequences of two
    parsed feature dicts.
    """
    return sequence_edit_similarity(parsed_a["node_types"], parsed_b["node_types"])


def _clamp01(value: float) -> float:
    if value < 0.0:
        return 0.0
    if value > 1.0:
        return 1.0
    return value
