import os
from pathlib import Path
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

BASE_DIR = Path(__file__).resolve().parent.parent
STORAGE_DIR = BASE_DIR / "app" / "storage"
UPLOADS_DIR = STORAGE_DIR / "uploads"
OUTPUTS_DIR = STORAGE_DIR / "outputs"

UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
OUTPUTS_DIR.mkdir(parents=True, exist_ok=True)

# --- Hunyuan3D-2.1 Configuration (Simplified) ---
HUNYUAN_PATH = os.getenv("HUNYUAN_PATH", "/home/gspe-ai3/Hunyuan3D-2.1")
HUNYUAN_SHAPE_PATH = os.path.join(HUNYUAN_PATH, "hy3dshape")
HUNYUAN_PAINT_PATH = os.path.join(HUNYUAN_PATH, "hy3dpaint")
HUNYUAN_CKPT_DIR = os.getenv("HUNYUAN_CKPT_DIR", os.path.join(HUNYUAN_PATH, "ckpt"))

# CORS: Configurable via env var CORS_ORIGINS (comma-separated)
# Note: "*" does NOT work with allow_credentials=True in FastAPI
_DEFAULT_CORS = ",".join([
    # Same device (localhost)
    "http://localhost:5177",
    "http://127.0.0.1:5177",
    "http://localhost:4173",
    "http://127.0.0.1:4173",
    "http://localhost:8077",
    "http://127.0.0.1:8077",
    # Backend device IP (for accessing frontend on same machine)
    "http://192.168.2.132:5177",
    "http://192.168.2.132:4173",
    # Frontend device IP (for direct browser→backend connections)
    "http://192.168.2.106:5177",
    # Vercel production deployment
    "https://protoscale-ai.vercel.app",
    # Vercel preview deployments
    "https://protoscale-ai-*.vercel.app",
])
CORS_ORIGINS = [
    o.strip() for o in os.getenv("CORS_ORIGINS", _DEFAULT_CORS).split(",") if o.strip()
]

# GPU Configuration (Legacy - Not used in Meshy Cloud Mode)
# Keeping for potential future local processing feature
GEOMETRY_DEVICE = os.getenv("GEOMETRY_DEVICE", "cuda:0")
TEXTURE_DEVICE = os.getenv("TEXTURE_DEVICE", "cuda:1")
REMBG_DEVICE = os.getenv("REMBG_DEVICE", "cuda:0")
DEVICE = GEOMETRY_DEVICE 

MODEL_PATH = os.getenv("HUNYUAN_MODEL_PATH", "tencent/Hunyuan3D-2.1")
MODEL_IDLE_TIMEOUT = int(os.getenv("MODEL_IDLE_TIMEOUT", "480"))  # 8 minutes before unloading model

# rembg model
REMBG_MODEL = os.getenv("REMBG_MODEL", "u2net")

# Texture generation
ENABLE_TEXTURE = os.getenv("ENABLE_TEXTURE", "true").lower() in ("true", "1", "yes")

# Meshy AI Configuration
MESHY_API_KEY = os.getenv("MESHY_API_KEY")
if not MESHY_API_KEY:
    import logging
    logger = logging.getLogger(__name__)
    logger.error("MESHY_API_KEY environment variable is required!")
    raise ValueError("MESHY_API_KEY must be set in environment variables. See .env.example for setup instructions.")

MESHY_API_URL = os.getenv("MESHY_API_URL", "https://api.meshy.ai/v1")

# Quality Presets (UI labels only - Meshy API has fixed quality)
QUALITY_PRESETS = {
    "balanced": {
        "num_inference_steps": 30, # Unused by Meshy, kept for schema compat
        "description": "Standard Quality (Meshy AI)",
        "estimated_time_min": 2,
    },
    "high": {
        "num_inference_steps": 50, # Unused
        "description": "High Quality (Meshy AI)",
        "estimated_time_min": 2,
    }
}

DEFAULT_QUALITY_PRESET = "balanced"


# ============================================================================
# VRAM MANAGEMENT & TEXTURE ADAPTIVE CONFIGURATION
# ============================================================================
# Adaptive texture quality berdasarkan available VRAM
# Mencegah OOM error dengan dynamic quality adjustment

