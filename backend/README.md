# ProtoScale-AI Backend

FastAPI backend for image-to-3D generation using **Hunyuan3D-2.1 (PBR)** exclusively.

## Requirements

- Python 3.10
- NVIDIA GPU with CUDA 12.x
- 16GB+ VRAM (shape + texture), 6GB minimum (shape only)

## Quickstart

### 1. Setup Environment

```bash
cd backend
python3.10 -m venv venv
source venv/bin/activate
```

### 2. Install PyTorch (CUDA 12.8)

Install PyTorch **before** other dependencies. Sesuaikan dengan CUDA version server (`nvcc --version`).

```bash
# CUDA 12.8 (RTX 4090 / RTX 5080)
pip install torch torchvision --index-url https://download.pytorch.org/whl/cu128
```

Untuk CUDA version lain, cek: https://pytorch.org/get-started/locally/

### 3. Install Hunyuan3D-2.1

```bash
# Clone to standardized path
cd /home/gspe-ai3
git clone https://github.com/Tencent/Hunyuan3D-2.git Hunyuan3D-2.1
cd Hunyuan3D-2.1

# Verify structure (must have hy3dshape/ and hy3dpaint/)
ls -la hy3dshape/ hy3dpaint/

# Create symlink for checkpoint directory
ln -s hy3dpaint/ckpt ckpt

# Download RealESRGAN checkpoint
cd ckpt
wget https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.1/RealESRGAN_x4plus.pth
ls -lh RealESRGAN_x4plus.pth  # Should be ~67MB
cd ..

# Note: No need to pip install -e . for v2.1
# Backend imports directly from hy3dshape/hy3dpaint paths
```

### 4. Install Backend Dependencies

```bash
cd /path/to/ProtoScale-AI/backend
pip install -r requirements.txt
```

### 5. Download Model Weights

Weights auto-download on first run (~5-10GB from HuggingFace). Atau pre-download:

```bash
huggingface-cli download tencent/Hunyuan3D-2 --local-dir ./models/Hunyuan3D-2
```

### 6. Run

```bash
export CORS_ORIGINS="http://localhost:5177"  # frontend origin
export HUNYUAN_DEVICE="cuda:0"               # GPU device
# export HUNYUAN_MODEL_PATH=./models/Hunyuan3D-2  # if pre-downloaded

uvicorn app.main:app --host 0.0.0.0 --port 8077 --reload
```

Without Hunyuan3D-2 installed, the server runs in **mock mode** (placeholder outputs).

### 7. Verify

```bash
curl http://localhost:8077/health
# {"status":"ok"}
```

## API

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/upload` | Upload image (multipart form: `file`, `remove_bg`, `enhanced_detail`) |
| POST | `/api/jobs/{id}/generate-multiangle` | Trigger 4-angle generation |
| POST | `/api/jobs/{id}/generate-3d` | Trigger 3D mesh generation (parallel GPU processing) |
| GET | `/api/jobs/{id}/status` | Poll job status + progress (0-100) |
| GET | `/api/jobs/{id}/result/{asset}` | Download `view_0.png`...`view_3.png` or `model.glb` |
| GET | `/api/jobs/metrics/gpu` | **NEW** Get GPU processing metrics |
| GET | `/health` | Health check dengan GPU slot status |

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `CORS_ORIGINS` | `http://localhost:5173,http://localhost:3000,http://localhost:5177` | Comma-separated allowed origins |
| `HUNYUAN_PATH` | `/home/gspe-ai3/Hunyuan3D-2.1` | Path to Hunyuan3D-2.1 repository |
| `HUNYUAN_CKPT_DIR` | `{HUNYUAN_PATH}/ckpt` | Checkpoint directory (RealESRGAN) |
| `MODEL_PATH` | `tencent/Hunyuan3D-2.1/hunyuan3d-dit-v2-1` | HuggingFace model ID for geometry |
| `GEOMETRY_DEVICE` | `cuda:1` | GPU for geometry generation |
| `TEXTURE_DEVICE` | `cuda:0` | GPU for texture/rembg |
| `ENABLE_TEXTURE` | `true` | Enable texture generation (High/Ultra) |
| `REMBG_MODEL` | `u2net` | rembg model for background removal |
| `MODEL_IDLE_TIMEOUT` | `480` | Seconds before model unload (8 min) |

## GPU Strategy - Parallel Processing

### Multi-GPU Architecture (2 GPUs)

| GPU | Device | VRAM | Role | Pipeline Stages |
|-----|--------|------|------|-----------------|
| RTX 4090 | `cuda:1` | 24GB | Geometry Generation | Stage 2: Geometry |
| RTX 5080 | `cuda:0` | 16GB | Rembg + Texture | Stage 1: Rembg, Stage 3: Texture |

### Parallel Job Processing

Sistem backend menggunakan **Parallel Job Mode** untuk maximize GPU utilization:

