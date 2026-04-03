# EPO Tracker Backend Setup

This is a complete, production-ready FastAPI backend for the EPO Tracker SaaS application.

## Features

- **SQLite Database** for local development (auto-created on startup)
- **Async/Await** throughout using SQLAlchemy async
- **Multi-tier Email Parser**:
  - Tier 1: Regex patterns (free, instant)
  - Tier 2: Google Gemini Flash (cheap)
  - Tier 3: Claude Haiku (reliable fallback)
- **JWT Authentication** with bcrypt password hashing
- **Demo Endpoints** for testing without email setup
- **CORS Enabled** for localhost:3000, 5173, and 8000

## Setup

### 1. Install Dependencies

```bash
pip install -r requirements.txt
```

### 2. Configure Environment

Copy `.env.example` to `.env` and update as needed:

```bash
cp .env.example .env
```

Key environment variables:
- `DATABASE_URL`: SQLite path (default: `sqlite+aiosqlite:///./epo_tracker.db`)
- `SECRET_KEY`: JWT secret (change in production!)
- `ANTHROPIC_API_KEY`: Optional, for Claude Haiku parsing
- `GOOGLE_AI_API_KEY`: Optional, for Gemini Flash parsing

### 3. Run the Server

```bash
python run.py
```

Or use uvicorn directly:

```bash
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

The server starts on `http://localhost:8000`

- API Docs: `http://localhost:8000/docs`
- OpenAPI JSON: `http://localhost:8000/openapi.json`
- Health Check: `http://localhost:8000/api/health`

## API Endpoints

### Authentication

- `POST /api/auth/register` - Create company + admin user
- `POST /api/auth/login` - Login with email/password
- `GET /api/auth/me` - Get current user

### EPOs

- `GET /api/epos` - List EPOs (with filtering)
- `POST /api/epos` - Create manual EPO
- `GET /api/epos/{id}` - Get EPO details
- `PUT /api/epos/{id}` - Update EPO
- `GET /api/epos/stats/dashboard` - Get dashboard stats
- `POST /api/epos/{id}/followup` - Create followup

### Email Connections

- `POST /api/email/connect` - Register email connection
- `GET /api/email/status` - Get connection status
- `POST /api/email/sync` - Trigger email sync

### Demo (for video/testing)

- `POST /api/demo/seed` - Seed with 25 realistic demo EPOs
- `POST /api/demo/simulate-email` - Parse email and create EPO
- `POST /api/demo/reset` - Reset and re-seed demo data

## Demo Workflow

Perfect for LinkedIn video demonstrations:

```bash
# 1. Register a test company
curl -X POST http://localhost:8000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "admin@stancil.com",
    "full_name": "Admin User",
    "password": "password123",
    "company_name": "Stancil Painting & Drywall",
    "industry": "paint"
  }'

# 2. Seed with demo data
curl -X POST http://localhost:8000/api/demo/seed \
  -H "Authorization: Bearer <token>"

# 3. Simulate receiving an email (no real email setup needed)
curl -X POST http://localhost:8000/api/demo/simulate-email \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "email_subject": "Extra Work Order - Lot 123, Mallard Park",
    "email_body": "Pulte Homes requests additional painting work...",
    "vendor_email": "orders@pultehomes.com"
  }'

# 4. View dashboard stats
curl http://localhost:8000/api/epos/stats/dashboard \
  -H "Authorization: Bearer <token>"
```

## Database

- **Type**: SQLite (aiosqlite for async)
- **File**: `./epo_tracker.db` (auto-created)
- **Models**:
  - Company (paint, drywall, flooring, etc. industries)
  - User (admin, manager, field roles)
  - EPO (pending, confirmed, denied, discount statuses)
  - EPOFollowup (pending, sent, failed statuses)
  - EmailConnection (for email sync setup)

## Email Parser (3-Tier)

The `/api/demo/simulate-email` endpoint demonstrates the parser:

1. **Regex** (instant, free): Extracts vendor, amount, lot, community via patterns
2. **Gemini Flash** (if `GOOGLE_AI_API_KEY` set): Fast AI extraction
3. **Claude Haiku** (if `ANTHROPIC_API_KEY` set): Reliable fallback

Returns:
- Parsed EPO data
- Confidence score (0-1)
- Which model was used
- `needs_review` flag if uncertain

## Architecture

```
app/
├── main.py           # FastAPI app setup
├── core/
│   ├── auth.py      # JWT and password handling
│   ├── config.py    # Environment config
│   └── database.py  # SQLAlchemy setup
├── models/
│   ├── models.py    # SQLAlchemy ORM models
│   └── schemas.py   # Pydantic request/response schemas
├── api/
│   ├── auth.py      # Auth endpoints
│   ├── epos.py      # EPO CRUD endpoints
│   ├── email_sync.py # Email connection endpoints
│   └── demo.py      # Demo/testing endpoints
└── services/
    ├── email_parser.py   # 3-tier email parsing
    ├── email_sync.py     # Email sync service (stub)
    └── google_sheets.py  # Google Sheets integration (stub)
```

## Important Notes

- **Database**: Automatically created on first startup
- **JWT Token**: Default 30-minute expiration
- **Password**: Hashed with bcrypt
- **CORS**: Configured for localhost development
- **No Email Setup Required**: Use demo endpoints for testing

## Production Checklist

Before deploying:
- [ ] Change `SECRET_KEY` in `.env`
- [ ] Set `DEBUG=False` in `.env`
- [ ] Use PostgreSQL instead of SQLite
- [ ] Configure real email sync (Gmail/Outlook OAuth)
- [ ] Set up proper logging
- [ ] Enable HTTPS
- [ ] Configure CORS for production domains
- [ ] Add rate limiting
- [ ] Set up database backups
