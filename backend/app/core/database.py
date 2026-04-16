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
