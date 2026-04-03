# EPO Tracker SaaS - Deployment Guide

## Quick Start (Local Development)

### 1. Backend Setup

```bash
cd backend
python -m venv venv
source venv/bin/activate  # or venv\Scripts\activate on Windows
pip install -r requirements.txt

# Copy and fill in environment variables
cp .env.example .env
# Edit .env with your actual keys

# Run database migrations
alembic upgrade head

# Start the API server
uvicorn app.main:app --reload --port 8000
```

### 2. Frontend Setup

```bash
cd frontend
npx create-next-app@latest epo-tracker --typescript --tailwind --app
cd epo-tracker

# Install dependencies
npm install @shadcn/ui recharts next-auth lucide-react

# Copy the dashboard preview component
# Then start dev server
npm run dev
```

## Production Deployment

### Option A: Vercel + Railway (Recommended)

**Frontend (Vercel):**
1. Push frontend to GitHub
2. Connect repo to Vercel
3. Set environment variables in Vercel dashboard
4. Deploy (automatic on push)

**Backend (Railway):**
1. Push backend to GitHub
2. Create new Railway project
3. Add PostgreSQL addon (or use Supabase)
4. Add Redis addon
5. Set all environment variables from .env.example
6. Deploy from GitHub repo

### Option B: Supabase + Vercel

**Database (Supabase):**
1. Create Supabase project at supabase.com
2. Get the connection string from Settings > Database
3. Use as DATABASE_URL in backend config
4. Supabase also provides Auth - can replace NextAuth

**Backend (Fly.io):**
1. Install flyctl: `curl -L https://fly.io/install.sh | sh`
2. `fly launch` in backend directory
3. Set secrets: `fly secrets set DATABASE_URL=... ANTHROPIC_API_KEY=...`
4. Deploy: `fly deploy`

### Option C: AWS (Enterprise Scale)

- ECS Fargate for backend containers
- RDS for PostgreSQL
- ElastiCache for Redis
- CloudFront + S3 for frontend
- SES for transactional emails

## Required API Keys

### Claude API (AI Email Parsing)
1. Go to console.anthropic.com
2. Create an API key
3. Set as ANTHROPIC_API_KEY

### Google OAuth (Gmail Integration)
1. Go to Google Cloud Console
2. Create OAuth 2.0 credentials
3. Add authorized redirect URIs:
   - http://localhost:8000/api/auth/oauth/google/callback (dev)
   - https://api.yourdomain.com/api/auth/oauth/google/callback (prod)
4. Enable Gmail API and Google Sheets API

### Microsoft OAuth (Outlook Integration)
1. Go to Azure Portal > App registrations
2. Register a new application
3. Add redirect URIs:
   - http://localhost:8000/api/auth/oauth/microsoft/callback (dev)
   - https://api.yourdomain.com/api/auth/oauth/microsoft/callback (prod)
4. Add API permissions: Mail.Read, Mail.ReadWrite

## Domain & DNS

For production, set up:
- `app.epotracker.com` -> Vercel frontend
- `api.epotracker.com` -> Railway/Fly.io backend
- `*.epotracker.com` -> Vercel (for subdomain multi-tenancy)

## SSL/TLS
- Vercel and Railway provide automatic SSL
- Fly.io provides automatic SSL with `fly certs add`

## Monitoring
- Sentry for error tracking (both frontend and backend)
- Railway/Fly.io dashboards for server metrics
- Supabase dashboard for database metrics
