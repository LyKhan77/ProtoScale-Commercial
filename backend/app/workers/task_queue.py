import json
import logging
import threading
import shutil
import copy
from datetime import datetime
from pathlib import Path
from typing import Optional, Dict, Any, List
from collections import deque

from app.config import UPLOADS_DIR

logger = logging.getLogger(__name__)

# Thread-safety locks
_JOBS_LOCK = threading.RLock()
_EVENTS_LOCK = threading.RLock()

# Job state persistence
_JOB_STATE_FILE = "job_state.json"

# In-memory job store: job_id -> dict
jobs: dict[str, dict] = {}

# Event subscribers per job for SSE streaming
_job_event_queues: dict[str, list[any]] = {} 

# --- Job Persistence ---

def _get_job_state_path(job_id: str) -> Path:
    return UPLOADS_DIR / job_id / _JOB_STATE_FILE

def _save_job_state_to_disk(job_id: str, job: dict):
    try:
        job_dir = UPLOADS_DIR / job_id
        job_dir.mkdir(parents=True, exist_ok=True)
        state_path = _get_job_state_path(job_id)
        with open(state_path, 'w') as f:
            json.dump(job, f, indent=2, default=str)
    except Exception as e:
        logger.warning(f"Failed to save job state for {job_id}: {e}")

def _load_job_state_from_disk(job_id: str) -> Optional[dict]:
    try:
        state_path = _get_job_state_path(job_id)
        if not state_path.exists():
            return None
        with open(state_path, 'r') as f:
            return json.load(f)
    except Exception as e:
        logger.warning(f"Failed to load job state for {job_id}: {e}")
        return None

def restore_jobs_from_disk():
    restored_count = 0
    try:
        if not UPLOADS_DIR.exists():
            return
        for job_dir in UPLOADS_DIR.iterdir():
            if not job_dir.is_dir():
                continue
            job_id = job_dir.name
            job_state = _load_job_state_from_disk(job_id)
            if job_state:
                with _JOBS_LOCK:
                    jobs[job_id] = job_state
                    restored_count += 1
        logger.info(f"✓ Restored {restored_count} job(s) from disk")
    except Exception as e:
        logger.error(f"Error restoring jobs: {e}")

# --- Core Job Functions ---

def create_job(job_id: str, image_path: str, settings: dict) -> dict:
    job = {
        "job_id": job_id,
        "status": "pending",
        "progress": 0,
        "stage": "ready",
        "error": None,
        "image_path": image_path,
        "settings": settings,
        "all_image_paths": settings.get("all_image_paths", [image_path]),
        "meshy_endpoint_type": None,
        "multi_angle_paths": [],
        "model_path": None,
        "created_at": datetime.now().isoformat(),
        "meshy_task_id": None
    }
    with _JOBS_LOCK:
        jobs[job_id] = job
        _save_job_state_to_disk(job_id, job)
    return job

def get_job(job_id: str) -> Optional[dict]:
    with _JOBS_LOCK:
        job = jobs.get(job_id)
        if job:
            return copy.deepcopy(job)
    
    # Fallback to disk
    disk_job = _load_job_state_from_disk(job_id)
    if disk_job:
        with _JOBS_LOCK:
            jobs[job_id] = disk_job
        return copy.deepcopy(disk_job)
    return None

def update_job(job_id: str, **kwargs):
    event = None
    with _JOBS_LOCK:
        if job_id in jobs:
            jobs[job_id].update(kwargs)
            _save_job_state_to_disk(job_id, jobs[job_id])
            
            # Prepare event
            job = jobs[job_id]
            event = {
                "type": "stage_update",
                "stage": job.get("stage"),
                "progress": job.get("progress", 0),
                "status": job.get("status"),
                "error": job.get("error"),
            }
    
    if event:
        _publish_job_event(job_id, event)

def update_job_stage(job_id: str, stage: Any, progress: Optional[int] = None):
    # Handle Enum or string
    stage_val = stage.value if hasattr(stage, 'value') else stage
    kwargs = {"stage": stage_val}
    if progress is not None:
        kwargs["progress"] = progress
    update_job(job_id, **kwargs)

# --- Event / PubSub ---

import asyncio

def subscribe_job_events(job_id: str) -> asyncio.Queue:
    with _EVENTS_LOCK:
        if job_id not in _job_event_queues:
            _job_event_queues[job_id] = []
        queue = asyncio.Queue()
        _job_event_queues[job_id].append(queue)
        return queue

def unsubscribe_job_events(job_id: str, queue: asyncio.Queue):
    with _EVENTS_LOCK:
        if job_id in _job_event_queues:
            try:
                _job_event_queues[job_id].remove(queue)
            except ValueError:
                pass
            if not _job_event_queues[job_id]:
                del _job_event_queues[job_id]

def _publish_job_event(job_id: str, event: dict):
    # In a real app, this should schedule on the loop.
    # For simplicity in this synchronous update context:
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        loop = None

    with _EVENTS_LOCK:
        queues = list(_job_event_queues.get(job_id, []))
    
    for q in queues:
        if loop and not loop.is_closed():
            loop.call_soon_threadsafe(lambda qq, ev: qq.put_nowait(ev), q, event)

# --- Helpers ---

async def run_in_thread(fn, *args):
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, fn, *args)

# Compatibility mocks for old imports
def submit_job_to_pipeline(*args, **kwargs):
    logger.warning("submit_job_to_pipeline called but GPU queue is disabled")
    return True

def get_pipeline_metrics():
    return {
        "status": "cloud_mode", 
        "provider": "Meshy AI"
    }
