# ProtoScale-AI Architecture

## System Overview

ProtoScale-AI is a web application that generates 3D models from 2D images using **Meshy AI**. The system consists of a Vue.js frontend deployed on Vercel and a FastAPI backend that acts as a secure gateway and orchestrator for the cloud-based AI service.

```
┌─────────────────────────────────────────────────┐
│          Internet Users (Global)                │
└────────────────────┬────────────────────────────┘
                     │ HTTPS
                     ↓
┌─────────────────────────────────────────────────┐
│       Vercel CDN (Edge Network)                 │
│  ┌───────────────────────────────────────────┐  │
│  │  Vue 3 SPA Frontend                       │  │
│  │  - Upload UI                              │  │
│  │  - 3D Viewer (Three.js)                   │  │
│  │  - Progress tracking                      │  │
│  │  - Model export                           │  │
│  └───────────────────────────────────────────┘  │
└────────────────────┬────────────────────────────┘
                     │ HTTPS + API Key
                     ↓
┌─────────────────────────────────────────────────┐
│  Nginx Reverse Proxy (HTTPS Gateway)            │
│  URL: https://protoscale-be.iotech.my.id        │
└────────────────────┬────────────────────────────┘
                     │ HTTP
                     ↓
┌─────────────────────────────────────────────────┐
│         Local Server (Ubuntu)                   │
│  ┌───────────────────────────────────────────┐  │
│  │  FastAPI Backend (:8077)                  │  │
│  │  ┌─────────────────────────────────────┐  │  │
│  │  │  API Layer                          │  │  │
│  │  │  - Authentication (API Key)         │  │  │
│  │  │  - Rate limiting                    │  │  │
│  │  └─────────────────────────────────────┘  │  │
│  │  ┌─────────────────────────────────────┐  │  │
│  │  │  Meshy Service                      │  │  │
│  │  │  - Submit Job -> Meshy API          │  │  │
│  │  │  - Poll Status                      │  │  │
│  │  │  - Download GLB                     │  │  │
│  │  └─────────────────────────────────────┘  │  │
│  └───────────────────────────────────────────┘  │
└────────────────────┬────────────────────────────┘
                     │ HTTPS
                     ↓
┌─────────────────────────────────────────────────┐
│             Meshy AI Cloud API                  │
│           (Image to 3D Generation)              │
└─────────────────────────────────────────────────┘
```

---

## AI Model Pipeline (Cloud)

**Service:** Meshy AI (v1/image-to-3d)

**Processing Flow:**
1. **User Uploads Image** -> Backend saves it locally.
2. **Background Removal** (optional) -> Local processing using rembg.
3. **Backend Submits to Meshy** -> Sends processed image via API.
4. **Polling Loop** -> Backend checks Meshy task status every 2s.
5. **Completion** -> Backend downloads the final `.glb` model to local storage (`outputs/`).
6. **Frontend Preview** -> Frontend fetches the GLB from backend.

**Advantages over Local GPU:**
- No high-end GPU required on server.
- Scalable (limited only by API quota/rate limits).
- Consistent quality from a specialized provider.

---

## Deployment

**Frontend:** Vercel
**Backend:** Systemd service on Ubuntu (or any Python env).
**Database:** None (File-based job tracking).

## Security

- **API Key:** Protected endpoints require `X-API-Key`.
- **CORS:** Restricted to Vercel domains.
- **Rate Limiting:** 10 generations/hour per IP (configurable).