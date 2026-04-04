-- Migration: Add Gmail thread tracking columns to EPOs table
-- This enables reply detection: matching reply emails back to their original EPO

ALTER TABLE epos ADD COLUMN IF NOT EXISTS gmail_thread_id VARCHAR(255);
ALTER TABLE epos ADD COLUMN IF NOT EXISTS gmail_message_id VARCHAR(255);

-- Index on thread_id for fast reply lookups
CREATE INDEX IF NOT EXISTS idx_epos_gmail_thread_id ON epos(gmail_thread_id);
