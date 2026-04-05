-- Migration 004: Company invite codes + multi-connection support
-- Invite codes let team members join existing company during signup.
-- Each team member's EPOs are tracked via FROM email matching.

-- Add invite_code to companies for team onboarding
ALTER TABLE companies ADD COLUMN IF NOT EXISTS invite_code VARCHAR(20) UNIQUE;
CREATE UNIQUE INDEX IF NOT EXISTS idx_companies_invite_code ON companies(invite_code) WHERE invite_code IS NOT NULL;

-- Add connected_by_id to track which user set up each email connection
ALTER TABLE email_connections ADD COLUMN IF NOT EXISTS connected_by_id INTEGER REFERENCES users(id);

-- Add missing industry enum values
ALTER TYPE industry ADD VALUE IF NOT EXISTS 'PAINT_DRYWALL';
ALTER TYPE industry ADD VALUE IF NOT EXISTS 'OTHER';
