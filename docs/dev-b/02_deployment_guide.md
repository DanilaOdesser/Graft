# DEV-B Deployment Guide — Frontend on Vercel

---

## Prerequisites

- Vercel account (free tier works)
- Frontend code pushed to GitHub
- DEV-A's backend URL (from Render deployment)

---

## Deployment Steps

### 1. Connect to Vercel

1. Go to [vercel.com](https://vercel.com), click "Add New Project"
2. Import your GitHub repository
3. Settings:
   - **Framework Preset:** Vite
   - **Root Directory:** `frontend`
   - **Build Command:** `npm run build` (default)
   - **Output Directory:** `dist` (default)

### 2. Environment Variables

Set in Vercel dashboard → Settings → Environment Variables:

| Variable | Value | Example |
|----------|-------|---------|
| `VITE_API_URL` | DEV-A's Render backend URL | `https://graft-backend.onrender.com/api` |

**Important:** The variable must be prefixed with `VITE_` for Vite to expose it to the client.

### 3. Deploy

Click "Deploy". Vercel auto-builds and deploys.

### 4. Tell DEV-A Your URL

Once deployed, your URL will be something like `https://graft-frontend.vercel.app`.

**DEV-A needs to add this URL** to their CORS `allow_origins` list in `backend/main.py` and redeploy:

```python
allow_origins=[
    "http://localhost:5173",
    "https://graft-frontend.vercel.app",  # <-- your Vercel URL
]
```

---

## Verification Checklist

```
[ ] App loads at Vercel URL without errors
[ ] Console shows no CORS errors
[ ] Conversation list loads (data from Supabase via Render backend)
[ ] Can click into a conversation and see messages
[ ] Search page works: enter query, get results
[ ] Import modal works: select branch, import succeeds
[ ] Pins panel shows pinned nodes
```

---

## Troubleshooting

**Blank page / React error:**
- Check browser console for errors
- Most likely: `VITE_API_URL` not set → API calls go to `undefined`
- Fix: set the env var in Vercel dashboard and redeploy

**CORS errors:**
- Browser console shows `Access-Control-Allow-Origin` error
- Fix: DEV-A adds your Vercel URL to CORS allow_origins and redeploys

**API returns 404:**
- Check that `VITE_API_URL` includes `/api` at the end
- Check that DEV-A's routes use the same prefix

**Build fails on Vercel:**
- Check build logs for missing dependencies
- Common issue: a dev dependency used at runtime — move it to `dependencies` in `package.json`

**"Cannot read properties of undefined":**
- API response shape might differ from what the component expects
- Check DEV-A's endpoint response format and adjust your components

---

## Auto-Deploy

Vercel auto-deploys on every push to the connected branch. After the initial deploy, just push your code and it rebuilds.

For the final merge (merge point 3), both devs push to main → Vercel auto-deploys the merged frontend.
