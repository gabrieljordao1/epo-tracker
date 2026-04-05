-- Migration 004: Support multiple Gmail connections per company
-- Each team member can connect their own Gmail, all EPOs roll up to the company.

-- Add connected_by_id to track which user connected each email
ALTER TABLE email_connections ADD COLUMN IF NOT EXISTS connected_by_id INTEGER REFERENCES users(id);

-- Add missing industry enum values
ALTER TYPE industry ADD VALUE IF NOT EXISTS 'PAINT_DRYWALL';
ALTER TYPE industry ADD VALUE IF NOT EXISTS 'OTHER';
