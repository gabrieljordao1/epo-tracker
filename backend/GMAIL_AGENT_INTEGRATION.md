# Gmail AI Agent System Implementation

This document describes the Gmail webhook and AI agent pipeline integration added to the EPO Tracker backend.

## Overview

The system enables real-time email processing through:
1. **Gmail Push Notifications** via Google Cloud Pub/Sub
2. **AI Email Parsing** using the existing 3-tier parser (regex → Gemini → Claude Haiku)
3. **Intelligent Agent Pipeline** that auto-creates EPOs, sends confirmations, and processes vendor replies
4. **Smart Follow-up Logic** with strategic timing (3, 5, 7 days)

## Components

### 1. Database Models (app/models/models.py)

#### EmailConnection (Updated)
Added OAuth token storage for webhook compatibility:
```python
access_token: str          # Bearer token for Gmail API
refresh_token: str         # Refresh token for token renewal
token_expires_at: DateTime # When the token expires
gmail_history_id: str      # Last processed message history ID
watch_expiration: DateTime # When the Gmail watch subscription expires
```

#### WebhookLog (New)
Tracks all incoming webhook notifications:
```python
- id: int
- company_id: int (foreign key)
- source: str              # "gmail" or other providers
- payload_hash: str        # SHA-256 hash of payload for deduplication
- status: str              # received, processing, completed, failed
- error_message: str       # If failed, why
- created_at: DateTime
```

### 2. API Schemas (app/models/schemas.py)

#### GmailWebhookPayload
Structure of Google Cloud Pub/Sub push notifications:
```python
message: dict              # Contains base64-encoded data
subscription: str          # Topic subscription name
```

#### GmailHistoryData
Decoded Gmail notification:
```python
email_address: str
history_id: str
```

#### WebhookSetupResponse
Response from webhook registration:
```python
success: bool
message: str
watch_expiration: Optional[datetime]
```

#### AgentProcessingResult
Result of pipeline processing:
```python
epo_id: int
vendor_token: str
confidence_score: float
parse_model: str
needs_review: bool
confirmation_email_sent: bool
created: bool
```

### 3. Gmail API Service (app/services/gmail_api.py)

High-level Gmail REST API client for webhook-compatible access:

**Key Methods:**
- `setup_watch()` - Registers Gmail push notifications via Pub/Sub
- `get_history()` - Fetches message changes since a historyId
- `get_message()` - Fetches full email by ID (subject, body, headers)
- `get_messages_since()` - Fetches all new messages since a date

**Features:**
- Automatic token refresh (checks expiry, refreshes if within 5 minutes)
- Base64 payload decoding for Gmail API responses
- Structured email extraction (subject, from, to, date, body)

### 4. Agent Pipeline Service (app/services/agent_pipeline.py)

Orchestrates email processing through parsing, creation, and confirmation:

**Key Methods:**

#### `process_new_email()`
Main pipeline entry point:
1. Parses email through existing 3-tier parser
2. Returns immediately if confidence < 0.6 (needs manual review)
3. Auto-creates EPO if confidence >= 0.6
4. Generates unique vendor_token for self-service portal
5. Sends confirmation request email to vendor
6. Marks as needs_review if confidence < 0.8

#### `process_vendor_reply()`
Detects vendor confirmations/disputes:
1. Searches for confirmation keywords ("approved", "confirmed", "ok", etc.)
2. Extracts confirmation numbers using regex patterns
3. Checks for dispute keywords ("deny", "reject", "unable", etc.)
4. Auto-updates EPO status (CONFIRMED or DENIED)

#### `run_followup_check()`
Smart follow-up timing:
1. Scans all pending EPOs for a company
2. Sends follow-ups after 3, 5, and 7 days (configurable)
3. Uses vendor portal URL for easy confirmation
4. Tracks which follow-ups were sent successfully

### 5. Gmail Webhook Router (app/api/gmail_webhook.py)

Two endpoints:

#### `POST /api/webhook/gmail`
- Receives Google Cloud Pub/Sub push notifications
- Returns 200 immediately (Pub/Sub requirement)
- Queues background task for async processing
- Deduplicates notifications using in-memory cache
- Logs all webhooks to WebhookLog table

