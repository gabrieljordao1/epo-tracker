# Gmail Webhook Setup Guide

Step-by-step instructions for configuring Gmail push notifications for the EPO Tracker.

## Prerequisites

1. Google Cloud Project with billing enabled
2. Gmail OAuth credentials (from Google Cloud Console)
3. Backend deployed and accessible at a public URL
4. Database migrations applied (`alembic upgrade head`)

## Step 1: Create Google Cloud Project & Pub/Sub Topic

### 1.1 Create Topic

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Create a new project (or select existing)
3. Enable "Cloud Pub/Sub API"
4. Create a new topic:
   - Name: `epo-tracker-gmail` (or your preferred name)
   - Retain defaults
5. Note the full topic name: `projects/PROJECT_ID/topics/epo-tracker-gmail`

### 1.2 Create Subscription

1. In the Pub/Sub Topic page, create a subscription:
   - Name: `epo-tracker-gmail-webhook`
   - Delivery type: **Push**
   - Push endpoint: `https://api.yourdomain.com/api/webhook/gmail`
   - Service account: Create new or use existing service account
   - Acknowledgement deadline: 10 seconds
2. Create the subscription

## Step 2: Configure Environment Variables

Add these to your `.env` file:

```bash
# Gmail OAuth
GOOGLE_CLIENT_ID=YOUR_CLIENT_ID.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=YOUR_CLIENT_SECRET

# Gmail Webhooks
GMAIL_PUBSUB_TOPIC=projects/PROJECT_ID/topics/epo-tracker-gmail
GMAIL_WEBHOOK_URL=https://api.yourdomain.com/api/webhook/gmail

# Agent Pipeline
AGENT_AUTO_CONFIRM_THRESHOLD=0.9
AGENT_FOLLOWUP_DAYS=[3, 5, 7]
```

Restart the backend service.

## Step 3: Database Migration

Run the migration to add new columns and tables:

```bash
# From backend directory
alembic upgrade head
```

This will:
- Add OAuth token fields to email_connections table
- Create webhook_logs table for tracking notifications
- Create indexes for efficient querying

## Step 4: User Setup (Per Company)

For each company that wants Gmail integration:

### 4.1 Gmail OAuth

1. User goes to email sync page
2. Clicks "Connect Gmail"
3. Completes OAuth flow (provides access & refresh tokens)
4. Tokens are stored in database

### 4.2 Register Webhook

After OAuth, admin calls setup endpoint:

```bash
curl -X POST https://api.yourdomain.com/api/webhook/gmail/setup \
  -H "Authorization: Bearer {JWT_TOKEN}" \
  -H "Content-Type: application/json"
```

Response:
```json
{
  "success": true,
  "message": "Gmail webhooks registered successfully",
  "watch_expiration": "2024-04-11T14:30:00"
}
```

The watch will:
- Monitor INBOX for new messages
- Send notifications to the Pub/Sub topic
- Expire after 7 days (scheduler auto-renews at day 6)

## Step 5: Verify Setup

### 5.1 Test Webhook Delivery

Send a test message to the monitored Gmail account from another email address.

Check logs:
```bash
# Should see:
# INFO: Gmail notification queued: test@gmail.com, historyId=12345
# INFO: Message X processed: created=True, confidence=0.85
```

### 5.2 Check Database

Verify records were created:

```sql
-- Check email connection
SELECT id, email_address, access_token IS NOT NULL, gmail_history_id
FROM email_connections
WHERE email_address LIKE '%gmail.com%';

-- Check webhook logs
SELECT source, status, created_at, error_message
FROM webhook_logs
ORDER BY created_at DESC
LIMIT 10;

-- Check auto-created EPOs
SELECT id, vendor_email, confidence_score, parse_model, needs_review
FROM epos
WHERE synced_from_email = TRUE
ORDER BY created_at DESC
LIMIT 5;
```

## Step 6: Monitor & Troubleshoot

### Webhook Not Receiving Notifications

1. Check Pub/Sub subscription configuration:
   - Verify push endpoint URL is correct and accessible
   - Check service account has publish permissions
   - Ensure subscription has retry policy enabled

2. Check Gmail account:
   - Verify OAuth scope includes `gmail.readonly`
   - Check that refresh_token exists (offline access granted)

3. Check logs:
   - Look for "Gmail notification queued" messages
   - Check for "Failed to get history" errors
   - Verify no token refresh errors

### EPO Not Creating

1. Check confidence score:
   - If < 0.6, EPO goes to manual review queue
   - Check parse_model (which tier succeeded)

2. Check vendor email extraction:
   - Emails without valid vendor_email are skipped
   - Check "From" header parsing in logs

3. Check email parser:
   - May be using Gemini or Claude tiers
   - Check API keys are configured (GOOGLE_AI_API_KEY, ANTHROPIC_API_KEY)

### Confirmation Email Not Sending

1. Verify Resend is configured:
   - RESEND_API_KEY is set
   - EMAIL_FROM_ADDRESS is valid domain

2. Check logs for "Email send failed"
   - May be rate limited
   - May be invalid recipient address

### Follow-up Emails Not Sending

1. Verify scheduler is running:
   ```bash
   # Check logs for scheduler start message
   # Look for "Background scheduler started (APScheduler)"
   ```

2. Check follow-up job:
   - Runs daily at 10 AM
   - Checks for EPOs at 3, 5, 7-day marks
   - Only for PENDING EPOs

