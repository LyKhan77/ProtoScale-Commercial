import uuid
import shutil
import logging
import asyncio
import json
import time
import re
from pathlib import Path
from datetime import datetime
from collections import defaultdict

from typing import List, Optional, Dict, Any
from fastapi import APIRouter, UploadFile, File, Form, HTTPException, Depends, Request
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel, Field

from app.config import UPLOADS_DIR, OUTPUTS_DIR, JobStage, VALID_RETEXTURE_RESOLUTIONS
from app.middleware.auth import verify_api_key
from app.models.schemas import JobCreatedResponse, JobStatusResponse, JobStatus, JobListItem
from app.workers.task_queue import (
    create_job, get_job, update_job, update_job_stage, run_in_thread, jobs,
    get_pipeline_metrics,
    subscribe_job_events, unsubscribe_job_events
)
from app.services.image_processor import remove_background
from app.services.meshy import meshy_service


class RetextureRequest(BaseModel):
    object_prompt: str = Field(default="", description="Text description for texturing")
    style_prompt: str = Field(default="", description="Style description")
    enable_pbr: bool = Field(default=True, description="Generate PBR maps")
    negative_prompt: str = Field(default="", description="What to avoid")
    art_style: str = Field(default="realistic", description="Art style preset")
    resolution: int = Field(default=2048, description="Texture resolution (1024, 2048, 4096)")
    ai_model: str = Field(default="meshy-6-preview", description="AI model to use")


class Generate3DRequest(BaseModel):
    remove_bg: Optional[bool] = Field(default=None, description="Remove image background before generation")
    ai_model: Optional[str] = Field(default=None, description="AI model (meshy-4, meshy-5, latest)")
    should_texture: Optional[bool] = Field(default=None, description="Generate textured output")
    enable_pbr: Optional[bool] = Field(default=None, description="Generate PBR maps (if texture enabled)")
    model_type: Optional[str] = Field(default=None, description="standard or lowpoly")
    symmetry_mode: Optional[str] = Field(default=None, description="off, auto, on")


# In-memory retexture status tracking
_retexture_status: dict[str, dict] = {}
_retexture_tasks: dict[str, asyncio.Task] = {}
_retexture_cancel: dict[str, bool] = {}
_retexture_backup: dict[str, str] = {}

# Simple rate limiter: track generation requests per IP (limit: 10/hour)
_request_timestamps = defaultdict(list)


def _check_rate_limit(client_ip: str, limit: int = 10, window_seconds: int = 3600) -> bool:
    """Check if IP has exceeded generation rate limit.

    Args:
        client_ip: Client IP address
        limit: Max requests allowed in window
        window_seconds: Time window in seconds (default 1 hour)

    Returns:
        True if within limit, False if exceeded
    """
    now = time.time()
    # Remove timestamps outside window
    _request_timestamps[client_ip] = [
        ts for ts in _request_timestamps[client_ip]
        if now - ts < window_seconds
    ]
    # Check limit
    if len(_request_timestamps[client_ip]) >= limit:
        return False
    # Record this request
    _request_timestamps[client_ip].append(now)
    return True


def _quality_preset_from_ai_model(ai_model: str) -> str:
    quality_preset_map = {
        "meshy-4": "v1",
        "meshy-5": "v2",
        "latest": "v3",
        "meshy-6": "v3",
    }
    return quality_preset_map.get(ai_model, "v2")


def _persist_settings(job_id: str, settings: Dict[str, Any]) -> None:
    try:
        job_dir = UPLOADS_DIR / job_id
        job_dir.mkdir(parents=True, exist_ok=True)
        with open(job_dir / "settings.json", "w") as f:
            json.dump(settings, f)
    except Exception as e:
        logger.warning(f"Failed to save settings for {job_id}: {e}")


def _get_original_image_paths(job_dir: Path) -> List[Path]:
    indexed_files = []
    for path in job_dir.glob("original_*"):
        if not path.is_file():
            continue
        match = re.match(r"original_(\d+)$", path.stem)
        index = int(match.group(1)) if match else 999_999
        indexed_files.append((index, path))

    indexed_files.sort(key=lambda item: item[0])
    originals = [path for _, path in indexed_files]
    if originals:
        return originals

    # Legacy fallback: original.png / original.jpg / original.jpeg
    for ext in (".png", ".jpg", ".jpeg", ".webp"):
        legacy = job_dir / f"original{ext}"
        if legacy.exists():
            return [legacy]

    return []


