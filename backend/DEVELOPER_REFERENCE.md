# Developer Quick Reference - Gmail Agent System

Fast lookup guide for developers working with the Gmail webhook system.

## File Locations

```
app/
├── api/
│   └── gmail_webhook.py          # Webhook endpoints
├── services/
│   ├── gmail_api.py              # Gmail REST API client
│   ├── agent_pipeline.py         # Email processing orchestrator
│   └── scheduler.py              # (modified) Added watch renewal & follow-ups
├── models/
│   ├── models.py                 # (modified) Added EmailConnection fields & WebhookLog
│   └── schemas.py                # (modified) Added 4 new Pydantic models
├── core/
│   └── config.py                 # (modified) Added 4 new settings
└── main.py                       # (modified) Added gmail_webhook router

alembic/
└── versions/
    └── 003_add_webhook_and_oauth_support.py  # Database migration

Documentation:
├── GMAIL_AGENT_INTEGRATION.md    # Full technical docs
├── GMAIL_SETUP_GUIDE.md          # Deployment instructions
├── IMPLEMENTATION_SUMMARY.md     # What was built
└── DEVELOPER_REFERENCE.md        # This file
```

## API Endpoints

### Public Endpoints (No Auth)

#### `POST /api/webhook/gmail`
Receives Google Cloud Pub/Sub push notifications.

**Usage**: Called automatically by Google Cloud Pub/Sub
```bash
curl -X POST http://localhost:8000/api/webhook/gmail \
  -H "Content-Type: application/json" \
  -d '{
    "message": {
      "data": "eyJlbWFpbEFkZHJlc3MiOiJ0ZXN0QGdtYWlsLmNvbSIsImhpc3RvcnlJZCI6IjEyMzQ1In0="
    }
  }'
```

**Response**: `{"status": "ok"}` (always 200, even if processing fails)

---

### Protected Endpoints (Requires JWT Auth)

#### `POST /api/webhook/gmail/setup`
Register Gmail watch for company's email connections.

**Usage**: Call after user authenticates with Gmail
```bash
curl -X POST http://localhost:8000/api/webhook/gmail/setup \
  -H "Authorization: Bearer {JWT_TOKEN}" \
  -H "Content-Type: application/json"
```

**Response**:
```json
{
  "success": true,
  "message": "Gmail webhooks registered successfully",
  "watch_expiration": "2024-04-11T14:30:00"
}
```

## Service Classes

### GmailAPIService (`app/services/gmail_api.py`)

```python
from app.services.gmail_api import GmailAPIService

gmail_api = GmailAPIService(
    client_id=settings.GOOGLE_CLIENT_ID,
    client_secret=settings.GOOGLE_CLIENT_SECRET,
)

# Register Gmail watch (7-day subscription)
result = await gmail_api.setup_watch(
    access_token=email_conn.access_token,
    refresh_token=email_conn.refresh_token,
    token_expires_at=email_conn.token_expires_at,
    email_address="user@gmail.com",
    pubsub_topic="projects/PROJECT/topics/TOPIC",
)
# Returns: {"success": True, "history_id": "...", "watch_expiration": datetime}

# Get message changes since last notification
history = await gmail_api.get_history(
    access_token=token,
    refresh_token=refresh,
    token_expires_at=expiry,
    start_history_id="12345",
)
# Returns: {"success": True, "messages": ["id1", "id2"], "next_history_id": "12346"}

# Fetch full message by ID
msg = await gmail_api.get_message(
    access_token=token,
    refresh_token=refresh,
    token_expires_at=expiry,
    message_id="msg123",
)
# Returns: {"success": True, "subject": "...", "from": "...", "body": "..."}

# Fetch all messages since date
messages = await gmail_api.get_messages_since(
    access_token=token,
    refresh_token=refresh,
    token_expires_at=expiry,
    since_date=datetime.utcnow() - timedelta(days=7),
    max_results=50,
)
# Returns: [{"subject": "...", "from": "...", "body": "..."}, ...]
```

### AgentPipelineService (`app/services/agent_pipeline.py`)

