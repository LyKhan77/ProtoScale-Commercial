# ProtoScale-AI API Reference

## Base URL

- **Development:** `http://localhost:8077`
- **Production:** `https://protoscale-be.iotech.my.id`

## Authentication

Protected endpoints require `X-API-Key` header:

```bash
curl -H "X-API-Key: your-api-key" \
  https://protoscale-be.iotech.my.id/api/upload
```

### Endpoints Overview

| Endpoint | Method | Auth | Purpose |
|----------|--------|------|---------|
| `/health` | GET | No | Health check |
| `/api/upload` | POST | Yes | Upload image |
| `/api/jobs/{id}/generate-3d` | POST | Yes | Start 3D generation (Meshy AI) |
| `/api/jobs/{id}/status` | GET | No | Check progress |
| `/api/jobs/{id}/result/model.glb` | GET | No | Download model |
| `/api/jobs` | GET | No | List jobs |
| `/api/jobs/{id}` | DELETE | Yes | Delete job |

*Note: `/api/jobs/{id}/retexture` is disabled in Cloud Mode.*

---

## Core Endpoints

### 1. Health Check

```bash
GET /health
```

**Response:**
```json
{
  "status": "ok",
  "pipeline_metrics": { ... }
}
```

---

### 2. Upload Image

```bash
POST /api/upload
Headers: X-API-Key: <key>
```

**Form Data:**
- `file` - Image file (JPG/PNG, max 10MB)
- `remove_bg` - Boolean (default: true)
- `quality_preset` - String: `balanced|high` (default: balanced)
- `enable_pbr` - Boolean (default: true) - Enable PBR textures in Meshy generation

**Response (201):**
```json
{
  "job_id": "550e8400-...",
  "status": "pending",
  "stage": "ready"
}
```

---

### 3. Generate 3D Model (Meshy AI)

```bash
POST /api/jobs/{job_id}/generate-3d
Headers: X-API-Key: <key>
```

**Response:**
```json
{
  "job_id": "550e8400-...",
  "status": "queued",
  "stage": "geometry",
  "progress": 0
}
```

**Processing Stages (Cloud):**
1. `rembg` - Background removal (local processing)
2. `geometry` - 3D model generation via Meshy AI (includes geometry + texture)
3. `postprocess` - Downloading GLB & rendering thumbnails
4. `completed` - Ready

**Generation Times:** ~2-3 minutes.

---

### 4. Check Status

```bash
GET /api/jobs/{job_id}/status
```

**Response:**
```json
{
  "job_id": "550e8400-...",
  "status": "processing",
  "stage": "texture",
  "progress": 60,
  "error": null
}
```

---

### 5. Download Model

```bash
GET /api/jobs/{job_id}/result/model.glb
```

Returns GLB file (GLTF binary format).

---

## Error Handling

All errors return JSON:

```json
{
  "detail": "Description of what went wrong"
}
```