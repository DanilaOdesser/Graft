# DEV-A Deployment Guide — Backend on Render

---

## Prerequisites

- Render account (free tier works)
- Backend code pushed to GitHub
- Supabase connection string from Phase 0

---

## Option 1: Render with Dockerfile (Recommended)

### Dockerfile

Create `backend/Dockerfile`:

```dockerfile
FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
```

### Render Setup

1. Go to [render.com](https://render.com), create a new "Web Service"
2. Connect your GitHub repo
3. Settings:
   - **Root directory:** `backend`
   - **Build command:** (handled by Dockerfile)
   - **Environment:** Docker
4. Environment variables:
   - `DATABASE_URL` = your Supabase connection string
   - `ANTHROPIC_API_KEY` = your API key (optional, agent falls back to stub without it)

### CORS Configuration

In `backend/main.py`, add CORS middleware:

```python
from fastapi.middleware.cors import CORSMiddleware

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",          # Local Vite dev server
        "https://your-app.vercel.app",    # DEV-B's Vercel deployment
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
```

**Important:** Update `allow_origins` with DEV-B's actual Vercel URL once they deploy.

---

## Option 2: Render without Docker

If Docker gives trouble:

1. Create a new "Web Service" on Render
2. Settings:
   - **Root directory:** `backend`
   - **Build command:** `pip install -r requirements.txt`
   - **Start command:** `uvicorn main:app --host 0.0.0.0 --port $PORT`
   - **Environment:** Python 3
3. Same env vars as above

---

## Verification Checklist

After deploy:

```bash
# Health check
curl https://your-backend.onrender.com/health
# Expected: {"status": "ok"}

# Test an endpoint against deployed backend
curl https://your-backend.onrender.com/api/conversations?owner_id=<uuid>
# Expected: list of conversations from seed data

# Test context assembly
curl https://your-backend.onrender.com/api/nodes/<node-uuid>/context?budget=5000
# Expected: ordered list of context nodes
```

---

## Troubleshooting

**"Connection refused" to Supabase:**
- Check that the DATABASE_URL uses `postgresql://` not `postgres://`
- Supabase might need SSL: append `?sslmode=require` to the connection string

**CORS errors from frontend:**
- Verify the Vercel URL is in `allow_origins`
- Check browser console for the exact origin being blocked

**Render deploy fails:**
- Check build logs for missing dependencies
- Make sure `requirements.txt` includes all deps: `fastapi`, `uvicorn`, `sqlalchemy`, `psycopg2-binary`, `python-dotenv`

**Slow cold starts (Render free tier):**
- First request after idle takes 30-60 seconds — this is normal on free tier
- Mention it in the demo: "The first request spins up the server"
