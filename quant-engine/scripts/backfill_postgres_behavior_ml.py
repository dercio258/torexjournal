from __future__ import annotations

from datetime import datetime, timezone
import json
from pathlib import Path
import sys
from typing import Any

import pg8000.dbapi

ROOT_DIR = Path(__file__).resolve().parent.parent
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from app.behavior_ml.dataset_builder import _load_db_env, load_real_accounts_from_postgres
from app.behavior_ml.schemas import AccountContextInput, AnalyzeImportedTradesRequest
from app.behavior_ml.service import behavior_ml_engine


def backfill_postgres_behavior_ml() -> dict[str, Any]:
    """
    Causally scores every real CLOSED imported trade in PostgreSQL (`trades`)
    using the Hybrid Behavior ML Engine and persists `qualityFlags.behavioralMl`
    without overwriting existing keys such as `behavioralFeedback`.
    """
    behavior_ml_engine.ensure_loaded(force_reload=True)
    bundles, db_stats = load_real_accounts_from_postgres()

    if not bundles:
        return {
            "status": "ok",
            "accountsScored": 0,
            "tradesUpdated": 0,
            "flaggedTrades": 0,
            "riskBreakdown": {"LOW": 0, "MODERATE": 0, "HIGH": 0, "CRITICAL": 0},
            "dbStats": db_stats,
        }

    cfg = _load_db_env()
    conn = pg8000.dbapi.connect(
        host=cfg["host"],
        port=cfg["port"],
        user=cfg["user"],
        password=cfg["password"],
        database=cfg["database"],
        timeout=15,
    )

    analyzed_at = datetime.now(timezone.utc).isoformat()
    accounts_scored = 0
    trades_updated = 0
    flagged_trades = 0
    risk_breakdown = {"LOW": 0, "MODERATE": 0, "HIGH": 0, "CRITICAL": 0}

    try:
        cur = conn.cursor()
        cur.execute("SET lock_timeout = '10s'")
        cur.execute("SET statement_timeout = '60s'")
        cur.execute(
            """
            SELECT data_type
            FROM information_schema.columns
            WHERE table_name = 'trades' AND column_name = 'qualityFlags'
            LIMIT 1
            """
        )
        col_row = cur.fetchone()
        is_jsonb = not col_row or str(col_row[0]).lower() == "jsonb"
        print(f"[Backfill] Scoring {len(bundles)} accounts (is_jsonb={is_jsonb})...", flush=True)

        for bundle in bundles:
            if not bundle.trades:
                continue
            accounts_scored += 1
            print(
                f"[Backfill] Account {accounts_scored}/{len(bundles)}: {bundle.anon_account_id} ({len(bundle.trades)} trades)...",
                flush=True,
            )

            req = AnalyzeImportedTradesRequest(
                accountContext=AccountContextInput(
                    accountId=bundle.anon_account_id,
                    accountType=bundle.account_type,
                    initialBalance=bundle.initial_balance,
                    balance=bundle.balance,
                    dailyLossLimit=bundle.daily_loss_limit,
                    maxDrawdown=bundle.max_drawdown,
                ),
                historicalTrades=[],
                newTrades=bundle.trades,
                journalContext=list(bundle.journal_by_date.values()),
                locale="pt",
            )
            resp = behavior_ml_engine.analyze_trades(req)

            for pred in resp.tradePredictions:
                ml_payload = {
                    "modelVersion": resp.modelVersion,
                    "modelStatus": resp.modelStatus,
                    "analyzedAt": analyzed_at,
                    "anomalyScore": pred.anomalyScore,
                    "riskLevel": pred.riskLevel,
                    "activeFlags": pred.activeFlags,
                    "probabilities": pred.probabilities,
                    "effectiveStrategy": pred.effectiveStrategy,
                    "effectiveSession": pred.effectiveSession,
                    "executionMode": pred.executionMode,
                    "reasons": pred.reasons,
                }
                if pred.riskLevel in risk_breakdown:
                    risk_breakdown[pred.riskLevel] += 1
                if pred.activeFlags or pred.anomalyScore >= 75.0:
                    flagged_trades += 1

                if is_jsonb:
                    cur.execute(
                        """
                        UPDATE trades
                        SET "qualityFlags" = COALESCE("qualityFlags", '{}'::jsonb)
                            || jsonb_build_object('behavioralMl', CAST(%s AS jsonb))
                        WHERE id = CAST(%s AS uuid)
                        """,
                        (json.dumps(ml_payload, ensure_ascii=False), str(pred.tradeId)),
                    )
                else:
                    cur.execute(
                        'SELECT "qualityFlags" FROM trades WHERE id = CAST(%s AS uuid)',
                        (str(pred.tradeId),),
                    )
                    existing_row = cur.fetchone()
                    existing_flags = (
                        existing_row[0]
                        if existing_row and isinstance(existing_row[0], dict)
                        else {}
                    )
                    merged = {**existing_flags, "behavioralMl": ml_payload}
                    cur.execute(
                        'UPDATE trades SET "qualityFlags" = CAST(%s AS json) WHERE id = CAST(%s AS uuid)',
                        (json.dumps(merged, ensure_ascii=False), str(pred.tradeId)),
                    )
                trades_updated += 1

        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()

    return {
        "status": "ok",
        "accountsScored": accounts_scored,
        "tradesUpdated": trades_updated,
        "flaggedTrades": flagged_trades,
        "riskBreakdown": risk_breakdown,
        "dbStats": db_stats,
    }


def main() -> int:
    summary = backfill_postgres_behavior_ml()
    print(json.dumps(summary, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
