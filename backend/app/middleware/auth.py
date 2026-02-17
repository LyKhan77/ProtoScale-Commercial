"""API Key authentication middleware."""
import os
from fastapi import Header, HTTPException, Security
from fastapi.security import APIKeyHeader

# Load API key from environment (or use default for dev)
API_KEY = os.getenv("PROTOSCALE_API_KEY", "demo-key-CHANGE-THIS-IN-PRODUCTION")

# Define API key header scheme
api_key_header = APIKeyHeader(name="X-API-Key", auto_error=False)


async def verify_api_key(x_api_key: str = Security(api_key_header)) -> str:
    """Verify API key from request header.

    Args:
        x_api_key: The API key from X-API-Key header

    Returns:
        The verified API key

    Raises:
        HTTPException: 401 if missing, 403 if invalid
    """
    if not x_api_key:
        raise HTTPException(
            status_code=401,
            detail="Missing API key. Include 'X-API-Key' header."
        )

    if x_api_key != API_KEY:
        raise HTTPException(
            status_code=403,
            detail="Invalid API key"
        )

    return x_api_key