async def _resolve_generate_image_paths(job_id: str, remove_bg: bool) -> List[str]:
    job_dir = UPLOADS_DIR / job_id
    originals = _get_original_image_paths(job_dir)
    if not originals:
        raise HTTPException(404, "Source image not found")

    if not remove_bg:
        return [str(path) for path in originals]

    resolved_paths: List[str] = []
    for idx, raw_path in enumerate(originals):
        nobg_path = job_dir / f"nobg_{idx}.png"
        if nobg_path.exists():
            resolved_paths.append(str(nobg_path))
            continue
        try:
            result_path = await run_in_thread(remove_background, str(raw_path), str(nobg_path))
            resolved_paths.append(result_path)
        except Exception as e:
            logger.warning(f"Background removal failed for image {idx} on job {job_id}, using original: {e}")
            resolved_paths.append(str(raw_path))

    return resolved_paths


async def _apply_generate_settings(job_id: str, job: Dict[str, Any], overrides: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    settings = dict(job.get("settings") or {})
    if overrides:
        settings.update(overrides)

    model_type = settings.get("model_type", "standard")
    symmetry_mode = settings.get("symmetry_mode", "auto")
    if model_type not in ("standard", "lowpoly"):
        raise HTTPException(400, f"Invalid model_type: {model_type}")
    if symmetry_mode not in ("off", "auto", "on"):
        raise HTTPException(400, f"Invalid symmetry_mode: {symmetry_mode}")

    if not settings.get("ai_model"):
        settings["ai_model"] = "meshy-6"
    if settings.get("should_texture") is None:
        settings["should_texture"] = True
    if settings.get("enable_pbr") is None:
        settings["enable_pbr"] = False
    if not settings.get("should_texture"):
        settings["enable_pbr"] = False

    settings["quality_preset"] = _quality_preset_from_ai_model(settings["ai_model"])

    remove_bg = bool(settings.get("remove_bg", True))
    all_image_paths = await _resolve_generate_image_paths(job_id, remove_bg)
    settings["all_image_paths"] = all_image_paths

    update_job(
        job_id,
        settings=settings,
        all_image_paths=all_image_paths,
        image_path=all_image_paths[0],
        processed_image_path=all_image_paths[0] if remove_bg else None,
    )
    _persist_settings(job_id, settings)
    return settings


def _backup_model_glb(job_id: str) -> str | None:
    output_glb = OUTPUTS_DIR / job_id / "model.glb"
    if not output_glb.exists():
        return None
    backup_path = OUTPUTS_DIR / job_id / "model.glb.bak"
    try:
        shutil.copy2(output_glb, backup_path)
        return str(backup_path)
    except Exception:
        return None


def _restore_model_glb(job_id: str) -> None:
    backup_path = _retexture_backup.get(job_id)
    if not backup_path:
        return
    backup_file = Path(backup_path)
    output_glb = OUTPUTS_DIR / job_id / "model.glb"
    if backup_file.exists():
        try:
            shutil.copy2(backup_file, output_glb)
        except Exception:
            pass
    if backup_file.exists():
        try:
            backup_file.unlink()
        except Exception:
            pass
    _retexture_backup.pop(job_id, None)


def _cleanup_retexture_temp(job_id: str) -> None:
    job_output_dir = OUTPUTS_DIR / job_id
    for name in ["retexture_temp.glb", "model.obj"]:
        path = job_output_dir / name
        if path.exists():
            try:
                path.unlink()
            except Exception:
                pass

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["jobs"])