# VRAM Thresholds (in GB) - Adjusted for GPU 1 (RTX 5080 16GB)
# NOTE: GPU 1 (RTX 5080) handles texture with limited VRAM
VRAM_THRESHOLD_ULTRA = float(os.getenv("VRAM_THRESHOLD_ULTRA", "14.0"))   # 2048px, 6 views - GPU 0 only
VRAM_THRESHOLD_HIGH = float(os.getenv("VRAM_THRESHOLD_HIGH", "10.0"))     # 1024px, 4 views - GPU 0/1 risky
VRAM_THRESHOLD_MEDIUM = float(os.getenv("VRAM_THRESHOLD_MEDIUM", "6.0"))  # 512px, 4 views - GPU 1 safe
VRAM_THRESHOLD_LOW = float(os.getenv("VRAM_THRESHOLD_LOW", "4.0"))        # 256px, 4 views - GPU 1 fallback

# Texture Configuration Presets
# NOTE: GPU 1 (RTX 5080 16GB) can only safely run medium/low presets
TEXTURE_CONFIG_PRESETS = {
    "ultra": {
        "max_num_view": 6,
        "resolution": 2048,
        "min_vram_required": VRAM_THRESHOLD_ULTRA,
        "description": "Ultra quality - 2048px, 6 views (GPU 0 only)"
    },
    "high": {
        "max_num_view": 4,
        "resolution": 1024,
        "min_vram_required": VRAM_THRESHOLD_HIGH,
        "description": "High quality - 1024px, 4 views (GPU 0/1 risky)"
    },
    "medium": {
        "max_num_view": 4,
        "resolution": 512,
        "min_vram_required": VRAM_THRESHOLD_MEDIUM,
        "description": "Medium quality - 512px, 4 views (GPU 1 safe)"
    },
    "low": {
        "max_num_view": 4,
        "resolution": 256,
        "min_vram_required": VRAM_THRESHOLD_LOW,
        "description": "Low quality - 256px, 4 views (GPU 1 fallback)"
    }
}

# Default texture config
DEFAULT_TEXTURE_CONFIG = "high"

# Valid retexture resolutions (Hunyuan3D-Paint v2.1 expects multiples of 64)
VALID_RETEXTURE_RESOLUTIONS = [512, 768, 1024, 1280, 1536, 2048]

# Aggressive memory cleanup settings
ENABLE_AGGRESSIVE_CLEANUP = os.getenv("ENABLE_AGGRESSIVE_CLEANUP", "true").lower() in ("true", "1", "yes")
UNLOAD_GEOMETRY_BEFORE_TEXTURE = os.getenv("UNLOAD_GEOMETRY_BEFORE_TEXTURE", "true").lower() in ("true", "1", "yes")

# ============================================================================
# GPU PARALLEL PROCESSING CONFIGURATION
# ============================================================================
# GPU Slot Manager untuk parallel job processing
# Setiap GPU punya 1 slot untuk 1 job stage
# GPU 0: Rembg only (RTX 5080 - 16GB)
# GPU 1: Geometry + Texture (RTX 4090 - 24GB) - Sequential to avoid OOM
# ============================================================================

import threading
from enum import Enum
from typing import Optional, Dict, Any
from dataclasses import dataclass, field
from datetime import datetime


class JobStage(Enum):
    """Pipeline stages dalam 3D generation."""
    UPLOAD = "upload"
    READY = "ready"
    REMBG = "rembg"           # Background removal (local processing)
    GEOMETRY = "geometry"      # Meshy AI: 3D generation (includes geometry + texture)
    TEXTURE = "texture"        # Legacy stage (unused in Meshy mode)
    POSTPROCESS = "postprocess" # Download GLB + thumbnail rendering
    COMPLETED = "completed"


@dataclass
class JobStageInfo:
    """Informasi stage yang sedang berjalan di GPU."""
    job_id: str
    stage: JobStage
    started_at: datetime = field(default_factory=datetime.now)
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "job_id": self.job_id,
            "stage": self.stage.value,
            "started_at": self.started_at.isoformat()
        }


