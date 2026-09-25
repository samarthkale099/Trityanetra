from typing import List, Dict, Any, Optional
from comparator.ast_parser import parse_code
from comparator.comparator import compare
from comparator.prefilter import should_compare
from config import (
    COSINE_SIMILARITY_LOW, COSINE_SIMILARITY_MEDIUM, COSINE_SIMILARITY_HIGH,
    TED_THRESHOLD_LOW, TED_THRESHOLD_MEDIUM, TED_THRESHOLD_HIGH,
    MAX_BATCH_SIZE, BATCH_TIMEOUT_SECONDS,
)
import time


class BatchRunError(Exception):
    """Error during batch processing."""
    pass


class BatchRunTimeout(BatchRunError):
    """Batch processing timed out."""
    pass


class BatchRunValidationError(BatchRunError):
    """Input validation failed."""
    pass


def run_batch(submissions: List[Dict[str, Any]]) -> Dict[str, Any]:
    """
    Process a batch of submissions and detect plagiarism pairs.
    
    Args:
        submissions: List of dicts with keys:
          - id: submission ID
          - code: source code string
          - language: programming language (default: python)
          - studentId: student identifier
    
    Returns:
      - pairs: list of comparison results for all pairs
      - flagged: list of pairs that exceed the plagiarism threshold
      - summary: aggregate statistics
    
    Errors:
      - BatchRunValidationError: if submissions list is empty or exceeds MAX_BATCH_SIZE
      - BatchRunTimeout: if processing exceeds BATCH_TIMEOUT_SECONDS
    """
    start_time = time.time()
    
    # Validate input
    if not submissions:
        raise BatchRunValidationError("Submissions list is empty")
    
    if len(submissions) > MAX_BATCH_SIZE:
        raise BatchRunValidationError(
            f"Batch size {len(submissions)} exceeds maximum {MAX_BATCH_SIZE}"
        )
    
    # Parse all submissions
    parsed = []
    for sub in submissions:
        if not sub.get("id"):
            raise BatchRunValidationError("Each submission must have an 'id'")

        if "code" not in sub:
            raise BatchRunValidationError("Each submission must have a 'code'")

        language = sub.get("language", "python")
        code = sub.get("code", "")
        try:
            parsed_features = parse_code(code, language) if code else {
                "node_types": [],
                "identifiers": [],
                "operators": [],
                "depth": 0,
                "line_count": 0,
                "token_count": 0,
            }
        except Exception as e:
            # Handle parse errors gracefully — use empty features
            parsed_features = {
                "node_types": [],
                "identifiers": [],
                "operators": [],
                "depth": 0,
                "line_count": 0,
                "token_count": 0,
            }
        
        parsed.append({
            "id": sub["id"],
            "studentId": sub.get("studentId", ""),
            "features": parsed_features,
        })
    
    # Compare all pairs (O(n^2) but bounded by MAX_BATCH_SIZE)
    pairs = []
    flagged = []
    
    for i in range(len(parsed)):
        for j in range(i + 1, len(parsed)):
            # Check timeout
            if time.time() - start_time > BATCH_TIMEOUT_SECONDS:
                raise BatchRunTimeout(
                    f"Batch processing timed out after {BATCH_TIMEOUT_SECONDS}s"
                )
            
            a = parsed[i]
            b = parsed[j]
            
            # Prefilter: skip self-comparisons (same student)
            if not should_compare(a["studentId"], b["studentId"]):
                continue
            
            metrics = compare(a["features"], b["features"])
            
            pair_result = {
                "submissionA": a["id"],
                "submissionB": b["id"],
                "metrics": metrics,
                "flagLevel": _determine_flag_level(metrics),
            }
            
            pairs.append(pair_result)
            
            if pair_result["flagLevel"] != "none":
                flagged.append(pair_result)
    
    elapsed = time.time() - start_time
    
    return {
        "pairs": pairs,
        "flagged": flagged,
        "summary": {
            "totalSubmissions": len(submissions),
            "totalPairs": len(pairs),
            "flaggedPairs": len(flagged),
            "processingTimeMs": round(elapsed * 1000, 2),
        },
    }


def _determine_flag_level(metrics: Dict[str, float]) -> str:
    """
    Determine the plagiarism flag level from similarity metrics.

    Uses a composition of cosine similarity (token-level) and TED score
    (structural). A level is only reached when both metrics agree, or the
    combined score is decisive, to avoid false positives from either metric
    firing on its own:
    - high:  cosine >= HIGH and ted >= LOW, or combined >= 0.85
    - medium: cosine >= MEDIUM and ted >= LOW, or combined >= 0.7
    - low:   cosine >= LOW and ted >= LOW, or combined >= 0.5
    - none: below all thresholds
    """
    cosine = metrics["cosine_similarity"]
    ted = metrics["ted_score"]
    combined = metrics["combined_score"]

    # High: strong agreement between both metrics, or decisive combined score
    if (cosine >= COSINE_SIMILARITY_HIGH and ted >= TED_THRESHOLD_LOW) or combined >= 0.85:
        return "high"

    # Medium: moderate agreement between both metrics
    if (cosine >= COSINE_SIMILARITY_MEDIUM and ted >= TED_THRESHOLD_LOW) or combined >= 0.7:
        return "medium"

    # Low: weak but consistent agreement between both metrics
    if (cosine >= COSINE_SIMILARITY_LOW and ted >= TED_THRESHOLD_LOW) or combined >= 0.5:
        return "low"

    return "none"
