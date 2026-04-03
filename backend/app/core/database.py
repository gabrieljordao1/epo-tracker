import logging
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import declarative_base
from sqlalchemy.pool import StaticPool
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
    engine_kwargs["pool_pre_ping"] = True
    engine_kwargs["pool_size"] = settings.DB_POOL_SIZE
    engine_kwargs["max_overflow"] = settings.DB_MAX_OVERFLOW
    engine_kwargs["pool_timeout"] = settings.DB_POOL_TIMEOUT
    engine_kwargs["pool_recycle"] = 3600  # Recycle connections after 1 hour
    logger.info("Using PostgreSQL database (production mode)")

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
        logger.info("PostgreSQL detected — use Alembic for migrations")


async def close_db():
    await engine.dispose()
    logger.info("Database connections closed")
