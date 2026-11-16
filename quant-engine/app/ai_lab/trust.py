"""Batch recompute of semantic-memory trust from explicit votes and implicit signals.

Uses the same smoothed formula as the backend (computeTrustScore) plus the summed
implicit signals at the same 0.05-per-weight rate as applyImplicitSignal. Proposes
changes in dry-run; writes only when the caller opens a write connection.
"""

from __future__ import annotations

from typing import Any

from .db import fetch_dicts, table_exists

IMPLICIT_RATE = 0.05
QUARANTINE_BELOW = 0.45


def base_trust(pos: int, neg: int, distinct_pos: int) -> float:
    pos, neg = max(0, int(pos or 0)), max(0, int(neg or 0))
    smoothed = (pos + 2) / (pos + neg + 4)
    bonus = min(0.18, max(0, int(distinct_pos or 0)) * 0.06) if neg == 0 else 0.0
    return round(max(0.05, min(0.99, smoothed + bonus)), 4)


def propose_trust_updates(conn: Any) -> dict[str, Any]:
    if not table_exists(conn, "ai_semantic_memory"):
        return {"available": False, "updates": []}
    has_events = table_exists(conn, "ai_feedback_events")
    implicit_sql = (
        "COALESCE((SELECT SUM(e.weight) FROM ai_feedback_events e WHERE e.semantic_memory_id = m.id), 0)::float"
        if has_events
        else "0::float"
    )
    rows = fetch_dicts(
        conn,
        f"""
        SELECT m.id::text AS id, m.status, m.trust_score::float AS trust, m.positive_count, m.negative_count,
               m.distinct_positive_users, {implicit_sql} AS implicit_sum
          FROM ai_semantic_memory m
         WHERE m.status IN ('ACTIVE', 'CANDIDATE')
        """,
    )
    updates = []
    for r in rows:
        # Admin approval is stored only as trust 0.95 with no complaints: leave those alone.
        if float(r["trust"] or 0) >= 0.95 and int(r["negative_count"] or 0) == 0:
            continue
        proposed = base_trust(r["positive_count"], r["negative_count"], r["distinct_positive_users"])
        proposed = round(max(0.05, min(0.99, proposed + IMPLICIT_RATE * float(r["implicit_sum"] or 0))), 4)
        current = round(float(r["trust"] or 0.5), 4)
        if abs(proposed - current) >= 0.01:
            updates.append(
                {
                    "id": r["id"],
                    "status": r["status"],
                    "current": current,
                    "proposed": proposed,
                    "quarantine": proposed < QUARANTINE_BELOW,
                }
            )
    return {"available": True, "activeMemories": len(rows), "updates": updates}


def apply_trust_updates(conn: Any, updates: list[dict[str, Any]]) -> int:
    cur = conn.cursor()
    for u in updates:
        cur.execute(
            """UPDATE ai_semantic_memory
                  SET trust_score = %s,
                      status = CASE WHEN %s THEN 'QUARANTINED' ELSE status END,
                      updated_at = now()
                WHERE id = %s::uuid AND status IN ('ACTIVE', 'CANDIDATE')""",
            (u["proposed"], bool(u["quarantine"]), u["id"]),
        )
    return len(updates)