@router.post("/upload", response_model=JobCreatedResponse)
async def upload_image(
    files: List[UploadFile] = File(...),
    remove_bg: bool = Form(True),
    ai_model: str = Form("meshy-6"),
    should_texture: bool = Form(True),
    enable_pbr: bool = Form(False),
    model_type: str = Form("standard"),
    symmetry_mode: str = Form("auto"),
    api_key: str = Depends(verify_api_key),
):
    # Validate file count (1 source + up to 3 multi-view)
    if len(files) < 1 or len(files) > 4:
        raise HTTPException(400, "Upload 1-4 image files (1 source + up to 3 multi-view)")

    for f in files:
        if not f.content_type or not f.content_type.startswith("image/"):
            raise HTTPException(400, f"Only image files are accepted, got: {f.content_type}")

    # Validate model_type and symmetry_mode
    if model_type not in ("standard", "lowpoly"):
        raise HTTPException(400, f"Invalid model_type: {model_type}")
    if symmetry_mode not in ("off", "auto", "on"):
        raise HTTPException(400, f"Invalid symmetry_mode: {symmetry_mode}")

    job_id = str(uuid.uuid4())
    job_dir = UPLOADS_DIR / job_id
    job_dir.mkdir(parents=True, exist_ok=True)

    # Save all uploaded files
    all_raw_paths = []
    for idx, file in enumerate(files):
        ext = Path(file.filename or "image.png").suffix or ".png"
        raw_path = str(job_dir / f"original_{idx}{ext}")
        with open(raw_path, "wb") as f:
            content = await file.read()
            f.write(content)
        all_raw_paths.append(raw_path)

    # Process all images (background removal if requested)
    all_processed_paths = []
    for idx, raw_path in enumerate(all_raw_paths):
        image_path = raw_path
        if remove_bg:
            try:
                update_job_stage(job_id, JobStage.REMBG, int((idx / len(all_raw_paths)) * 100))

                def rembg_progress_callback(progress: int, _idx=idx, _total=len(all_raw_paths)):
                    overall = int((_idx / _total) * 100 + progress / _total)
                    update_job_stage(job_id, JobStage.REMBG, overall)

                nobg_path = str(job_dir / f"nobg_{idx}.png")
                result_path = await run_in_thread(remove_background, raw_path, nobg_path, rembg_progress_callback)
                image_path = result_path
            except Exception as e:
                logger.warning(f"Background removal failed for image {idx}, using original: {e}")
        all_processed_paths.append(image_path)

    if remove_bg:
        update_job_stage(job_id, JobStage.REMBG, 100)

    # Primary image is the first one (source image)
    primary_image_path = all_processed_paths[0]

    # Map ai_model to quality_preset for frontend display
    quality_preset = _quality_preset_from_ai_model(ai_model)

    settings = {
        "remove_bg": remove_bg,
        "ai_model": ai_model,
        "should_texture": should_texture,
        "enable_pbr": enable_pbr,
        "quality_preset": quality_preset,
        "model_type": model_type,
        "symmetry_mode": symmetry_mode,
        "all_image_paths": all_processed_paths,
    }

    # Save settings to disk for persistence
    _persist_settings(job_id, settings)

    create_job(job_id, primary_image_path, settings)

    # Store processed image path if background was removed
    if remove_bg and primary_image_path != all_raw_paths[0]:
        update_job(job_id, processed_image_path=primary_image_path)

    update_job(job_id, status="pending", stage=JobStage.READY.value)

    return JobCreatedResponse(job_id=job_id)


@router.post("/jobs/{job_id}/generate-3d", response_model=JobStatusResponse)
async def trigger_3d(
    request: Request,
    job_id: str,
    body: Optional[Generate3DRequest] = None,
    api_key: str = Depends(verify_api_key),
):
    """Trigger 3D generation using Meshy AI (Replacing Local GPU).

    Rate limited to 10 generations per hour per IP.
    """
    # Rate limit check
    client_ip = request.client.host if request.client else "unknown"
    if not _check_rate_limit(client_ip, limit=10, window_seconds=3600):
        raise HTTPException(
            status_code=429,
            detail="Rate limit exceeded. Max 10 generations per hour per IP."
        )

    job = get_job(job_id)
    if not job:
        # Try to recover job from disk
        job_dir = UPLOADS_DIR / job_id
        if not job_dir.exists():
            raise HTTPException(404, "Job not found")

        # Try to restore from settings file
        settings_path = job_dir / "settings.json"
        if not settings_path.exists():
            raise HTTPException(404, "Job not found")

        try:
            import json
            with open(settings_path, 'r') as f:
                settings = json.load(f)

            # Find the image file
            image_path = None
            originals = _get_original_image_paths(job_dir)
            if originals:
                image_path = str(originals[0])
            elif (job_dir / "nobg_0.png").exists():
                image_path = str(job_dir / "nobg_0.png")
            elif (job_dir / "nobg.png").exists():
                image_path = str(job_dir / "nobg.png")

            if not image_path:
                raise HTTPException(404, "Image not found")

            # Recreate job from disk
            create_job(job_id, image_path, settings)
            job = get_job(job_id)
            logger.info(f"Job {job_id} recovered from disk")

        except Exception as e:
            logger.error(f"Failed to recover job {job_id}: {e}")
            raise HTTPException(404, "Job not found")

    # Apply final generate settings snapshot (from Generate button click) and persist.
    # If no overrides are passed, keep existing settings.
    overrides = body.dict(exclude_none=True) if body else {}
    await _apply_generate_settings(job_id, job, overrides)

    # Update job status before submitting to ensure frontend sees it
    update_job(job_id, status="queued")

    # Submit job to Meshy AI
    try:
        await meshy_service.submit_job(job_id)
    except Exception as e:
        logger.error(f"Meshy submission failed: {e}")
        raise HTTPException(500, f"Failed to submit job to Meshy: {str(e)}")

    logger.info(f"Job {job_id} submitted to Meshy AI")
    return _job_status(job_id)


