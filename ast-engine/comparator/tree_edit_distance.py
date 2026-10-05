"""
Tree edit distance: normalized edit-distance similarity over AST node-type
sequences (an approximation of ordered tree edit distance).
"""
import math
from typing import Dict, List

try:  # Optional accelerator: exact Levenshtein in C. Pure-Python DP below is
    # the fallback when the compiled wheel is unavailable.
    from rapidfuzz.distance import Levenshtein as _RapidLevenshtein
except Exception:  # pragma: no cover - environment dependent
    _RapidLevenshtein = None

# Above this many DP cells the C implementation is used when available.
_RAPIDFUZZ_MIN_CELLS = 50_000
# Pure-Python DP budget. Beyond this (and without rapidfuzz) the sequences are
# deterministically subsampled so a pair of multi-thousand-line files can never
# hang the service.
_MAX_DP_CELLS = 2_000_000


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
    if seq_a == seq_b:
        return 1.0

    dist = edit_distance(seq_a, seq_b)
    similarity = 1.0 - (dist / max(len(seq_a), len(seq_b)))
    return _clamp01(similarity)


def edit_distance(seq_a: List[str], seq_b: List[str]) -> int:
    """
    Levenshtein distance between two sequences of strings.

    Uses the rapidfuzz C implementation for large inputs (exact same result as
    the pure-Python DP), and a bounded, deterministic subsampled DP as a last
    resort so large inputs can never hang.
    """
    n, m = len(seq_a), len(seq_b)

    if _RapidLevenshtein is not None and n * m >= _RAPIDFUZZ_MIN_CELLS:
        str_a, str_b = _encode_symbols(seq_a, seq_b)
        return _RapidLevenshtein.distance(str_a, str_b)

    if n * m > _MAX_DP_CELLS:
        limit = max(1, int(math.sqrt(_MAX_DP_CELLS)))
        seq_a = _even_subsample(seq_a, limit)
        seq_b = _even_subsample(seq_b, limit)

    return _edit_distance_dp(seq_a, seq_b)


def _encode_symbols(seq_a: List[str], seq_b: List[str]):
    """Map string sequences onto unique characters (exact symbol encoding)."""
    vocab: Dict[str, int] = {}

    def encode(seq: List[str]) -> str:
        chars = []
        for symbol in seq:
            index = vocab.get(symbol)
            if index is None:
                index = len(vocab)
                vocab[symbol] = index
            chars.append(chr(index))
        return "".join(chars)

    return encode(seq_a), encode(seq_b)


def _even_subsample(seq: List[str], limit: int) -> List[str]:
    """Deterministically keep <= limit evenly spaced elements."""
    if len(seq) <= limit:
        return seq
    step = len(seq) / limit
    return [seq[int(i * step)] for i in range(limit)]


def _edit_distance_dp(seq_a: List[str], seq_b: List[str]) -> int:
    """Classic two-row Levenshtein DP (pure Python)."""
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

    return prev[m]


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