class GPUSlotManager:
    """
    Manajemen slot GPU untuk parallel job processing.
    
    OPTION C-MAX: FULLY SEQUENTIAL SPLIT CONFIGURATION
    GPU 0 (cuda:0 - RTX 4090 24GB): Menangani Rembg → Geometry → Simplify → Cleanup
    GPU 1 (cuda:1 - RTX 5080 16GB): Menangani Texture ONLY (1024px, 3 views, VRAM < 14GB)
    
    Pipeline: Rembg (GPU 0) → Geometry (GPU 0) → Simplify → Cleanup → Texture (GPU 1)
    Key: Fully sequential dengan split workload untuk optimal VRAM usage
    """
    
    def __init__(self):
        self._lock = threading.RLock()
        
        # Slot assignment: gpu_id -> JobStageInfo | None
        # OPTION C-MAX: Split workload - Texture di GPU 1
        self._slots: Dict[str, Optional[JobStageInfo]] = {
            GEOMETRY_DEVICE: None,   # cuda:0 - RTX 4090 (Rembg + Geometry + Simplify)
            TEXTURE_DEVICE: None,    # cuda:1 - RTX 5080 (Texture ONLY)
        }
        
        # Stage to GPU mapping
        # OPTION C-MAX: Fully sequential split
        self._stage_to_gpu = {
            JobStage.REMBG: GEOMETRY_DEVICE,    # cuda:0 - RTX 4090 (sama dengan geometry)
            JobStage.GEOMETRY: GEOMETRY_DEVICE, # cuda:0 - RTX 4090
            JobStage.TEXTURE: TEXTURE_DEVICE,   # cuda:1 - RTX 5080 (SPLIT!)
        }
        
        # Metrics tracking
        # CRITICAL FIX: Use correct device mappings
        self._metrics = {
            "total_jobs_processed": 0,
            "gpu_utilization": {
                GEOMETRY_DEVICE: {"busy_seconds": 0, "total_seconds": 0},
                REMBG_DEVICE: {"busy_seconds": 0, "total_seconds": 0}
            },
            "stage_completion_times": {
                JobStage.REMBG.value: [],
                JobStage.GEOMETRY.value: [],
                JobStage.TEXTURE.value: []
            }
        }
        
        self._metrics_start_time = datetime.now()
    
    def get_gpu_for_stage(self, stage: JobStage) -> str:
        """Get GPU device untuk stage tertentu."""
        return self._stage_to_gpu.get(stage, GEOMETRY_DEVICE)
    
    def is_slot_available(self, gpu_id: str) -> bool:
        """Cek apakah slot GPU tersedia."""
        with self._lock:
            return self._slots.get(gpu_id) is None
    
    def acquire_slot(self, gpu_id: str, job_id: str, stage: JobStage) -> bool:
        """
        Acquire slot di GPU untuk job stage.
        
        Returns:
            True jika berhasil acquire slot
            False jika slot sedang sibuk
        """
        with self._lock:
            if self._slots[gpu_id] is not None:
                return False
            
            self._slots[gpu_id] = JobStageInfo(job_id=job_id, stage=stage)
            return True
    
    def release_slot(self, gpu_id: str, job_id: str) -> Optional[JobStage]:
        """
        Release slot di GPU.
        
        Returns:
            Stage yang baru saja di-release, atau None jika tidak ditemukan
        """
        with self._lock:
            slot = self._slots.get(gpu_id)
            if slot and slot.job_id == job_id:
                self._slots[gpu_id] = None
                return slot.stage
            return None
    
    def get_slot_status(self) -> Dict[str, Any]:
        """Get current status semua GPU slots."""
        with self._lock:
            return {
                gpu: (slot.to_dict() if slot else None)
                for gpu, slot in self._slots.items()
            }
    
    def get_next_stage(self, current_stage: JobStage) -> Optional[JobStage]:
        """Get next stage dalam pipeline."""
        transitions = {
            JobStage.REMBG: JobStage.GEOMETRY,
            JobStage.GEOMETRY: JobStage.TEXTURE,
            JobStage.TEXTURE: JobStage.POSTPROCESS,
            JobStage.POSTPROCESS: JobStage.COMPLETED
        }
        return transitions.get(current_stage)
    
    def record_stage_completion(self, stage: JobStage, duration_seconds: float):
        """Record completion time untuk metrics."""
        with self._lock:
            self._metrics["total_jobs_processed"] += 1
            if stage.value in self._metrics["stage_completion_times"]:
                self._metrics["stage_completion_times"][stage.value].append(duration_seconds)
    
    def get_metrics(self) -> Dict[str, Any]:
        """Get processing metrics."""
        with self._lock:
            total_time = (datetime.now() - self._metrics_start_time).total_seconds()
            
            return {
                "total_jobs_processed": self._metrics["total_jobs_processed"],
                "uptime_seconds": total_time,
                "current_slots": self.get_slot_status(),
                "avg_stage_times": {
                    stage: sum(times) / len(times) if times else 0
                    for stage, times in self._metrics["stage_completion_times"].items()
                }
            }


# Global GPU Slot Manager instance
gpu_slot_manager = GPUSlotManager()