@router.get("/jobs/metrics/gpu", response_model=dict)
async def get_gpu_metrics():
    """Get GPU processing metrics dan utilization stats."""
    return get_pipeline_metrics()


@router.get("/jobs/{job_id}/status", response_model=JobStatusResponse)
async def job_status(job_id: str):
    job = get_job(job_id)
    if not job:
        raise HTTPException(404, "Job not found")
    return _job_status(job_id)


@router.get("/jobs/{job_id}/stream")
async def job_stream(job_id: str):
    """SSE endpoint for real-time job updates."""
    job = get_job(job_id)
    if not job:
        raise HTTPException(404, "Job not found")

    async def event_generator():
        queue = subscribe_job_events(job_id)
        try:
            # Send initial state
            initial = {
                "type": "stage_update",
                "stage": job.get("stage"),
                "progress": job.get("progress", 0),
                "status": job.get("status")
            }
            yield f"data: {json.dumps(initial)}\n\n"

            # Stream updates
            while True:
                try:
                    event = await asyncio.wait_for(queue.get(), timeout=30.0)
                    yield f"data: {json.dumps(event)}\n\n"

                    # Stop streaming when job completes or fails
                    if event.get("status") in ("completed", "failed"):
                        break
                except asyncio.TimeoutError:
                    # Send keepalive
                    yield ": keepalive\n\n"
        finally:
            unsubscribe_job_events(job_id, queue)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no"
        }
    )


@router.get("/jobs/{job_id}/result/{asset}")
async def job_result(job_id: str, asset: str):
    if asset == "model.glb":
        # First try in-memory job state
        job = get_job(job_id)
        if job:
            model_path = job.get("model_path")
            if model_path and Path(model_path).exists():
                return FileResponse(model_path, media_type="model/gltf-binary", filename="model.glb")

        # Fallback: check filesystem directly (for history/previous sessions)
        disk_path = OUTPUTS_DIR / job_id / "model.glb"
        if disk_path.exists():
            return FileResponse(disk_path, media_type="model/gltf-binary", filename="model.glb")

        raise HTTPException(404, "Model not ready")

    raise HTTPException(400, f"Unknown asset: {asset}")


@router.get("/jobs", response_model=list[JobListItem])
async def list_jobs():
    items = []
    if OUTPUTS_DIR.exists():
        for d in OUTPUTS_DIR.iterdir():
            if not d.is_dir():
                continue
            glb = d / "model.glb"
            has_model = glb.exists()
            if not has_model:
                continue
            
            created_at = datetime.fromtimestamp(glb.stat().st_mtime).isoformat()

            # Try to read settings from UPLOADS_DIR (since that's where we save it)
            # Assumption: job_id in outputs matches job_id in uploads
            model_version = None
            quality_preset = None
            settings_path = UPLOADS_DIR / d.name / "settings.json"
            if settings_path.exists():
                try:
                    with open(settings_path, "r") as f:
                        data = json.load(f)
                        model_version = data.get("model_version")
                        quality_preset = data.get("quality_preset")
                except:
                    pass

            # Check if job is deprecated (v2.0)
            deprecated = (model_version == "v2.0") if model_version else False

            items.append(JobListItem(
                job_id=d.name,
                has_model=True,
                created_at=created_at,
                model_version=model_version,
                deprecated=deprecated,
                quality_preset=quality_preset
            ))
    items.sort(key=lambda x: x.created_at, reverse=True)
    return items