```python
from app.services.agent_pipeline import AgentPipelineService

agent = AgentPipelineService()

# Process incoming email
result = await agent.process_new_email(
    session=db_session,
    email_subject="Re: Extra Work Order",
    email_body="Please approve this...",
    vendor_email="vendor@example.com",
    company_id=1,
    email_connection_id=5,
)
# Returns:
# {
#   "success": True,
#   "epo_id": 42,
#   "vendor_token": "xyz...",
#   "confidence_score": 0.85,
#   "parse_model": "haiku",
#   "needs_review": False,
#   "confirmation_email_sent": True,
#   "created": True,
# }

# Process vendor reply to detect confirmation
reply_result = await agent.process_vendor_reply(
    session=db_session,
    email_subject="RE: EPO Request",
    email_body="Confirmed! PO-12345",
    vendor_email="vendor@example.com",
    company_id=1,
)
# Returns:
# {
#   "success": True,
#   "epo_id": 42,
#   "new_status": "confirmed",
#   "changes_made": True,
# }

# Run follow-up checks (called by scheduler)
followup_result = await agent.run_followup_check(
    session=db_session,
    company_id=1,
)
# Returns:
# {
#   "success": True,
#   "epos_checked": 12,
#   "followups_sent": 3,
#   "errors": [],
# }
```

## Database Models

### EmailConnection (Updated)

```python
from app.models.models import EmailConnection

# New fields added:
email_connection.access_token        # OAuth access token
email_connection.refresh_token       # OAuth refresh token
email_connection.token_expires_at    # Token expiration time
email_connection.gmail_history_id    # Last processed historyId
email_connection.watch_expiration    # Gmail watch expiration
```

### WebhookLog (New)

```python
from app.models.models import WebhookLog

# Track all incoming webhooks
webhook_log = WebhookLog(
    company_id=1,
    source="gmail",
    payload_hash="abc123...",  # SHA-256 of payload
    status="completed",         # or "failed", "processing", "received"
    error_message=None,
)

# Query webhook logs
logs = session.execute(
    select(WebhookLog)
    .where(WebhookLog.company_id == 1)
    .order_by(WebhookLog.created_at.desc())
).scalars().all()
```

## Scheduler Jobs

### Existing Jobs
- `update_days_open` - Every hour at :00 (updates days_open counter)
- `auto_followups` - Daily at 9 AM (sends follow-ups for old pending EPOs)

### New Jobs
- `renew_gmail_watches` - Weekly Monday 2 AM (renews 7-day subscriptions)
- `smart_followup_check` - Daily 10 AM (sends strategic follow-ups)

```python
# Jobs are defined in app/services/scheduler.py
# Add new jobs with scheduler.add_job()
```

## Configuration

### Environment Variables

```bash
# Gmail OAuth
GOOGLE_CLIENT_ID=xxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=xxx

# Gmail Webhooks
GMAIL_PUBSUB_TOPIC=projects/PROJECT_ID/topics/epo-tracker-gmail
GMAIL_WEBHOOK_URL=https://api.yourdomain.com/api/webhook/gmail

# Agent Pipeline
AGENT_AUTO_CONFIRM_THRESHOLD=0.9  # Confidence to auto-create EPO
AGENT_FOLLOWUP_DAYS=[3,5,7]       # When to send follow-ups

# Existing (required for parsing)
ANTHROPIC_API_KEY=xxx
GOOGLE_AI_API_KEY=xxx
RESEND_API_KEY=xxx
```

### Default Settings

```python
from app.core.config import get_settings

settings = get_settings()

# New settings
settings.GMAIL_PUBSUB_TOPIC         # Topic for Pub/Sub notifications
settings.GMAIL_WEBHOOK_URL          # Webhook URL
settings.AGENT_AUTO_CONFIRM_THRESHOLD   # 0.9 by default
settings.AGENT_FOLLOWUP_DAYS        # [3, 5, 7] by default
```

## Common Tasks

### Manually Trigger Follow-up Check

```python
from app.services.agent_pipeline import AgentPipelineService
from app.core.database import async_session_maker

async def trigger_followups():
    agent = AgentPipelineService()
    async with async_session_maker() as session:
        result = await agent.run_followup_check(session, company_id=1)
        print(f"Sent {result['followups_sent']} follow-ups")
```

### Manually Renew Gmail Watches

```python
from app.services.scheduler import renew_gmail_watches

async def trigger_renewal():
    await renew_gmail_watches()
```

### Query Webhook Logs

```python
from sqlalchemy import select
from app.models.models import WebhookLog
from app.core.database import async_session_maker

async def check_webhooks():
    async with async_session_maker() as session:
        query = select(WebhookLog).where(
            WebhookLog.company_id == 1
        ).order_by(WebhookLog.created_at.desc()).limit(10)

        result = await session.execute(query)
        logs = result.scalars().all()

        for log in logs:
            print(f"{log.source}: {log.status} - {log.error_message}")
```

### Find Pending EPOs

```python
from sqlalchemy import select
from app.models.models import EPO, EPOStatus

async def get_pending_epos(company_id):
    async with async_session_maker() as session:
        query = select(EPO).where(
            (EPO.company_id == company_id) &
            (EPO.status == EPOStatus.PENDING)
        )

        result = await session.execute(query)
        return result.scalars().all()
```

## Logging

