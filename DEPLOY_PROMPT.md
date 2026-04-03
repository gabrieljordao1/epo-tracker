# Deployment Prompt for Claude Code

Copy everything below and paste it into Claude Code on your laptop while in the `epo-saas` folder.

---

```
I need you to deploy this EPO Tracker app to the cloud for free so my team of 2-5 people can test it. The app has a FastAPI backend in `backend/` and a Next.js frontend in `frontend/`.

Here's the plan — deploy using free tiers:

## 1. Push to GitHub
First, initialize a git repo (if not already), commit everything, and push to a new GitHub repo called `epo-tracker`. Use `gh` CLI if available, otherwise walk me through it.

## 2. Set up Supabase (free PostgreSQL)
I need to create a Supabase account and project. Walk me through it step by step and tell me what to copy (the DATABASE_URL connection string). Wait for me to give you the connection string before continuing.

## 3. Set up Resend (free email sending)
I need to create a Resend account for sending follow-up emails. Walk me through getting an API key. Wait for me to give you the key.

## 4. Deploy Backend to Railway
Once I have the Supabase URL and Resend key, deploy the backend:
- Install Railway CLI: `npm i -g @railway/cli && railway login`
- Create project: `railway init`
- Set the root directory to `backend`
- Add these env vars:
  - ENVIRONMENT=production
  - SECRET_KEY=(generate a secure random hex string)
  - DATABASE_URL=(my Supabase connection string)
  - RESEND_API_KEY=(my Resend key)
  - EMAIL_FROM_ADDRESS=noreply@epotracker.com
  - EMAIL_FROM_NAME=EPO Tracker
  - APP_URL=(will update after Vercel deploys)
  - CORS_ORIGINS=(will update after Vercel deploys)
- Deploy and get the live URL
- Run database migrations: `railway run alembic upgrade head`

## 5. Deploy Frontend to Vercel
- Install Vercel CLI: `npm i -g vercel`
- `cd frontend && vercel`
- Set NEXT_PUBLIC_API_URL to the Railway backend URL
- Deploy

## 6. Final Steps
- Update Railway's CORS_ORIGINS and APP_URL with the actual Vercel URL
- Test: open the Vercel URL, register an account, create an EPO manually
- Confirm everything works

Walk me through each step one at a time. Wait for my input at each step where I need to create accounts or copy keys. Don't skip ahead.
```
