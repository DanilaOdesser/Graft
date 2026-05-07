"""Database connection layer.

Single SQLAlchemy engine + session factory. Both dev-A and dev-B routers
import `SessionLocal` and `Base` from here.
"""
from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv
from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

# Auto-load .env from repo root for local dev. Render/Supabase pass envs
# directly so this is a no-op in production.
load_dotenv(Path(__file__).resolve().parents[1] / ".env")

DATABASE_URL = os.environ.get("DATABASE_URL")
if not DATABASE_URL:
    raise RuntimeError(
        "DATABASE_URL not set. Copy .env.example to .env and fill in your "
        "Supabase Session-pooler URI."
    )

# pool_pre_ping handles the Supabase pooler dropping idle connections.
engine = create_engine(DATABASE_URL, pool_pre_ping=True, future=True)

SessionLocal = sessionmaker(
    bind=engine, autocommit=False, autoflush=False, expire_on_commit=False
)


class Base(DeclarativeBase):
    """Shared declarative base for all ORM models."""


def get_session() -> Session:
    """FastAPI dependency: yields a request-scoped DB session."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
