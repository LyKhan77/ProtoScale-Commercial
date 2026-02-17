# ProtoScale-AI Frontend

Vue 3 + Vite frontend for ProtoScale-AI image-to-3D platform.

## Features

### 1. **Streamlined Upload Interface**
- Drag & drop image upload
- Quality preset selection (Draft/Balanced/High/Ultra)
- Background removal toggle
- Enhanced detail options

**Note**: Model version selector removed - system uses Hunyuan3D-2.1 (PBR) exclusively.

### 2. **Real-time Job Monitoring**
- Live progress tracking (0-100%)
- Stage indicators:
  - Rembg (~20%)
  - Geometry (~80%)
  - Texture (100% - High/Ultra only)
- Error handling with user-friendly messages

### 3. **Advanced 3D Preview**
- **Interactive Viewer**: Orbit/Zoom/Pan controls powered by TresJS (Three.js wrapper)
- **Inspector Panel**:
  - Transform controls (X/Y/Z scaling in mm)
  - Mesh analysis (Watertight, Manifold checks)
  - Visual settings (Grid, Lighting, Wireframe)
- **Real-time Updates**: Changes reflect immediately in viewer

### 4. **Job History & Management**
- Persistent job list with thumbnails
- **Deprecation Badges**: v2.0 jobs marked as "DEPRECATED"
- Quick actions: View, Re-generate (v2.1 only), Delete
- Automatic cleanup of failed jobs

### 5. **Export Options**
- **STL** (Binary): Ready for 3D printing slicers
- **OBJ**: Source mesh for editing in Blender
- **GLB**: Web-ready 3D asset with textures

---

## Tech Stack

| Technology | Version | Purpose |
|------------|---------|---------|
| **Vue 3** | 3.5.24 | Core framework (Composition API + `<script setup>`) |
| **Vite** | 6.x | Build tool & dev server |
| **Pinia** | 2.x | State management (job lifecycle, history) |
| **TresJS** | Latest | 3D rendering (Vue wrapper for Three.js) |
| **TailwindCSS** | 3.x | Utility-first styling |
| **Axios** | 1.x | HTTP client for API calls |

---

## Quick Start

### Prerequisites

- **Node.js**: 18.x or 20.x
- **npm**: 9.x or 10.x

### Installation

```bash
cd frontend

# Install dependencies
npm install

# Configure API endpoint
echo "VITE_API_URL=http://192.168.2.132:8077" > .env
```

**Environment Variables**:
- `VITE_API_URL`: Backend API base URL (default: `http://localhost:8077`)

### Development

```bash
npm run dev
# Runs on http://localhost:5177
```

### Production Build

```bash
npm run build
# Output: dist/

# Preview production build
npm run preview
```

---

## Project Structure

```
frontend/
├── src/
│   ├── assets/          # Static assets (images, fonts)
│   ├── components/      # Vue components
│   │   ├── UploadForm.vue
│   │   ├── ProgressCard.vue
│   │   ├── ModelViewer.vue
│   │   └── InspectorPanel.vue
│   ├── stores/          # Pinia state stores
│   │   ├── process.js   # Upload & generation flow
│   │   └── history.js   # Job history management
│   ├── views/           # Page components
│   │   ├── UploadView.vue
│   │   ├── PreviewView.vue
│   │   └── HistoryView.vue
│   ├── router/          # Vue Router config
│   ├── App.vue          # Root component
│   └── main.js          # Entry point
├── public/              # Public assets
├── .env                 # Environment variables
├── vite.config.js       # Vite configuration
├── tailwind.config.js   # TailwindCSS config
└── package.json         # Dependencies
```

---

## State Management (Pinia)

### `process.js` Store

Manages upload and generation workflow:

```javascript
{
  jobId: null,              // Current job ID
  originalImage: null,      // Base64 original image
  processedImage: null,     // Base64 processed image (after rembg)
  status: 'idle',           // idle | uploading | generating | completed | error
  progress: 0,              // 0-100
  currentStage: null,       // rembg | geometry | texture | postprocess
  multiviewImages: [],      // Generated multi-view images
  modelUrl: null,           // GLB model URL
  error: null               // Error message
}
```

**Key Actions**:
- `uploadImage(file, settings)`: Upload & configure job
- `generateModel()`: Trigger 3D generation
- `pollStatus()`: Long-polling for progress updates
- `reset()`: Clear current job

### `history.js` Store

Manages job history and persistence:

```javascript
{
  items: [                  // Job list
    {
      jobId: string,
      name: string,         // User-defined or auto-generated
      thumbnailUrl: string,
      createdAt: string,
      modelVersion: string, // "v2.1" or "v2.0"
      deprecated: boolean   // true if v2.0 job
    }
  ]
}
```

