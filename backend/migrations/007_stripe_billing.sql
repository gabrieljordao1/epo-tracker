-- Migration 007: Stripe billing columns on companies
-- Adds Stripe customer/subscription tracking and BUSINESS plan tier.

-- ─── Add BUSINESS to plan_tier enum ────────────────
-- PostgreSQL enums need ALTER TYPE to add a new value
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_enum
        WHERE enumtypid = (SELECT oid FROM pg_type WHERE typname = 'plantier')
        AND enumlabel = 'business'
    ) THEN
        ALTER TYPE plantier ADD VALUE 'business' AFTER 'pro';
    END IF;
END$$;

-- ─── Stripe columns on companies ───────────────────
ALTER TABLE companies ADD COLUMN IF NOT EXISTS stripe_customer_id VARCHAR(255) UNIQUE;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS stripe_subscription_id VARCHAR(255) UNIQUE;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS stripe_subscription_status VARCHAR(50);
ALTER TABLE companies ADD COLUMN IF NOT EXISTS billing_email VARCHAR(255);

-- ─── Indexes ───────────────────────────────────────
CREATE INDEX IF NOT EXISTS ix_companies_stripe_customer_id ON companies (stripe_customer_id);
CREATE INDEX IF NOT EXISTS ix_companies_stripe_subscription_id ON companies (stripe_subscription_id);
