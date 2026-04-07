"""SQLite storage — session history + metric snapshots.

Schema includes user_id, sensor_mode, music_strategy columns from V1 so
the same schema can be migrated to Postgres in V2 without changes.
"""
from __future__ import annotations
import json
import sqlite3
import time
import uuid
from contextlib import contextmanager
from pathlib import Path

from .config import DATABASE_URL


def _db_path() -> str:
    # Expected form: sqlite:///./mission_alive.db
    url = DATABASE_URL
    if url.startswith("sqlite:///"):
        return url[len("sqlite:///"):]
    return url


@contextmanager
def connect():
    path = _db_path()
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def init_db() -> None:
    with connect() as c:
        c.executescript("""
        CREATE TABLE IF NOT EXISTS sessions (
            id TEXT PRIMARY KEY,
            user_id TEXT,
            session_type TEXT NOT NULL,
            sensor_mode TEXT NOT NULL,
            music_strategy TEXT NOT NULL,
            started_at REAL NOT NULL,
            ended_at REAL,
            duration_s REAL,
            rmssd_start REAL,
            rmssd_end REAL,
            arousal_start REAL,
            arousal_end REAL,
            dominant_state TEXT,
            fallback_triggered INTEGER DEFAULT 0,
            insight TEXT
        );
        CREATE TABLE IF NOT EXISTS metric_snapshots (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id TEXT NOT NULL,
            t_offset REAL NOT NULL,
            metrics_json TEXT NOT NULL,
            state_json TEXT NOT NULL,
            params_json TEXT NOT NULL,
            FOREIGN KEY (session_id) REFERENCES sessions(id)
        );
        CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
        CREATE INDEX IF NOT EXISTS idx_snapshots_session ON metric_snapshots(session_id);
        """)


def create_session(
    session_type: str,
    sensor_mode: str,
    music_strategy: str,
    user_id: str | None = None,
) -> str:
    sid = str(uuid.uuid4())
    with connect() as c:
        c.execute(
            "INSERT INTO sessions (id, user_id, session_type, sensor_mode, music_strategy, started_at) VALUES (?, ?, ?, ?, ?, ?)",
            (sid, user_id, session_type, sensor_mode, music_strategy, time.time()),
        )
    return sid


def log_snapshot(
    session_id: str,
    t_offset: float,
    metrics: dict,
    state: dict,
    params: dict,
) -> None:
    with connect() as c:
        c.execute(
            "INSERT INTO metric_snapshots (session_id, t_offset, metrics_json, state_json, params_json) VALUES (?, ?, ?, ?, ?)",
            (session_id, t_offset, json.dumps(metrics), json.dumps(state), json.dumps(params)),
        )


def finish_session(
    session_id: str,
    rmssd_start: float,
    rmssd_end: float,
    arousal_start: float,
    arousal_end: float,
    dominant_state: str,
    fallback_triggered: bool,
    insight: str,
) -> None:
    with connect() as c:
        row = c.execute("SELECT started_at FROM sessions WHERE id = ?", (session_id,)).fetchone()
        if row is None:
            return
        ended = time.time()
        duration = ended - row["started_at"]
        c.execute(
            """UPDATE sessions SET ended_at = ?, duration_s = ?, rmssd_start = ?, rmssd_end = ?,
               arousal_start = ?, arousal_end = ?, dominant_state = ?, fallback_triggered = ?, insight = ?
               WHERE id = ?""",
            (ended, duration, rmssd_start, rmssd_end, arousal_start, arousal_end,
             dominant_state, 1 if fallback_triggered else 0, insight, session_id),
        )


def list_sessions(user_id: str | None = None, limit: int = 20) -> list[dict]:
    with connect() as c:
        if user_id:
            rows = c.execute(
                "SELECT * FROM sessions WHERE user_id = ? ORDER BY started_at DESC LIMIT ?",
                (user_id, limit),
            ).fetchall()
        else:
            rows = c.execute(
                "SELECT * FROM sessions ORDER BY started_at DESC LIMIT ?",
                (limit,),
            ).fetchall()
        return [dict(r) for r in rows]
