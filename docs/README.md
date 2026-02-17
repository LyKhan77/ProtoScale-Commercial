# ProtoScale-AI Documentation

Simplified documentation for ProtoScale-AI - AI-powered 2D to 3D model generation.

## Documentation Structure

### 1. [SETUP.md](./SETUP.md) - **Start Here**
Complete setup guide from scratch to production deployment.

**What's inside:**
- Nginx reverse proxy installation & SSL configuration
- Backend setup with systemd service
- Frontend configuration
- Vercel deployment
- Testing & troubleshooting
- Maintenance commands

**Read this if you want to:**
- Deploy the application for the first time
- Setup Nginx reverse proxy with SSL
- Configure systemd services
- Deploy to Vercel

---

### 2. [API.md](./API.md) - API Reference
Complete API documentation for developers.

**What's inside:**
- All API endpoints with examples
- Authentication & rate limiting
- Request/response formats
- Error handling
- Client examples (Python, JavaScript)
- CORS configuration

**Read this if you want to:**
- Integrate with the API
- Understand endpoint behavior
- Build a custom frontend
- Debug API issues

---

### 3. [ARCHITECTURE.md](./ARCHITECTURE.md) - System Architecture
Technical deep-dive into system design and AI models.

**What's inside:**
- Complete system architecture diagram
- Network communication flow
- Microservices design patterns
- AI model pipeline (Hunyuan3D-2.1)
- Security architecture
- Scalability considerations
- Performance metrics
- Monitoring & observability

**Read this if you want to:**
- Understand how the system works
- Learn about AI model internals
- Plan for scaling
- Contribute to development
- Design similar systems

---

## Quick Start

**For First-Time Setup:**
```bash
# 1. Read SETUP.md completely
# 2. Follow steps in order
# 3. Test with SETUP.md testing section
```

**For API Integration:**
```bash
# 1. Read API.md for endpoint details
# 2. Get API key from backend admin
# 3. Use client examples as starting point
```

**For System Understanding:**
```bash
# 1. Read ARCHITECTURE.md for overview
# 2. Check specific sections for deep dives
```

---

## Common Tasks

### Deploy to Production
→ Follow [SETUP.md](./SETUP.md) Part 1-5

### Setup Nginx Reverse Proxy
→ See [SETUP.md](./SETUP.md) Part 1

### Setup systemd Services
→ See [SETUP.md](./SETUP.md) Part 2

### Deploy to Vercel
→ See [SETUP.md](./SETUP.md) Part 4

### API Integration
→ See [API.md](./API.md) Client Examples section

### Understand Architecture
→ See [ARCHITECTURE.md](./ARCHITECTURE.md) System Overview

### Troubleshooting
→ See [SETUP.md](./SETUP.md) Troubleshooting section

---

## External Resources

- **Nginx Documentation:** https://nginx.org/en/docs/
- **Let's Encrypt / Certbot:** https://certbot.eff.org/
- **Vercel Documentation:** https://vercel.com/docs
- **FastAPI Documentation:** https://fastapi.tiangolo.com
- **Hunyuan3D Model:** https://github.com/Tencent/Hunyuan3D-2

---

## Support

**Issues & Questions:**
- Check relevant documentation section first
- Review troubleshooting in SETUP.md
- Check service logs: `sudo journalctl -u <service> -f`
- Open GitHub issue for bugs

**Quick Debugging:**
```bash
# Backend status
sudo systemctl status protoscale-backend

# Nginx status
sudo systemctl status nginx

# GPU status
nvidia-smi

# Test backend
curl https://protoscale-be.iotech.my.id/health
```

---

## Document Versions

- **API.md** - Updated: 2026-02-12
- **SETUP.md** - Updated: 2026-02-12
- **ARCHITECTURE.md** - Updated: 2026-02-12

All documents reflect the current Nginx reverse proxy setup with custom domain (`protoscale-be.iotech.my.id`).