**Key Actions**:
- `fetchJobs()`: Load jobs from backend
- `deleteJob(jobId)`: Remove job
- `renameJob(jobId, name)`: Update job name

---

## API Integration

Frontend communicates with backend via REST API:

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/jobs/upload` | POST | Upload image + settings |
| `/api/jobs/:id/generate-3d` | POST | Trigger generation pipeline |
| `/api/jobs/:id/status` | GET | Get job status + progress |
| `/api/jobs/:id/result/:asset` | GET | Download model/images |
| `/api/jobs` | GET | List all jobs |
| `/api/jobs/:id` | DELETE | Delete job |

**Error Handling**:
- Network errors: "Connection failed. Check if backend is running."
- Deprecated jobs: "DEPRECATED: Model v2.0 is no longer supported."
- Validation errors: Display backend error message

---

## UI Changes (v2.1 Refactor)

### Removed Features
- ❌ **Model Version Selector**: No longer needed (v2.1 exclusive)
- ❌ **v2.0/v2.1 Toggle**: Simplified upload interface

### Added Features
- ✅ **Deprecation Badges**: Visual indicator for old v2.0 jobs
- ✅ **Error Prevention**: Cannot regenerate deprecated jobs
- ✅ **Cleaner UI**: Reduced configuration options

### Before vs After

**Before (v2.0 + v2.1)**:
```
┌─────────────────────────┐
│ Upload Image            │
│ ┌─────────────────────┐ │
│ │ [Model Version]     │ │ <- REMOVED
│ │ ○ v2.0  ● v2.1      │ │
│ └─────────────────────┘ │
│ Quality Preset          │
│ Enhanced Detail         │
└─────────────────────────┘
```

**After (v2.1 Only)**:
```
┌─────────────────────────┐
│ Upload Image            │
│ Quality Preset          │
│ Enhanced Detail         │
└─────────────────────────┘
```

---

## Troubleshooting

### 1. Network Error / Connection Refused

**Symptom**: "Network Error" when uploading

**Fix**:
```bash
# Check backend is running
curl http://192.168.2.132:8077/api/jobs

# Verify VITE_API_URL in .env
cat .env
# Should match backend host:port
```

### 2. CORS Error

**Symptom**: Console shows CORS policy error

**Fix**: Update backend `CORS_ORIGINS` env var to include frontend URL:
```bash
export CORS_ORIGINS="http://localhost:5177,http://192.168.2.106:5177"
```

### 3. 3D Model Not Loading

**Symptom**: Black screen in preview

**Fix**:
- Check browser console for Three.js errors
- Verify GLB file exists: `curl http://backend/api/jobs/{id}/result/model.glb`
- Try disabling browser extensions (ad blockers)

### 4. Deprecated Job Warning

**Symptom**: Cannot regenerate old jobs

**Explanation**: v2.0 model no longer supported. Upload new image to generate with v2.1.

---

## Development Tips

### Hot Reload
Vite provides instant HMR (Hot Module Replacement). Changes to `.vue` files reflect immediately without page refresh.

### Debugging State
Use Vue DevTools browser extension to inspect Pinia stores:
1. Install [Vue DevTools](https://devtools.vuejs.org/)
2. Open DevTools → Vue → Pinia tab
3. Inspect `process` and `history` stores

### Testing API Calls
```javascript
// In browser console
const response = await fetch('http://backend:8077/api/jobs')
const jobs = await response.json()
console.log(jobs)
```

---

## Build & Deployment

### Production Build

```bash
npm run build
# Generates optimized static files in dist/
```

### Deploy to Nginx

```nginx
server {
    listen 5177;
    server_name localhost;

    root /path/to/ProtoScale-AI/frontend/dist;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    # API proxy (optional)
    location /api {
        proxy_pass http://192.168.2.132:8077;
    }
}
```

### Deploy to Vercel/Netlify

ProtoScale-AI frontend is SPA-compatible. Configure build settings:
- **Build Command**: `npm run build`
- **Publish Directory**: `dist`
- **Environment Variable**: `VITE_API_URL=https://your-backend-url.com`

---

## Contributing

When adding new features:
1. Follow Vue 3 Composition API conventions
2. Use Pinia for state management (avoid component-level state for shared data)
3. Maintain TailwindCSS utility classes (avoid custom CSS)
4. Test with both Draft and High quality presets
5. Verify 3D preview works with various mesh complexities

---

## License

Part of ProtoScale-AI project. See root LICENSE file.

---

**Built with ❤️ using Vue 3 + Vite**
