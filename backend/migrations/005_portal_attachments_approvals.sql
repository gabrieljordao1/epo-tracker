-- Migration 005: Portal status, attachments, approvals, notifications
-- Adds BuildPro/SupplyPro portal tracking, photo attachments,
-- internal approval workflow, and notification preferences.

-- ─── New enum types ─────────────────────────────────
DO $$ BEGIN
    CREATE TYPE portalstatus AS ENUM ('unknown', 'requested', 'pending_approval', 'approved', 'rejected', 'partially_approved');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE approvalstatus AS ENUM ('draft', 'pending_super', 'approved', 'rejected');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ─── Portal status fields on EPOs ──────────────────
ALTER TABLE epos ADD COLUMN IF NOT EXISTS portal_status portalstatus DEFAULT 'unknown' NOT NULL;
ALTER TABLE epos ADD COLUMN IF NOT EXISTS portal_confirmation_number VARCHAR(255);
ALTER TABLE epos ADD COLUMN IF NOT EXISTS portal_source VARCHAR(50);
ALTER TABLE epos ADD COLUMN IF NOT EXISTS portal_checked_at TIMESTAMPTZ;
ALTER TABLE epos ADD COLUMN IF NOT EXISTS portal_notes TEXT;

-- ─── Internal approval workflow field on EPOs ──────
ALTER TABLE epos ADD COLUMN IF NOT EXISTS approval_status approvalstatus DEFAULT 'draft' NOT NULL;

-- ─── EPO Attachments table ─────────────────────────
CREATE TABLE IF NOT EXISTS epo_attachments (
    id SERIAL PRIMARY KEY,
    epo_id INTEGER NOT NULL REFERENCES epos(id) ON DELETE CASCADE,
    company_id INTEGER NOT NULL REFERENCES companies(id),
    uploaded_by_id INTEGER REFERENCES users(id),
    filename VARCHAR(255) NOT NULL,
    file_url VARCHAR(1024) NOT NULL,
    file_size INTEGER,
    mime_type VARCHAR(100),
    description VARCHAR(500),
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_epo_attachments_epo_id ON epo_attachments(epo_id);
CREATE INDEX IF NOT EXISTS idx_epo_attachments_company_id ON epo_attachments(company_id);

-- ─── EPO Approvals table ───────────────────────────
CREATE TABLE IF NOT EXISTS epo_approvals (
    id SERIAL PRIMARY KEY,
    epo_id INTEGER NOT NULL REFERENCES epos(id) ON DELETE CASCADE,
    company_id INTEGER NOT NULL REFERENCES companies(id),
    requested_by_id INTEGER NOT NULL REFERENCES users(id),
    approved_by_id INTEGER REFERENCES users(id),
    status approvalstatus DEFAULT 'pending_super' NOT NULL,
    note TEXT,
    decided_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_epo_approvals_epo_id ON epo_approvals(epo_id);
CREATE INDEX IF NOT EXISTS idx_epo_approvals_company_id ON epo_approvals(company_id);
CREATE INDEX IF NOT EXISTS idx_epo_approvals_status ON epo_approvals(status);

-- ─── Notification Preferences table ────────────────
CREATE TABLE IF NOT EXISTS notification_preferences (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL UNIQUE REFERENCES users(id),
    company_id INTEGER NOT NULL REFERENCES companies(id),
    email_enabled BOOLEAN DEFAULT true NOT NULL,
    sms_enabled BOOLEAN DEFAULT false NOT NULL,
    push_enabled BOOLEAN DEFAULT false NOT NULL,
    phone_number VARCHAR(20),
    notify_new_epo BOOLEAN DEFAULT true NOT NULL,
    notify_status_change BOOLEAN DEFAULT true NOT NULL,
    notify_approval_needed BOOLEAN DEFAULT true NOT NULL,
    notify_overdue BOOLEAN DEFAULT true NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notification_prefs_user_id ON notification_preferences(user_id);
