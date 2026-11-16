"""Postgres access for the AI lab. Read-only unless a caller explicitly opens a write connection."""

from __future__ import annotations

import os
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterator

import pg8000.dbapi
from dotenv import load_dotenv

QUANT_ENGINE_ROOT = Path(__file__).resolve().parents[2]
WORKSPACE_ROOT = QUANT_ENGINE_ROOT.parent


def load_env() -> None:
    for candidate in (
        WORKSPACE_ROOT / "backend-nest" / ".env",
        WORKSPACE_ROOT / ".env",
        QUANT_ENGINE_ROOT / ".env",
    ):
        if candidate.exists():
            load_dotenv(candidate, override=False)
            break


def _config() -> dict[str, Any]:
    load_env()
    return {
        "host": os.environ.get("DB_HOST", "127.0.0.1"),
        "port": int(os.environ.get("DB_PORT", "5432")),
        "user": os.environ.get("DB_USER", "postgres"),
        "password": os.environ.get("DB_PASS", "postgres"),
        "database": os.environ.get("DB_NAME", "trading_cossa"),
    }


@contextmanager
def connect(read_only: bool = True) -> Iterator[Any]:
    conn = pg8000.dbapi.connect(**_config())
    try:
        cur = conn.cursor()
        if read_only:
            cur.execute("SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY")
        yield conn
        if not read_only:
            conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def fetch_dicts(conn: Any, sql: str, params: tuple | list | None = None) -> list[dict[str, Any]]:
    cur = conn.cursor()
    cur.execute(sql, params or ())
    if cur.description is None:
        return []
    cols = [d[0] for d in cur.description]
    return [dict(zip(cols, row)) for row in cur.fetchall()]


def table_exists(conn: Any, name: str) -> bool:
    rows = fetch_dicts(conn, "SELECT to_regclass(%s) IS NOT NULL AS ok", (f"public.{name}",))
    return bool(rows and rows[0]["ok"])
