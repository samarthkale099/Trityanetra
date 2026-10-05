from typing import List, Dict, Any, Optional
from comparator.ast_parser import parse_code
from comparator.comparator import compare
from comparator.prefilter import should_compare
from config import (
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
    seen_ids = set()
    for sub in submissions:
        if not sub.get("id"):
            raise BatchRunValidationError(
                "Each submission must have a non-empty 'id'"
            )

        sub_id = sub["id"]
        if sub_id in seen_ids:
            raise BatchRunValidationError(
                f"Duplicate submission id: '{sub_id}'"
            )
        seen_ids.add(sub_id)

        if "code" not in sub:
            raise BatchRunValidationError(
                f"Submission '{sub_id}' is missing required field 'code'"
            )

        code = sub["code"]
        if not isinstance(code, str):
            raise BatchRunValidationError(
                f"Submission '{sub_id}' field 'code' must be a string, "
                f"got {type(code).__name__}"
            )

        language = sub.get("language", "python")
        if not isinstance(language, str):
            raise BatchRunValidationError(
                f"Submission '{sub_id}' field 'language' must be a string, "
                f"got {type(language).__name__}"
            )
        try:
            parsed_features = parse_code(code, language) if code else {
                "node_types": [],
                "identifiers": [],
                "operators": [],
                "tokens": [],
                "depth": 0,
                "line_count": 0,
                "token_count": 0,
            }
        except Exception:
            # Last-resort guard (e.g. MemoryError on pathological input):
            # parse_code already handles syntax errors and null bytes itself.
            parsed_features = {
                "node_types": [],
                "identifiers": [],
                "operators": [],
                "tokens": [],
                "depth": 0,
                "line_count": 0,
                "token_count": 0,
            }
        
        parsed.append({
            "id": sub_id,
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
    Determine the plagiarism flag level from the combined score.

    The secondary rule (cosine >= 0.8 and ted >= 0.5 -> high, and the
    matching cosine/ted shortcuts for medium and low) is gone: it let two
    metrics fire independently of the weighted combined score and flagged
    structurally similar but honestly independent submissions as high.
    The combined score alone decides:
    - high:   combined >= 0.80  (renamed-copy level: Part 5 measured 0.8000-0.8182,
                                 honest independent submissions measured <= 0.6971)
    - medium: combined >= 0.70
    - low:    combined >= 0.50
    - none:   combined < 0.50
    """
    combined = metrics["combined_score"]

    if combined >= 0.80:
        return "high"

    if combined >= 0.70:
        return "medium"

    if combined >= 0.50:
        return "low"

    return "none"
