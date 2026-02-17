# ProtoScale-AI

<div align="center">

![ProtoScale-AI](https://img.shields.io/badge/ProtoScale-AI-v2.2--meshy-teal)
![Vue](https://img.shields.io/badge/Vue-3.5.24-42b883)
![FastAPI](https://img.shields.io/badge/FastAPI-0.110.0+-009688)
![Python](https://img.shields.io/badge/Python-3.10+-blue)
![Meshy AI](https://img.shields.io/badge/Powered_by-Meshy_AI-purple)
![License](https://img.shields.io/badge/License-MIT-green)

**Engineering-Grade Image-to-3D Conversion Platform for Manufacturing**

[Features](#key-features) • [Quick Start](#quick-start) • [Architecture](#system-architecture) • [Troubleshooting](#troubleshooting)

</div>

---

## App Goal

**ProtoScale-AI** is an AI-powered *Image-to-3D* platform designed to transform 2D images (photos, sketches, or AI-generated art) into manufacturing-ready 3D models. The application now integrates **Meshy AI** technology to generate high-quality 3D geometry with *Physically Based Rendering* (PBR) support, which can be calibrated for real-world dimensions and exported for **FDM 3D Printing**.

### Use Cases
- **Rapid Prototyping**: Turn product photos into 3D models in minutes.
- **Reverse Engineering**: Document physical objects into digital models.
- **Manufacturing**: Generate production geometry from technical drawings or sketches.
- **Content Creation**: Create 3D assets from 2D concepts for gaming/VR/AR.

### Key Differentiators
Unlike standard AI art tools, ProtoScale-AI focuses on:
- **Engineering Workflow**: Structured pipeline: Upload → Generate (Meshy AI) → Calibrate → Export.
- **Dimensional Accuracy**: X/Y/Z scale calibration in millimeters (mm).
- **Hybrid Pipeline**: Local background removal combined with cloud-based generation for optimal efficiency.
- **Manufacturing-Ready**: STL export compatible with major slicers (Cura, PrusaSlicer, Bambu Studio).
- **Secure Workflow**: Streamlined process designed for serious makers and engineers.

---

## Quick Start

### Prerequisites

#### Hardware Requirements
While the core 3D generation is offloaded to the cloud (Meshy AI), the application still utilizes local hardware for pre-processing (Background Removal) and rendering.

- **Recommended**:
  - NVIDIA GPU with 6GB+ VRAM (for efficient local Background Removal).
  - **RAM**: 16GB+ recommended.
  - **Storage**: 5GB+ free space (Model caches + Outputs).

#### Software Requirements
- **OS**: Linux (Ubuntu 22.04+) or Windows 10/11 (WSL2 recommended).
- **Python**: 3.10+.
- **Node.js**: 18.x or 20.x.
- **Meshy AI API Key**: Required for 3D generation. Get one at [meshy.ai](https://meshy.ai/).

---

### Installation

#### 1. Clone Repository

```bash
git clone <repository-url>
cd ProtoScale-AI
```

#### 2. Backend Setup

```bash
cd backend

# Create virtual environment
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Configure Environment Variables
cp .env.example .env
# Edit .env and set your MESHY_API_KEY
```

#### 3. Frontend Setup

```bash
cd frontend

# Install dependencies
npm install

# Configure API endpoint
# Edit .env file if running on a different port (Default: 8077)
echo "VITE_API_URL=http://localhost:8077" > .env
```

---

### Running the Application

#### Terminal 1: Start Backend

```bash
cd backend
source venv/bin/activate  # On Windows: venv\Scripts\activate

# Ensure MESHY_API_KEY is set in your .env file

# Start FastAPI server
uvicorn app.main:app --host 0.0.0.0 --port 8077 --reload
```

#### Terminal 2: Start Frontend

```bash
cd frontend

# Development server
npm run dev
```

---

## Key Features

### 1. Meshy AI Integration
The platform leverages the power of **Meshy AI** for state-of-the-art 3D generation:
- **High-Fidelity Geometry**: Superior mesh topology suitable for printing.
- **PBR Textures**: Generates Albedo, Normal, Roughness, and Metallic maps.
- **Fast Inference**: Cloud-based processing ensures quick turnaround times without requiring enterprise-grade local hardware.

### 2. Quality Presets
Choose the balance between speed and detail (mapped to Meshy capabilities):

| Preset | Description | Features |
|--------|-------------|----------|
| **Balanced** | Standard Generation | Good topology, balanced detail, standard PBR. |
| **High** | Enhanced Detail | Higher polygon count, refined textures. |

### 3. Advanced 3D Preview & Analysis
- **Inspector Panel**: Full control over visual properties, grid, and lighting.
- **Retexture Controls**: Re-generate textures using text prompts via Meshy's Text-to-Texture API.
- **Mesh Analysis**: Automatic checks for *Watertight* and *Manifold* geometry (crucial for 3D printing).
- **Transform Controls**: Scale (uniform/per-axis), rotate, and real-time dimension visualization.

### 4. STL Printer Simulation
- **Machine Configuration**: Select from presets (Bambu Lab P1S, Ender 3 V3, etc.) or custom config.
- **Build Platform Visualization**: Real-time visualization on the build plate with accurate dimensions.
- **Orientation Analysis**: Automatic detection of optimal orientation.
- **Print Time Estimation**: Estimate print duration based on machine parameters.

### 5. Dimensional Scaling
- **Uniform & Per-Axis**: Scale models proportionally or stretch specific axes.
- **Unit System**: Automatic conversion to Millimeters (mm).
- **Export Ready**: Scaling is applied directly to the geometry upon export.

---

## App Flow

ProtoScale-AI uses a streamlined **5-step workflow**:

```
STEP 0: UPLOAD & CONFIGURE
┌──────────────────────────────────────────────────────────────┐
│  UI Controls:                                                 │
│  - Quality Preset: Balanced / High                           │
│  - Remove Background: Toggle (uses local U2Net)              │
│  - AI Model: Meshy-6 (Default)                               │
│                                                               │
│  Backend Action:                                              │
│  - Upload image → Assign Job ID                              │
│  - GPU 0: Local Background removal task (if enabled)         │
└──────────────────────────────────────────────────────────────┘
                          ↓
STEP 1: GENERATE (CLOUD PIPELINE)
┌──────────────────────────────────────────────────────────────┐
│  Meshy AI Processing:                                         │
│  - Image-to-3D Conversion                                    │
│  - Geometry Refinement                                       │
│  - PBR Texture Synthesis                                     │
│                                                               │
│  Backend Architecture:                                       │
│  - Polling service monitors Meshy API status                 │
│  - Auto-downloads GLB upon completion                        │
└──────────────────────────────────────────────────────────────┘
                          ↓
STEP 2: PREVIEW & CALIBRATE
┌──────────────────────────────────────────────────────────────┐
│  Inspector Panel:                                             │
│  - Transform: Set X/Y/Z dimensions in mm                     │
│  - Analysis: Check "Watertight" & "Manifold" status          │
│  - View: Toggle Grid, Lighting adjustment                    │
│                                                               │
│  Interactive Viewer:                                         │
│  - Orbit/Zoom/Pan with TresJS                                │
│  - Real-time bounding box visualization                      │
└──────────────────────────────────────────────────────────────┘
                          ↓
STEP 3: PRINT SIMULATION (Optional)
┌──────────────────────────────────────────────────────────────┐
│  Machine Selection:                                            │
│  - Preset printers: Bambu Lab P1S, Ender 3 V3, Prusa i3      │
│  - Custom machine configuration                              │
│                                                               │
│  Analysis & Visualization:                                    │
│  - Build platform visualization                              │
│  - Support structure preview                                 │
└──────────────────────────────────────────────────────────────┘
                          ↓
STEP 4: EXPORT
┌──────────────────────────────────────────────────────────────┐
│  Formats:                                                     │
│  - STL (Binary): Ready for Slicer (Cura/Bambu)               │
│  - OBJ: Source mesh for Blender editing                      │
│  - GLB: Web-ready asset                                      │
│                                                               │
│  Final Processing:                                            │
│  - Apply user scaling to raw geometry                        │
│  - Generate binary output                                    │
└──────────────────────────────────────────────────────────────┘
```

---

## Configuration

### Environment Variables

| Variable | Description |
|----------|-------------|
| `MESHY_API_KEY` | **Required**. Your API Key from Meshy.ai |
| `MESHY_API_URL` | Optional. Base URL for Meshy API (Default: https://api.meshy.ai/v1) |
| `REMBG_MODEL` | Model for local background removal (Default: `u2net`) |
| `GEOMETRY_DEVICE` | Local GPU ID for background removal (e.g., `cuda:0`) |

---

## Troubleshooting

### 1. Generation Failed
**Symptom**: Job status turns to "Failed" after submission.
**Fix**:
- Check your `MESHY_API_KEY` in the `.env` file.
- Verify you have sufficient credits on your Meshy account.
- Check the backend logs for specific API error messages.

### 2. Background Removal Issues
**Symptom**: Poor cutout quality.
**Fix**:
- Ensure the input image has high contrast between the subject and background.
- "u2net" runs locally; ensure your local GPU/CPU is functioning correctly.

### 3. Frontend Connection Refused
**Symptom**: "Network Error" when uploading.
**Fix**:
- Ensure backend is running (`uvicorn app.main:app`).
- Check `VITE_API_URL` in `frontend/.env` matches the backend port (Default: 8077).

---

## Credits

- **Core AI**: [Meshy AI](https://meshy.ai/)
- **Background Removal**: [rembg](https://github.com/danielgatis/rembg)
- **3D Engine**: [Three.js](https://threejs.org/) & [TresJS](https://tresjs.org/)

---

<div align="center">

**Bridging the gap between imagination and reality.**
*Dedicated to empowering the global 3D Printing Community, one layer at a time.*

Create by Lee Khan

</div>