Logs are organized by service:

```python
import logging

# Service loggers
logger = logging.getLogger(__name__)

# Webhook logger
logger.info("Gmail notification queued: test@gmail.com, historyId=12345")

# Agent logger
logger.info("Created EPO #42 from email, confidence=0.85")

# Gmail API logger
logger.info("Gmail watch registered for test@gmail.com, expires: 2024-04-11T14:30:00")
```

### Log Levels

- **DEBUG**: Token operations, message IDs, detailed processing steps
- **INFO**: EPO creation, email sends, follow-ups, watch renewals
- **WARNING**: Email send failures, missing connections
- **ERROR**: Parse failures, API errors, token refresh failures

### View Logs

```bash
# Docker
docker logs backend-container | grep "Gmail notification"

# Local
tail -f backend.log | grep "EPO"

# Systemd
journalctl -u epo-tracker -f
```

## Error Handling

### Common Errors and Solutions

| Error | Cause | Solution |
|-------|-------|----------|
| `No email connection found` | User hasn't done OAuth | Direct user to Gmail OAuth flow |
| `Token refresh failed` | Tokens revoked | Ask user to re-authenticate |
| `GMAIL_PUBSUB_TOPIC not configured` | Env var not set | Add to .env and restart |
| `Failed to get history` | API call failed | Check access_token validity, logs |
| `Email send failed` | Resend API error | Check RESEND_API_KEY, rate limits |
| `Low confidence` | Parser couldn't extract data | Email marked for manual review |

## Testing

### Test Webhook Locally

```python
# Create test payload
import base64
import json

data = {
    "emailAddress": "test@gmail.com",
    "historyId": "12345"
}
payload = base64.b64encode(json.dumps(data).encode()).decode()

# Send test
import httpx
async with httpx.AsyncClient() as client:
    response = await client.post(
        "http://localhost:8000/api/webhook/gmail",
        json={
            "message": {"data": payload},
            "subscription": "test"
        }
    )
    print(response.json())  # {"status": "ok"}
```

### Test Email Processing

```python
# Create test email
from app.services.email_parser import EmailParserService

parser = EmailParserService()
result = await parser.parse_email(
    email_subject="Extra work needed at Lot 42",
    email_body="We need flooring done. $5000. - John",
    vendor_email="john@flooring.com"
)
print(f"Confidence: {result['confidence_score']}")
print(f"Parser: {result['parse_model']}")
```

## Performance Tips

1. **Token Refresh**: Happens automatically, but uses google-auth (external API call)
   - Refreshed 5 minutes before expiry
   - Cache tokens to avoid unnecessary refreshes

2. **Message Fetching**: Async but sequential per message
   - Could be parallelized if needed
   - Currently ~1-2 sec per message

3. **Database**: Use connection pooling
   - Default: 20 connections, 10 overflow
   - Adjust in DATABASE_URL or DB_POOL_SIZE

4. **Webhook Processing**: Returns 200 immediately
   - Background task processes async
   - Max 10 seconds for Pub/Sub response
   - Deduplication prevents double-processing

## Debugging Checklist

- [ ] Check OAuth tokens exist in database
- [ ] Verify GMAIL_PUBSUB_TOPIC is set
- [ ] Check Pub/Sub subscription push endpoint is correct
- [ ] Verify webhook URL is publicly accessible
- [ ] Check webhook_logs table for notification history
- [ ] Look for "Email send failed" in logs (Resend issues)
- [ ] Check confidence_score of failed EPOs (< 0.6)
- [ ] Verify scheduler is running (look for job logs)
- [ ] Check token expiry dates (should be recent)

## Quick Debug Query

```sql
-- Overall system health
SELECT
    (SELECT COUNT(*) FROM webhook_logs WHERE created_at > NOW() - INTERVAL 24 HOUR) as recent_webhooks,
    (SELECT COUNT(*) FROM epos WHERE synced_from_email AND created_at > NOW() - INTERVAL 24 HOUR) as epos_created_today,
    (SELECT COUNT(*) FROM epo_followups WHERE status = 'SENT' AND created_at > NOW() - INTERVAL 7 DAYS) as followups_sent_week;

-- Check watches
SELECT email_address, watch_expiration, gmail_history_id
FROM email_connections
WHERE provider = 'gmail'
AND watch_expiration IS NOT NULL;

-- Check recent EPOs
SELECT id, vendor_email, confidence_score, parse_model, needs_review, created_at
FROM epos
WHERE synced_from_email
ORDER BY created_at DESC
LIMIT 5;

-- Check failures
SELECT COUNT(*), status
FROM webhook_logs
GROUP BY status;
```

---

**Last Updated**: April 4, 2024
**Version**: 1.0.0
