import logging
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import declarative_base
from sqlalchemy.pool import StaticPool, NullPool
from .config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()

# Build engine kwargs based on database type
engine_kwargs = {
    "echo": settings.DEBUG,
    "future": True,
}

if "sqlite" in settings.DATABASE_URL:
    engine_kwargs["connect_args"] = {"check_same_thread": False}
    engine_kwargs["poolclass"] = StaticPool
    logger.info("Using SQLite database (development mode)")
else:
    # Use NullPool to avoid connection hoarding on Railway/Neon Postgres.
    # Neon's session-mode pooler has a very low connection limit;
    # NullPool creates a fresh connection per request and releases immediately,
    # so we never hit "MaxClientsInSessionMode" during deploys.
    engine_kwargs["poolclass"] = NullPool
    logger.info("Using PostgreSQL database (production mode, NullPool)")

engine = create_async_engine(settings.DATABASE_URL, **engine_kwargs)

async_session_maker = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autoflush=False,
    autocommit=False,
)

Base = declarative_base()


async def get_db() -> AsyncSession:
    async with async_session_maker() as session:
        try:
            yield session
        finally:
            await session.close()


async def init_db():
    """Create all tables. In production, use Alembic migrations instead."""
    if "sqlite" in settings.DATABASE_URL:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        logger.info("SQLite tables created via create_all()")
    else:
        logger.info("PostgreSQL detected — running safe schema migrations")
        try:
            await _run_safe_migrations()
        except Exception as e:
            # During blue-green deploys the old instance may hold all Neon
            # connections.  Let the app start anyway — tables already exist
            # in production, and migrations are idempotent so the next
            # deploy will catch up.
            logger.warning(f"Migrations failed (app will start anyway): {e}")


