import logging
import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded

from app.config import CORS_ORIGINS
from app.routers import jobs
from app.workers.task_queue import restore_jobs_from_disk
from app.services.meshy import meshy_service

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Restore jobs from disk (important for history)
    restore_jobs_from_disk()
    logger.info("✓ Jobs restored from disk")

    # Start Meshy polling service
    meshy_service.start_polling()

    yield

    # Clean up on shutdown
    meshy_service.stop_polling()
    logger.info("Shutting down")


# Initialize rate limiter
limiter = Limiter(key_func=get_remote_address, default_limits=["100/hour"])

app = FastAPI(title="ProtoScale-AI Backend", lifespan=lifespan)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

logger.info(f"CORS allowed origins: {CORS_ORIGINS}")

# Custom CORS middleware to support Vercel preview deployments
from fastapi.middleware.cors import CORSMiddleware as BaseCORSMiddleware
from starlette.middleware.cors import ALL_METHODS
from starlette.datastructures import Headers

def is_allowed_origin(origin: str) -> bool:
    """Check if origin is allowed (supports vercel.app wildcard)."""
    if origin in CORS_ORIGINS:
        return True
    # Allow all vercel.app subdomains
    if origin.startswith("https://") and origin.endswith(".vercel.app"):
        return True
    # Allow localhost and development origins
    if origin.startswith("http://localhost:") or origin.startswith("http://127.0.0.1:"):
        return True
    return False

class CustomCORSMiddleware(BaseCORSMiddleware):
    def __init__(self, *args, **kwargs):
        # Replace static origins with wildcard handler
        kwargs['allow_origins'] = CORS_ORIGINS
        super().__init__(*args, **kwargs)

    def is_allowed_origin(self, origin: str) -> bool:
        """Override to support dynamic origin checking."""
        return is_allowed_origin(origin)

app.add_middleware(
    CustomCORSMiddleware,
    allow_origins=CORS_ORIGINS,  # Base list
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"],
)

app.include_router(jobs.router)





@app.get("/health")

async def health():

    return {

        "status": "ok",

        "mode": "cloud_meshy",

        "service": "ProtoScale-AI Backend"

    }
