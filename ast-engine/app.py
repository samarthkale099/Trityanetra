from fastapi import FastAPI, Depends, HTTPException
from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any
from auth.internalAuth import verify_internal_secret
from comparator.batch_runner import (
    run_batch, BatchRunError, BatchRunValidationError, BatchRunTimeout
)
from config import HOST, PORT, MAX_BATCH_SIZE
import uvicorn


app = FastAPI(
    title="Trityanetra AST Engine",
    description="Plagiarism detection engine using AST comparison",
    version="1.0.0",
)


class SubmissionInput(BaseModel):
    id: str = Field(..., description="Submission ID")
    code: str = Field(..., description="Source code to analyze")
    language: str = Field(default="python", description="Programming language")
    studentId: str = Field(default="", description="Student identifier")


class BatchRequest(BaseModel):
    submissions: List[SubmissionInput] = Field(
        ..., 
        min_length=2, 
        max_length=MAX_BATCH_SIZE,
        description="List of submissions to compare (2-50)"
    )


class BatchResponse(BaseModel):
    pairs: List[Dict[str, Any]]
    flagged: List[Dict[str, Any]]
    summary: Dict[str, Any]


class HealthResponse(BaseModel):
    status: str
    version: str


@app.get("/health", response_model=HealthResponse)
async def health_check():
    """Health check endpoint — no auth required."""
    return HealthResponse(status="ok", version="1.0.0")


@app.post("/api/v1/plagiarism/check", response_model=BatchResponse)
async def check_plagiarism(
    request: BatchRequest,
    _authenticated: bool = Depends(verify_internal_secret),
):
    """
    Analyze a batch of submissions for plagiarism.
    
    Requires internal secret header (X-Internal-Secret).
    
    Errors:
      - 401: Missing or invalid internal secret
      - 400: Empty submissions list or exceeds max batch size
      - 408: Processing timeout
      - 500: Internal processing error
    """
    try:
        submissions_data = [sub.model_dump() for sub in request.submissions]
        result = run_batch(submissions_data)
        return BatchResponse(**result)
    except BatchRunValidationError as e:
        raise HTTPException(status_code=400, detail={
            "message": str(e),
            "code": "VALIDATION_ERROR",
        })
    except BatchRunTimeout as e:
        raise HTTPException(status_code=408, detail={
            "message": str(e),
            "code": "TIMEOUT",
        })
    except BatchRunError as e:
        raise HTTPException(status_code=500, detail={
            "message": f"Batch processing failed: {str(e)}",
            "code": "BATCH_ERROR",
        })
    except Exception as e:
        raise HTTPException(status_code=500, detail={
            "message": "Internal error in AST engine",
            "code": "INTERNAL_ERROR",
        })


if __name__ == "__main__":
    uvicorn.run(app, host=HOST, port=PORT)