async def _run_safe_migrations():
    """
    Run idempotent ALTER TABLE statements to keep the DB schema in sync.
    Each migration uses IF NOT EXISTS / checks to be safe to re-run.
    """
    from sqlalchemy import text

    migrations = [
        # Add work_email column to users table
        """
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name = 'users' AND column_name = 'work_email'
            ) THEN
                ALTER TABLE users ADD COLUMN work_email VARCHAR(255) UNIQUE;
                CREATE INDEX IF NOT EXISTS ix_users_work_email ON users (work_email);
            END IF;
        END $$;
        """,
        # Set Gabriel's work email (Stancil services)
        """
        UPDATE users SET work_email = 'gabriel.jordao@stancilservices.com'
        WHERE email = 'gabriel.jordao0217@gmail.com' AND work_email IS NULL;
        """,
        # Fix EPO #28 — set created_by_id to Gabriel's user ID
        """
        UPDATE epos SET created_by_id = (
            SELECT id FROM users WHERE email = 'gabriel.jordao0217@gmail.com'
        )
        WHERE id = 28 AND created_by_id IS NULL;
        """,
        # Deactivate demo-seeded Gabriel user to avoid duplicate on team page
        # The real account is gabriel.jordao0217@gmail.com
        """
        UPDATE users SET is_active = false
        WHERE email = 'gabriel@stancilservices.com'
          AND EXISTS (
              SELECT 1 FROM users WHERE email = 'gabriel.jordao0217@gmail.com'
          );
        """,
        # Create sub_payments table for profit tracking
        """
        CREATE TABLE IF NOT EXISTS sub_payments (
            id SERIAL PRIMARY KEY,
            company_id INTEGER NOT NULL REFERENCES companies(id),
            epo_id INTEGER NOT NULL REFERENCES epos(id) ON DELETE CASCADE,
            created_by_id INTEGER REFERENCES users(id),
            sub_name VARCHAR(255) NOT NULL,
            sub_trade VARCHAR(100) NOT NULL,
            amount DOUBLE PRECISION NOT NULL,
            paid_date TIMESTAMP WITH TIME ZONE,
            notes TEXT,
            created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
        );
        """,
        """
        CREATE INDEX IF NOT EXISTS ix_sub_payments_company_id ON sub_payments (company_id);
        """,
        """
        CREATE INDEX IF NOT EXISTS ix_sub_payments_epo_id ON sub_payments (epo_id);
        """,
        """
        CREATE INDEX IF NOT EXISTS ix_sub_payments_created_at ON sub_payments (created_at);
        """,
        # ── Cleanup: delete duplicate EPOs (same gmail_message_id + lot_number, keep lowest ID) ──
        """
        DELETE FROM epos WHERE id IN (
            SELECT id FROM (
                SELECT id, ROW_NUMBER() OVER (
                    PARTITION BY gmail_message_id, LOWER(TRIM(lot_number))
                    ORDER BY id ASC
                ) AS rn
                FROM epos
                WHERE gmail_message_id IS NOT NULL
            ) ranked
            WHERE rn > 1
        );
        """,
        # ── Cleanup: delete exact (vendor, community, lot, round(amount)) duplicates, keep lowest ID ──
        """
        DELETE FROM epos WHERE id IN (
            SELECT id FROM (
                SELECT id, ROW_NUMBER() OVER (
                    PARTITION BY company_id,
                        LOWER(TRIM(vendor_name)),
                        LOWER(TRIM(community)),
                        LOWER(TRIM(lot_number)),
                        ROUND(CAST(COALESCE(amount, 0) AS NUMERIC), 0)
                    ORDER BY id ASC
                ) AS rn
                FROM epos
                WHERE vendor_name IS NOT NULL
                  AND community IS NOT NULL
                  AND lot_number IS NOT NULL
                  AND amount IS NOT NULL
                  AND amount > 0
            ) ranked
            WHERE rn > 1
        );
        """,
        # ── Cleanup: fix 'Hotmail', 'Gmail', etc. vendor names → 'Unknown Builder' ──
        """
        UPDATE epos SET vendor_name = 'Unknown Builder'
        WHERE LOWER(TRIM(REPLACE(vendor_name, '.com', ''))) IN (
            'hotmail', 'gmail', 'yahoo', 'outlook', 'aol', 'icloud',
            'mail', 'protonmail', 'msn', 'live', 'comcast'
        );
        """,
        # ── v31 QA Cleanup: Delete reply emails that were wrongly created as EPOs ──
        # ID 245: "Were these submitted?" reply to Plott 2b/2c — duplicate of 653
        # ID 33:  "Were these submitted" reply to Sugar Creek lot 12 — duplicate of 652
        # ID 649: PO# reply for Mallard Park 15,16,18 — should have updated 651
        # ID 648: PO# reply for Galloway lot 28 — reply with bare conf number
        # ID 654: Exact duplicate of ID 27 (same email, same lot)
        """
        DELETE FROM epos WHERE id IN (245, 33, 649, 648, 654)
          AND EXISTS (SELECT 1 FROM epos WHERE id = 27);
        """,
        # ── v31 QA Cleanup: Apply PO# from reply ID 649 to original EPO 651 ──
        # Reply had: Lot 15=PO#13441438, Lot 16=PO#13441447, Lot 18=PO#13441452
        # EPO 651 covers lots 15, 16 and 18 — store the first PO#
        """
        UPDATE epos SET confirmation_number = '13441438'
        WHERE id = 651 AND confirmation_number IS NULL;
        """,
        # ── v31 QA Cleanup: Fix amounts for "per lot" EPOs ──
        # ID 268: $275 per lot × 3 lots = $825 (was $275)
        """
        UPDATE epos SET amount = 825.0
        WHERE id = 268 AND amount = 275.0;
        """,
        # ID 246: $125 per lot × 4 lots = $500 (was $125)
        """
        UPDATE epos SET amount = 500.0
        WHERE id = 246 AND amount = 125.0;
        """,
        # ID 651: $450 per lot × 3 lots = $1350 (was $450)
        """
        UPDATE epos SET amount = 1350.0
        WHERE id = 651 AND amount = 450.0;
        """,
        # ID 460: Total is $8600 per email (lots 1-9@$400 + lots 10-20@$500)
        """
        UPDATE epos SET amount = 8600.0
        WHERE id = 460 AND amount = 3600.0;
        """,
        # ID 588: Grand total $4375 per email (Cama lots 1-4, different amounts each)
        """
        UPDATE epos SET amount = 4375.0
        WHERE id = 588 AND amount = 1150.0;
        """,
        # ── v32: Fix EPO 651 status — has PO# but status was never flipped ──
        """
        UPDATE epos SET status = 'confirmed'
        WHERE id = 651 AND confirmation_number IS NOT NULL AND status = 'pending';
        """,
        # ── v32: Fix EPO 51 (Context 58) — Blake replied with conf screenshot ──
        # Scheduler missed the image attachment; set to pending so it gets reprocessed
        # rather than staying denied incorrectly
        """
        UPDATE epos SET status = 'pending'
        WHERE id = 51 AND status = 'denied';
        """,
        # ── v33: Fix insane EPO amounts (mis-parsed phone/PO numbers) ──
        # Any amount over $500K for a paint/drywall EPO is clearly wrong.
        # Null them out so the backfill job can re-extract correctly.
        """
        UPDATE epos SET amount = NULL, needs_review = true
        WHERE amount > 500000;
        """,
        # ── v37: Delete spam EPOs by exact ID ──
        # v35/v36 failed silently because FK constraints (no CASCADE) block
        # deleting EPOs that have rows in epo_followups, vendor_actions, etc.
        # Must delete dependent rows FIRST, then the EPOs.
        #
        # Spam IDs verified via live app: 663-675 are all marketing/spam.
        # ID 664 has the $639 quadrillion mis-parsed amount.
        """
        DELETE FROM epo_followups
        WHERE epo_id IN (663,664,665,666,667,668,669,670,671,672,673,674,675);
        """,
        """
        DELETE FROM vendor_actions
        WHERE epo_id IN (663,664,665,666,667,668,669,670,671,672,673,674,675);
        """,
        """
        DELETE FROM epo_attachments
        WHERE epo_id IN (663,664,665,666,667,668,669,670,671,672,673,674,675);
        """,
        """
        DELETE FROM epo_approvals
        WHERE epo_id IN (663,664,665,666,667,668,669,670,671,672,673,674,675);
        """,
        """
        DELETE FROM sub_payments
        WHERE epo_id IN (663,664,665,666,667,668,669,670,671,672,673,674,675);
        """,
        """
        DELETE FROM epos
        WHERE id IN (663,664,665,666,667,668,669,670,671,672,673,674,675);
        """,
        # ── v37b: Catch-all for any "Unknown Builder" with no community
        # AND no lot (no real EPO would have both null). Same FK cleanup first.
        """
        DELETE FROM epo_followups WHERE epo_id IN (
            SELECT id FROM epos WHERE vendor_name = 'Unknown Builder'
            AND community IS NULL AND lot_number IS NULL
        );
        """,
        """
        DELETE FROM vendor_actions WHERE epo_id IN (
            SELECT id FROM epos WHERE vendor_name = 'Unknown Builder'
            AND community IS NULL AND lot_number IS NULL
        );
        """,
        """
        DELETE FROM epo_attachments WHERE epo_id IN (
            SELECT id FROM epos WHERE vendor_name = 'Unknown Builder'
            AND community IS NULL AND lot_number IS NULL
        );
        """,
        """
        DELETE FROM epo_approvals WHERE epo_id IN (
            SELECT id FROM epos WHERE vendor_name = 'Unknown Builder'
            AND community IS NULL AND lot_number IS NULL
        );
        """,
        """
        DELETE FROM sub_payments WHERE epo_id IN (
            SELECT id FROM epos WHERE vendor_name = 'Unknown Builder'
            AND community IS NULL AND lot_number IS NULL
        );
        """,
        """
        DELETE FROM epos
        WHERE vendor_name = 'Unknown Builder'
          AND community IS NULL
          AND lot_number IS NULL;
        """,
        # ── v40: Normalize builder names ──
        # Fix inconsistent casing and naming for the same builders
        """
        UPDATE epos SET vendor_name = 'TriPointe Homes'
        WHERE LOWER(TRIM(vendor_name)) IN ('tripointe', 'tri pointe', 'tripointe homes', 'tri pointe homes');
        """,
        """
        UPDATE epos SET vendor_name = 'DRB Group'
        WHERE LOWER(TRIM(vendor_name)) IN ('drbgroup', 'drb group', 'drb', 'drbhomes');
        """,
        """
        UPDATE epos SET vendor_name = 'DR Horton'
        WHERE LOWER(TRIM(vendor_name)) IN ('dr horton', 'drhorton', 'd.r. horton', 'dr. horton');
        """,
        """
        UPDATE epos SET vendor_name = 'Pulte'
        WHERE LOWER(TRIM(vendor_name)) IN ('pulte homes', 'pultehomes', 'pultegroup');
        """,
        """
        UPDATE epos SET vendor_name = 'Madison Simmons Homes'
        WHERE LOWER(TRIM(vendor_name)) IN ('madison simmons', 'madisonsimmons', 'madison simmons homes');
        """,
        """
        UPDATE epos SET vendor_name = 'Red Cedar'
        WHERE LOWER(TRIM(vendor_name)) IN ('red cedar', 'redcedar', 'red cedar homes');
        """,
        # ── v40: Create notification_preferences table ──
        """
        CREATE TABLE IF NOT EXISTS notification_preferences (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL UNIQUE REFERENCES users(id),
            company_id INTEGER NOT NULL REFERENCES companies(id),
            email_enabled BOOLEAN NOT NULL DEFAULT true,
            sms_enabled BOOLEAN NOT NULL DEFAULT false,
            push_enabled BOOLEAN NOT NULL DEFAULT false,
            phone_number VARCHAR(20),
            notify_new_epo BOOLEAN NOT NULL DEFAULT true,
            notify_status_change BOOLEAN NOT NULL DEFAULT true,
            notify_approval_needed BOOLEAN NOT NULL DEFAULT true,
            notify_overdue BOOLEAN NOT NULL DEFAULT true,
            created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
        );
        """,
        # ── v43: Fix EPO 659 — Pulte replied with conf# 13445559 on Apr 17 ──
        # The periodic sync missed the reply because the token persistence bug
        # caused the sync to be down when the reply arrived, and by the time
        # the fix deployed the reply was outside the 1-day fetch window.
        """
        UPDATE epos SET status = 'CONFIRMED', confirmation_number = '13445559'
        WHERE id = 659 AND status = 'PENDING' AND confirmation_number IS NULL;
        """,
    ]

    async with engine.begin() as conn:
        for sql in migrations:
            try:
                await conn.execute(text(sql))
            except Exception as e:
                logger.warning(f"Migration skipped or failed (safe): {e}")
    logger.info(f"Ran {len(migrations)} safe migration(s)")


async def close_db():
    await engine.dispose()
    logger.info("Database connections closed")