## Step 7: Production Checklist

Before going live:

- [ ] GMAIL_PUBSUB_TOPIC configured
- [ ] GMAIL_WEBHOOK_URL points to production domain
- [ ] Gmail OAuth credentials set
- [ ] Database migration applied (`alembic upgrade head`)
- [ ] Webhook setup called for each company
- [ ] Test email sent and verified creating EPO
- [ ] Vendor reply flow tested
- [ ] Follow-up emails tested (may need to advance clock in dev)
- [ ] Logs monitored for errors
- [ ] Webhook endpoint is publicly accessible (no auth required)
- [ ] Service account has publish permission to Pub/Sub topic
- [ ] Scheduler is running (check logs)

## Common Issues

### Issue: "No email connection found"
**Solution:** Ensure user completed Gmail OAuth flow. Check email_connections table for record.

### Issue: "Token refresh failed"
**Solution:** User may need to re-authenticate. OAuth token may have been revoked.

### Issue: "GMAIL_PUBSUB_TOPIC not configured"
**Solution:** Add GMAIL_PUBSUB_TOPIC to environment variables and restart backend.

### Issue: Notifications arriving but not processing
**Solution:** Check for "Background notification processing error" in logs. May be issue with message decoding.

### Issue: Same notification processed multiple times
**Solution:** Deduplication cache is in-memory and limited to 10,000 entries. In production, consider using Redis for shared cache across instances.

## Configuration Tuning

### Adjust Confidence Thresholds

Edit `app/core/config.py`:
```python
# Lower = more auto-creation, higher = more manual review
AGENT_AUTO_CONFIRM_THRESHOLD: float = 0.8  # Default 0.9

# Create EPO if confidence > 0.6
# Mark needs_review if confidence < 0.8
```

### Adjust Follow-up Schedule

Edit `app/core/config.py`:
```python
# When to send follow-up emails (days after creation)
AGENT_FOLLOWUP_DAYS: List[int] = [2, 4, 6]  # Custom schedule
```

And update scheduler job trigger:
```python
# In app/services/scheduler.py
# Modify run_smart_followup_check() logic
```

### Adjust Watch Renewal Schedule

Edit `app/services/scheduler.py`:
```python
# Renew watches every 6 days instead of Monday
scheduler.add_job(
    renew_gmail_watches,
    CronTrigger(day_of_week="*", hour=2, minute=0),  # Every day at 2 AM
    id="renew_gmail_watches",
    replace_existing=True,
)
```

## API Endpoints Reference

### POST /api/webhook/gmail
Receives Pub/Sub notifications. No auth required.

**Request:**
```json
{
  "message": {
    "data": "eyJlbWFpbEFkZHJlc3MiOiAidGVzdEBnbWFpbC5jb20iLCAiaGlzdG9yeUlkIjogIjEyMzQ1In0="
  },
  "subscription": "projects/PROJECT_ID/subscriptions/epo-tracker-gmail-webhook"
}
```

**Response:**
```json
{
  "status": "ok"
}
```

### POST /api/webhook/gmail/setup
Registers Gmail watch. Requires authentication.

**Request Headers:**
```
Authorization: Bearer {JWT_TOKEN}
Content-Type: application/json
```

**Response:**
```json
{
  "success": true,
  "message": "Gmail webhooks registered successfully",
  "watch_expiration": "2024-04-11T14:30:00+00:00"
}
```

## Monitoring & Analytics

### Key Metrics

1. **Webhook Health**
   - Query `webhook_logs` table
   - Track status: received → processing → completed/failed
   - Monitor error_message for failure reasons

2. **EPO Creation Rate**
   - Track EPOs created via `synced_from_email = TRUE`
   - Monitor confidence_score distribution
   - Track parse_model usage (regex vs Gemini vs Haiku)

3. **Vendor Response Rate**
   - Track EPOs by status: PENDING → CONFIRMED/DENIED
   - Monitor time from creation to confirmation
   - Track confirmation source (portal vs email reply)

4. **Follow-up Effectiveness**
   - Monitor email send success rate
   - Track confirmation rate after follow-ups
   - Calculate ROI (follow-up cost vs confirmation impact)

### Sample Queries

```sql
-- Daily webhook volume
SELECT DATE(created_at) as date, COUNT(*) as notifications
FROM webhook_logs
GROUP BY DATE(created_at)
ORDER BY date DESC
LIMIT 30;

-- EPO source breakdown
SELECT synced_from_email, COUNT(*) as count
FROM epos
GROUP BY synced_from_email;

-- Parse model effectiveness
SELECT parse_model,
       COUNT(*) as count,
       AVG(confidence_score) as avg_confidence,
       SUM(CASE WHEN status = 'confirmed' THEN 1 ELSE 0 END) as confirmed
FROM epos
GROUP BY parse_model;

-- Follow-up effectiveness
SELECT COUNT(DISTINCT epo_id) as epos_followed_up,
       SUM(CASE WHEN epo.status = 'confirmed' THEN 1 ELSE 0 END) as confirmed_after_followup
FROM epo_followups
JOIN epos epo ON epo_followups.epo_id = epo.id;
```

## Support

For issues or questions:
1. Check backend logs (see log level in config)
2. Review webhook_logs table for error_message
3. Verify environment variables are set
4. Test with manual webhook curl request
5. Check Google Cloud Pub/Sub subscription delivery metrics
