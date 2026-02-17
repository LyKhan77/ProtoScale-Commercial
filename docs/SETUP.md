# ProtoScale-AI Setup Guide

Complete setup guide for deploying ProtoScale-AI (Cloud Mode with Meshy AI).

## Overview

**Architecture:**
- Frontend: Vue 3 → Vercel
- Backend: FastAPI (Orchestrator) → Local Server / VPS
- AI Engine: Meshy AI (Cloud API)

**Tech Stack:**
- Backend: Python 3.10+, FastAPI
- Frontend: Vue 3, Vite, Three.js
- External Service: Meshy AI

---

## Prerequisites

- Ubuntu server (or any OS with Python support)
- Python 3.10+
- Meshy AI API Key (Pro Subscription recommended)
- Domain name (optional, for SSL)

---

## Part 1: Backend Setup

### Install Dependencies

```bash
cd backend
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

### Configuration

**Environment Variables:**

1. Copy `.env.example` to `.env`:
   ```bash
   cp .env.example .env
   ```

2. Edit `.env` and set your Meshy API key:
   ```bash
   MESHY_API_KEY=msy_your_actual_key_here
   MESHY_API_URL=https://api.meshy.ai/v1
   ```

3. Get your API key from: https://app.meshy.ai/api-keys

4. Set your backend API key (for frontend authentication):
   ```bash
   export PROTOSCALE_API_KEY="your-backend-api-key"
   ```

**Important:** Never commit `.env` files to version control. The `.env` file is already in `.gitignore`.

### Run Server

```bash
# Development
uvicorn app.main:app --host 0.0.0.0 --port 8077 --reload

# Production (systemd recommended)
# See systemd example in previous docs, just remove GPU env vars.
```

---

## Part 2: Frontend Setup

### Configuration

Create `.env.local` or `.env.production`:

```bash
VITE_API_URL=http://localhost:8077
# Or https://your-domain.com
VITE_API_KEY=your-backend-api-key
```

### Build & Run

```bash
cd frontend
npm install
npm run dev
```

---

## Part 3: Verify

1. Open Frontend in browser.
2. Upload image.
3. Click Generate.
4. Monitor logs in backend to see Meshy API interaction.