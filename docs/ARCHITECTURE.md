# EPO Tracker SaaS - Architecture

## Overview
A multi-tenant SaaS platform for construction companies to track Extra Paint Orders (EPOs) and Extra Work Orders via automated email parsing, real-time dashboards, and Google Sheets export.

## Tech Stack

### Frontend
- **Next.js 14** (App Router) - React framework with SSR
- **Tailwind CSS** + **shadcn/ui** - Polished, accessible components
- **Recharts** - Dashboard charts and analytics
- **NextAuth.js** - Authentication (Google, email/password)

### Backend
- **FastAPI** (Python) - REST API
- **SQLAlchemy** + **Alembic** - ORM and migrations
- **PostgreSQL** (Supabase or Neon) - Database
- **Celery** + **Redis** - Background email sync jobs
- **Claude API** - AI-powered email parsing

### Infrastructure
- **Vercel** - Frontend hosting
- **Railway** or **Fly.io** - Backend hosting
- **Supabase** - Managed PostgreSQL + Auth
- **Redis Cloud** - Job queue
- **Resend** or **SendGrid** - Transactional emails

## Database Schema

### companies
- id, name, industry, plan_tier, created_at

### users
- id, company_id, email, name, role (admin/member), avatar_url

### email_connections
- id, company_id, provider (gmail/outlook), oauth_token, refresh_token, email_address, last_sync

### epos
- id, company_id, created_by, vendor_name, vendor_email, community, lot_number, lot_code
- description, amount, status (pending/confirmed/denied/discount)
- confirmation_number, days_open, original_subject, original_body
- needs_review, synced_from_email, created_at, updated_at

### epo_followups
- id, epo_id, sent_by, sent_at, message

### google_sheet_connections
- id, company_id, sheet_url, service_account_email, last_push

## API Endpoints

### Auth
- POST /api/auth/register
- POST /api/auth/login
- POST /api/auth/oauth/gmail
- POST /api/auth/oauth/outlook

### Companies
- GET /api/company
- PUT /api/company
- GET /api/company/members

### EPOs
- GET /api/epos?status=&community=&date_from=&date_to=
- POST /api/epos (manual entry)
- PUT /api/epos/:id
- DELETE /api/epos/:id
- POST /api/epos/:id/followup
- GET /api/epos/stats (dashboard analytics)

### Email
- POST /api/email/connect (OAuth flow)
- POST /api/email/sync (trigger manual sync)
- GET /api/email/status

### Export
- POST /api/export/google-sheets
- GET /api/export/xlsx

## Email Parsing Pipeline

1. **Fetch**: IMAP connection via OAuth2 tokens
2. **Filter**: Subject line matching (configurable per company)
3. **Parse**: Claude API extracts: vendor, lot, community, amount, description, confirmation #
4. **Validate**: Check against known communities/vendors
5. **Store**: Save to database with needs_review flag if uncertain
6. **Notify**: Real-time websocket update to connected clients
7. **Sync**: Push to Google Sheet if configured

## Multi-Tenancy

- Row-level security: every query filtered by company_id
- Subdomain routing: company.epotracker.com
- Plan tiers: Free (50 EPOs/mo), Pro ($29/mo), Enterprise (custom)
