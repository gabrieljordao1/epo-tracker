-- Migration 006: Security & stability hardening
-- Adds optimistic locking (version) to EPOs and email verification to users.
-- Also ensures all previously added indexes exist (idempotent).

-- ─── EPO optimistic locking ─────────────────────────
ALTER TABLE epos ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;

-- ─── User email verification ────────────────────────
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verification_code VARCHAR(6);
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verification_expires TIMESTAMPTZ;

-- Mark existing users as verified (they registered before verification existed)
UPDATE users SET email_verified = true WHERE email_verified = false;

-- ─── Ensure indexes from models.py exist ────────────
-- These were added to the SQLAlchemy models but may not exist in the DB yet
CREATE INDEX IF NOT EXISTS ix_epos_status ON epos (status);
CREATE INDEX IF NOT EXISTS ix_epos_created_by_id ON epos (created_by_id);
CREATE INDEX IF NOT EXISTS ix_email_connections_company_id ON email_connections (company_id);
CREATE INDEX IF NOT EXISTS ix_epo_followups_epo_id ON epo_followups (epo_id);
CREATE INDEX IF NOT EXISTS ix_vendor_actions_epo_id ON vendor_actions (epo_id);
CREATE INDEX IF NOT EXISTS ix_users_company_id ON users (company_id);