@router.delete("/jobs/{job_id}")
async def delete_job(job_id: str):
    upload_dir = UPLOADS_DIR / job_id
    output_dir = OUTPUTS_DIR / job_id
    found = upload_dir.exists() or output_dir.exists() or job_id in jobs

    if not found:
        raise HTTPException(404, "Job not found")

    if upload_dir.exists():
        shutil.rmtree(upload_dir)
    if output_dir.exists():
        shutil.rmtree(output_dir)
    jobs.pop(job_id, None)

    return {"status": "deleted", "job_id": job_id}


@router.get("/jobs/{job_id}/thumbnail")
async def job_thumbnail(job_id: str):
    upload_dir = UPLOADS_DIR / job_id
    if not upload_dir.exists():
        raise HTTPException(404, "Job not found")

    for nobg_name in ("nobg_0.png", "nobg.png"):
        nobg = upload_dir / nobg_name
        if nobg.exists():
            return FileResponse(nobg, media_type="image/png")

    originals = _get_original_image_paths(upload_dir)
    if originals:
        ext = originals[0].suffix.lower()
        media = "image/png" if ext == ".png" else ("image/webp" if ext == ".webp" else "image/jpeg")
        return FileResponse(originals[0], media_type=media)

    raise HTTPException(404, "No thumbnail found")


@router.post("/jobs/{job_id}/retexture")
async def retexture_job(job_id: str, body: RetextureRequest, api_key: str = Depends(verify_api_key)):
    """Apply texture to existing 3D model using Meshy AI text-to-texture."""
    job = get_job(job_id)
    if not job:
        raise HTTPException(404, "Job not found")

    model_path = job.get("model_path")
    if not model_path or not Path(model_path).exists():
        raise HTTPException(404, "Model not found. Generate 3D model first.")

    # Check if another retexture is already running
    if _retexture_status.get(job_id, {}).get("status") == "processing":
        raise HTTPException(409, "Retexture already in progress")

    # Initialize retexture status
    _retexture_status[job_id] = {
        "status": "processing",
        "progress": 0,
        "error": None
    }

    # Submit retexture job to Meshy
    try:
        await meshy_service.submit_retexture_job(job_id, body.dict())
        return {"status": "processing", "message": "Retexture job submitted"}
    except Exception as e:
        logger.error(f"Failed to submit retexture job: {e}")
        _retexture_status[job_id] = {
            "status": "failed",
            "progress": 0,
            "error": str(e)
        }
        raise HTTPException(500, f"Failed to submit retexture job: {str(e)}")


@router.get("/jobs/{job_id}/retexture/status")
async def retexture_status(job_id: str):
    """Get retexture status for a job."""
    status = _retexture_status.get(job_id)
    if not status:
        return {"status": "idle", "progress": 0, "error": None}
    return status


@router.post("/jobs/{job_id}/retexture/cancel")
async def cancel_retexture(job_id: str):
    """Cancel a running retexture job and restore previous model."""
    status = _retexture_status.get(job_id)
    if not status or status.get("status") not in ("processing", "cancelling"):
        raise HTTPException(409, "No retexture job in progress.")

    _retexture_cancel[job_id] = True
    _retexture_status[job_id]["status"] = "cancelling"

    task = _retexture_tasks.get(job_id)
    if task:
        task.cancel()

    _restore_model_glb(job_id)
    _cleanup_retexture_temp(job_id)
    job = get_job(job_id)
    if job:
        output_glb = OUTPUTS_DIR / job_id / "model.glb"
        if output_glb.exists():
            update_job(job_id, model_path=str(output_glb))

    _retexture_status[job_id] = {
        "status": "cancelled",
        "progress": 0,
        "error": None,
    }
    return _retexture_status[job_id]


def _job_status(job_id: str) -> JobStatusResponse:
    job = get_job(job_id)
    return JobStatusResponse(
        job_id=job["job_id"],
        status=JobStatus(job["status"]),
        progress=job.get("progress", 0),
        stage=job.get("stage"),
        error=job.get("error"),
    )