```
Job A: [Upload] → [GPU0:Rembg] ──→ [GPU1:Geometry] ──→ [GPU0:Texture] → [Done]
Job B: [Upload] → [GPU0:Rembg] ──→ [GPU1:Geometry] ──→ [GPU0:Texture] → [Done]
Job C: [Upload] → [GPU0:Rembg] ──→ [Wait GPU1]       ──→ [GPU0:Texture] → [Done]

GPU 0: [Rembg-A][Texture-A][Rembg-B][Texture-B][Rembg-C]...  80-90% utilized
GPU 1: [Geometry-A][Geometry-B][Geometry-C]...              80-90% utilized
```

**Benefits:**
- **+100% throughput**: Dari 6-8 jobs/jam → 14-18 jobs/jam
- **Balanced utilization**: Kedua GPU aktif 80-90%
- **Sequential pipeline maintained**: Rembg → Geometry → Texture order tetap terjaga

### Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `GEOMETRY_DEVICE` | `cuda:1` | GPU untuk geometry generation (RTX 4090) |
| `TEXTURE_DEVICE` | `cuda:0` | GPU untuk rembg + texture (RTX 5080) |
| `MODEL_IDLE_TIMEOUT` | `480` | 8 minutes idle sebelum model unload |
| `HUNYUAN_PATH` | `/home/gspe-ai3/Hunyuan3D-2.1` | Path local repo Hunyuan3D-2.1 |
| `HUNYUAN_CKPT_DIR` | `{HUNYUAN_PATH}/ckpt` | Checkpoint directory |

**Note**: Setiap GPU punya 1 slot. Job stage mengalir antar GPU sesuai pipeline. System akan wait sampai slot tersedia.

### VRAM Management (Triple-Layer Cleanup)

Backend dilengkapi **automatic VRAM cleanup** untuk mencegah OOM errors:

1. **Pre-load Cleanup**: Sebelum model load ke VRAM (semua GPU)
2. **Pre-stage Cleanup** ⭐ NEW: Sebelum setiap stage (geometry/texture)
   - Geometry: Cleanup GPU 1 sebelum generation
   - Texture: Cleanup GPU 0 sebelum generation
3. **Unload Cleanup**: Saat model idle timeout (semua GPU)

Setiap cleanup melakukan:
```python
gc.collect()
torch.cuda.synchronize()
torch.cuda.empty_cache()
torch.cuda.ipc_collect()
```

**Expected VRAM Usage:**
- Draft/Balanced: ~10GB (GPU 1 only)
- High/Ultra: ~21GB total (10GB GPU 1 + 11GB GPU 0)

## Troubleshooting

### Texture Generation Errors

#### CUDA Out of Memory

**Symptoms**:
```
torch.OutOfMemoryError: CUDA out of memory. Tried to allocate X.XX GiB.
```

**Cause**:
- Insufficient VRAM on texture device (GPU 0)
- Multiple jobs running simultaneously
- Residual memory from previous jobs

**Fix** (already applied in code):
1. **Triple-layer VRAM cleanup**:
   - Pre-load cleanup (when loading models)
   - Pre-stage cleanup (before each geometry/texture stage) ⭐
   - Unload cleanup (on idle timeout)
2. **Memory allocator optimization**:
   - `PYTORCH_CUDA_ALLOC_CONF=expandable_segments:True`
   - Prevents memory fragmentation

**If still occurs**:
```bash
# Restart backend to fully reset GPU memory
pkill -f "uvicorn.*8077"
cd backend && source venv/bin/activate
uvicorn app.main:app --host 0.0.0.0 --port 8077

# Monitor VRAM usage
watch -n 2 nvidia-smi
```

**Expected VRAM:**
- Geometry stage: ~10GB on GPU 1
- Texture stage: ~11GB on GPU 0
- Total peak: ~21GB (both GPUs)

#### Missing Dependencies

**Symptoms**: ImportError for various modules

**Fix**:
```bash
cd /home/gspe-ai3/project_cv/ProtoScale-AI/backend
source venv/bin/activate

# Core dependencies
pip install fast-simplification>=0.1.13
pip install pytorch-lightning>=2.0.0
pip install trimesh rembg Pillow

# Fix transformers compatibility (v5.0+ breaks hy3dpaint)
pip install "transformers<5.0.0"

# Verify installations
pip show pytorch-lightning fast-simplification transformers
```

#### Module Import Errors

**Symptoms**:
- `No module named 'hy3dshape.pipelines'`
- `No module named 'textureGenPipeline'`

**Cause**: Incorrect `HUNYUAN_PATH` or missing directories

**Fix**:
```bash
# Verify path structure
ls $HUNYUAN_PATH/hy3dshape/
ls $HUNYUAN_PATH/hy3dpaint/

# Should see Python files, not empty directories
# If empty, re-clone the repository (see Installation)
```

### Texture Quality Tuning

V2.1 paint pipeline configuration (`backend/app/services/hunyuan.py:282`):
- `max_num_view=4`: Recommended (was 6)
- `resolution=1024`: Recommended (was 2048)

**Impact**: Lower values = more stable, less artifacts, lower VRAM usage (~4-6GB vs ~8-11GB peak).

**Final texture resolution**: Still 4096px after RealESRGAN 4x upscaling.