**Process:**
1. Decode base64 payload
2. Extract emailAddress and historyId
3. Check for duplicates
4. Queue background task to fetch and process messages
5. Return 200 OK immediately

#### `POST /api/webhook/gmail/setup` (Authenticated)
- Registers Gmail push notifications for user's company
- Sets up Gmail watch subscription
- Stores watch expiration time for renewal scheduling
- Returns watch expiration for monitoring

### 6. Scheduler Updates (app/services/scheduler.py)

Added two new scheduled jobs:

#### `renew_gmail_watches()`
- Runs weekly (Monday 2 AM)
- Finds watches expiring within 24 hours
- Renews them before expiry (watches last 7 days)
- Updates watch_expiration timestamp

#### `run_smart_followup_check()`
- Runs daily (10 AM)
- Iterates through all companies
- Triggers follow-up for EPOs at 3, 5, 7-day marks
- Tracks success/failures

## Configuration

### app/core/config.py

Added settings:
```python
GMAIL_PUBSUB_TOPIC: str = ""           # Google Cloud Pub/Sub topic
GMAIL_WEBHOOK_URL: str = ""            # Webhook URL for notifications
AGENT_AUTO_CONFIRM_THRESHOLD: float = 0.9  # Confidence for auto-confirm
AGENT_FOLLOWUP_DAYS: List[int] = [3, 5, 7] # Days to follow up
```

### Database Migration

Created `alembic/versions/003_add_webhook_and_oauth_support.py`:
- Adds OAuth token columns to email_connections
- Creates webhook_logs table
- Includes rollback for safe deployment

## Workflow

### Email Reception Flow

```
Gmail receives email
    ↓
Google Cloud Pub/Sub
    ↓
POST /api/webhook/gmail
    ↓
Decode notification (emailAddress, historyId)
    ↓
Queue background task
    ↓
Return 200 OK to Pub/Sub (fast response required)
    ↓
Background Task (async):
  - Fetch message history since last historyId
  - For each new message:
    - Fetch full message from Gmail API
    - Extract vendor email from "From" field
    - Call agent_pipeline.process_new_email()
    - Auto-create EPO if confidence > 0.6
    - Send confirmation request to vendor
    - Update gmail_history_id for next notification
```

### Vendor Confirmation Flow

```
Vendor receives confirmation email with portal link
    ↓
Option 1: Click vendor portal link
  - vendor_token validated
  - Mark EPO as CONFIRMED in UI

Option 2: Reply to email
    ↓
Gmail receives vendor reply
    ↓
Same flow as above
    ↓
agent_pipeline.process_vendor_reply()
    ↓
Detects keywords/confirmation numbers
    ↓
Auto-updates EPO status to CONFIRMED
```

### Follow-up Flow

```
Daily scheduler runs (10 AM)
    ↓
agent_pipeline.run_smart_followup_check()
    ↓
For each company:
  - Find all pending EPOs
  - Check if 3, 5, or 7 days old
  - Send follow-up email with vendor portal link
  - Log success/failure
```

## Key Design Decisions

### 1. Webhook Response Speed
- Returns 200 immediately (Google Cloud Pub/Sub requires <10s)
- Uses BackgroundTasks for async processing
- No database commits in webhook handler

### 2. Token Management
- Stores access_token and refresh_token in database
- Auto-refreshes tokens that are expiring (within 5 minutes)
- Handles token expiry gracefully

### 3. Deduplication
- In-memory set of recent (emailAddress:historyId) pairs
- Limits cache to 10,000 entries to prevent unbounded growth
- Clears cache when threshold exceeded

### 4. Confidence Scoring
- Uses existing 3-tier parser output
- confidence >= 0.6: auto-create EPO
- confidence < 0.8: mark needs_review flag
- confidence < 0.6: requires manual review

### 5. Vendor Portal URLs
- Format: `{APP_URL}/vendor/{vendor_token}`
- Token: random 32-byte URL-safe string
- Used in both initial confirmation email and follow-ups

### 6. Follow-up Timing
- Smart days (3, 5, 7) instead of fixed rules
- Configurable via AGENT_FOLLOWUP_DAYS
- Allows strategic re-engagement

