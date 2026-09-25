import secrets
from fastapi import Request, HTTPException, Security
from fastapi.security import APIKeyHeader
from config import INTERNAL_SECRET

api_key_header = APIKeyHeader(name="X-Internal-Secret", auto_error=False)


def _unauthorized(message: str) -> HTTPException:
    return HTTPException(
        status_code=401,
        detail={"message": message, "code": "UNAUTHORIZED"},
    )


def _secrets_match(provided: str, expected: str) -> bool:
    """Constant-time secret comparison that never raises on odd input."""
    try:
        return secrets.compare_digest(provided, expected)
    except (TypeError, ValueError):
        return False


async def verify_internal_secret(request: Request, secret: str = Security(api_key_header)):
    """
    Verify the internal secret from the backend.
    This prevents external clients from directly calling the AST engine.

    FAILS CLOSED: if INTERNAL_SECRET is not configured, every request is
    rejected — there is no unauthenticated mode.
    """
    if not INTERNAL_SECRET:
        raise _unauthorized(
            "Internal secret not configured — rejecting request (fail closed)"
        )

    if not secret:
        raise _unauthorized("Missing internal secret")

    if not _secrets_match(secret, INTERNAL_SECRET):
        raise _unauthorized("Invalid internal secret")

    return True
