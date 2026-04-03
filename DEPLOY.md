# EPO Tracker — Free Deployment Guide

## Architecture (all free tier)

| Service | Role | Free Tier |
|---------|------|-----------|
| **Vercel** | Frontend (Next.js) hosting | Free for hobby projects |
| **Railway** | Backend (FastAPI) hosting | $5 free credit/month |
| **Supabase** | PostgreSQL database | Free: 500MB, 2 projects |
| **Resend** | Transactional emails | Free: 100 emails/day |

**Total cost: $0/month** for a 2-5 person pilot.

---

## Step-by-Step Deployment

### 1. Supabase (Database)
1. Go to https://supabase.com and sign up
2. Create a new project (name: `epo-tracker`, region: closest to you)
3. Wait for it to provision (~2 min)
4. Go to **Settings → Database** and copy the connection string:
   - Format: `postgresql://postgres:[PASSWORD]@db.[PROJECT_REF].supabase.co:5432/postgres`
   - You'll use this as `DATABASE_URL`

### 2. Resend (Email)
1. Go to https://resend.com and sign up
2. Go to **API Keys** → Create a new key
3. Copy the key — this is your `RESEND_API_KEY`
4. (Optional) Add and verify your domain for custom from-address

### 3. Railway (Backend)
1. Go to https://railway.app and sign up with GitHub
2. Click **New Project → Deploy from GitHub repo**
3. Select your `epo-saas` repo, set the **root directory** to `backend`
4. Add these environment variables:
   ```
   ENVIRONMENT=production
   SECRET_KEY=<generate with: python -c "import secrets; print(secrets.token_hex(32))">
   DATABASE_URL=<your Supabase connection string>
   RESEND_API_KEY=<your Resend API key>
   EMAIL_FROM_ADDRESS=noreply@yourdomain.com
   EMAIL_FROM_NAME=EPO Tracker
   APP_URL=https://your-app.vercel.app
   CORS_ORIGINS=https://your-app.vercel.app
   ```
5. Railway auto-detects the `Procfile` and deploys
6. Note your Railway URL (e.g., `https://epo-backend-production.up.railway.app`)

### 4. Run Database Migrations
In Railway's console (or locally with DATABASE_URL set):
```bash
alembic upgrade head
```

### 5. Vercel (Frontend)
1. Go to https://vercel.com and sign up with GitHub
2. Import your `epo-saas` repo
3. Set **root directory** to `frontend`
4. Add environment variable:
   ```
   NEXT_PUBLIC_API_URL=https://your-railway-url.up.railway.app
   ```
5. Deploy — Vercel handles the rest

### 6. Update CORS
Go back to Railway and update `CORS_ORIGINS` to your actual Vercel URL.
Also update `APP_URL` to your Vercel URL.

---

## After Deployment

1. Open your Vercel URL
2. Click **Create Account** to register your company
3. Add your team members via the Team page
4. Start adding EPOs manually or connect Gmail in Settings
5. Share the URL with your team

The vendor portal links work automatically — when you send follow-ups, vendors get a link like:
`https://your-app.vercel.app/vendor?token=abc123`