## Integration with Existing Services

### EmailParserService
- Used unchanged from existing implementation
- Returns standardized dict with confidence_score
- Parses through regex → Gemini → Claude Haiku tiers

### EmailSenderService
- Used for initial confirmation request
- Used for follow-up emails
- Returns success/failure status

### Existing Database Models
- EPO model: already has all required fields
- EmailConnection: extended with OAuth fields
- User/Company/Team: unchanged

## API Endpoints

### Public (No Auth Required)
- `POST /api/webhook/gmail` - Receive Pub/Sub notifications

### Protected (Auth Required)
- `POST /api/webhook/gmail/setup` - Register webhook for company

## Deployment Checklist

### Prerequisites
1. Google Cloud Project with Pub/Sub topic created
2. Gmail OAuth credentials (client_id, client_secret)
3. Pub/Sub subscription pointing to webhook URL
4. Environment variables set:
   ```
   GMAIL_CLIENT_ID=...
   GMAIL_CLIENT_SECRET=...
   GMAIL_PUBSUB_TOPIC=projects/[PROJECT]/topics/[TOPIC]
   GMAIL_WEBHOOK_URL=https://api.example.com/api/webhook/gmail
   ```

### Steps
1. Run database migration: `alembic upgrade head`
2. Deploy new code
3. User authenticates with Gmail
4. Admin calls `POST /api/webhook/gmail/setup` to register watches
5. Gmail notifications start flowing

## Error Handling

### Token Expiry
- Automatic refresh before expiry
- Falls back to existing token if refresh fails
- Next attempt will try again

### Message Fetch Failures
- Logs error with message ID
- Continues with next message
- Updates gmail_history_id to avoid processing same messages

### Email Parsing Failures
- Skips message if parsing fails completely
- Logs error for debugging
- Continues with next message

### Send Failures
- Non-blocking: pipeline continues even if email send fails
- Logs error for manual follow-up
- EPO still created if parsing succeeded

## Monitoring

### WebhookLog Table
- View all incoming notifications
- Status tracking (received → processing → completed/failed)
- Payload hash for deduplication verification
- Created timestamp for rate analysis

### Logging
- DEBUG: Message IDs being processed, token operations
- INFO: EPO creation, confirmation emails, follow-ups
- WARNING: Email send failures, missing connections
- ERROR: Parse failures, API errors with full context

### Metrics to Track
- Notifications received/processed
- EPOs auto-created vs needs_review
- Vendor confirmations (email vs portal)
- Follow-up email send success rate
- Token refresh frequency

## Future Enhancements

1. **Outlook Integration**
   - Create OutlookAPIService following same pattern
   - Add `provider == "outlook"` branches

2. **Vendor Dispute Handling**
   - Auto-escalate denied EPOs
   - Send internal notifications

3. **ML Confidence Tuning**
   - Track parse_model performance
   - Adjust thresholds per parse_model

4. **Batch Processing**
   - Switch to Redis queue for large volumes
   - Process messages in batches per company

5. **Webhook Signing Verification**
   - Verify Pub/Sub signatures (currently basic validation)
   - Add HMAC verification if needed

## Testing

### Test the Webhook Endpoint
```bash
# Simulate Pub/Sub message
curl -X POST http://localhost:8000/api/webhook/gmail \
  -H "Content-Type: application/json" \
  -d '{
    "message": {
      "data": "eyJlbWFpbEFkZHJlc3MiOiAidGVzdEBnbWFpbC5jb20iLCAiaGlzdG9yeUlkIjogIjEyMzQ1In0="
    },
    "subscription": "projects/test/subscriptions/test"
  }'
```

### Test the Setup Endpoint
```bash
# With valid JWT token
curl -X POST http://localhost:8000/api/webhook/gmail/setup \
  -H "Authorization: Bearer {token}" \
  -H "Content-Type: application/json"
```

## Summary

This implementation provides a production-ready Gmail webhook integration with intelligent AI-driven email processing. It handles token management, deduplication, async processing, and graceful error handling while maintaining backward compatibility with the existing EPO system.
