"""Similarity scoring: cosine, Jaccard, and the combined score."""
import math
from collections import Counter
from typing import List

COMBINED_WEIGHTS = {
    "cosine": 0.4,
    "ted": 0.3,
    "identifier": 0.2,
    "operator": 0.1,
}


def clamp01(value: float) -> float:
    """Clamp a metric into the inclusive range [0, 1]."""
    if value < 0.0:
        return 0.0
    if value > 1.0:
        return 1.0
    if math.isnan(value):
        return 0.0
    return value


def cosine_similarity(tokens_a: List[str], tokens_b: List[str]) -> float:
    """Compute cosine similarity between two token lists, in [0, 1]."""
    if not tokens_a or not tokens_b:
        return 0.0

    counter_a = Counter(tokens_a)
    counter_b = Counter(tokens_b)

    all_tokens = set(counter_a.keys()) | set(counter_b.keys())

    dot_product = sum(counter_a.get(t, 0) * counter_b.get(t, 0) for t in all_tokens)
    magnitude_a = math.sqrt(sum(v ** 2 for v in counter_a.values()))
    magnitude_b = math.sqrt(sum(v ** 2 for v in counter_b.values()))

    if magnitude_a == 0 or magnitude_b == 0:
        return 0.0

    return clamp01(dot_product / (magnitude_a * magnitude_b))


def jaccard_similarity(set_a: List[str], set_b: List[str]) -> float:
    """Compute Jaccard similarity between two lists, in [0, 1]."""
    a = set(set_a)
    b = set(set_b)

    # Any empty input scores 0.0 — matches cosine_similarity's behavior.
    # Two empty inputs are NOT evidence of similarity (two blank submissions
    # must never score as "identical").
    if not a or not b:
        return 0.0

    intersection = a & b
    union = a | b

    return clamp01(len(intersection) / len(union))


def combined_score(
    cosine: float,
    ted: float,
    identifier_overlap: float,
    operator_overlap: float,
) -> float:
    """Weighted combination of the four metrics (weights sum to 1.0)."""
    return clamp01(
        COMBINED_WEIGHTS["cosine"] * cosine
        + COMBINED_WEIGHTS["ted"] * ted
        + COMBINED_WEIGHTS["identifier"] * identifier_overlap
        + COMBINED_WEIGHTS["operator"] * operator_overlap
    )
