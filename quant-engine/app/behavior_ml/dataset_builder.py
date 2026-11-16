from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
import hashlib
import json
import os
from pathlib import Path
import random
from typing import Any, Optional

from dotenv import load_dotenv
import numpy as np
import pg8000.dbapi
import polars as pl

from .features import (
    CAT_FEATURE_NAMES,
    CAT_VOCAB_SIZES,
    CONT_FEATURE_NAMES,
    STRATEGY_BASE_VOCAB,
    SYMBOL_BASE_VOCAB,
    extract_causal_sequence,
    label_source_for_row,
)
from .schemas import BEHAVIOR_CLASSES, ImportedTradeRecord, JournalContextItem


QUANT_ENGINE_ROOT = Path(__file__).resolve().parents[2]
WORKSPACE_ROOT = QUANT_ENGINE_ROOT.parent
ARTIFACT_ROOT = QUANT_ENGINE_ROOT / "artifacts" / "behavior_ml"
DATASETS_DIR = ARTIFACT_ROOT / "datasets"
MODELS_DIR = ARTIFACT_ROOT / "models"
DEFAULT_PARQUET_PATH = DATASETS_DIR / "imported_trades_features.parquet"
DEFAULT_MANIFEST_PATH = DATASETS_DIR / "dataset_manifest.json"
DEFAULT_CHECKPOINT_PATH = MODELS_DIR / "torex_behavior_net.pt"
DEFAULT_ENSEMBLE_PATH = MODELS_DIR / "torex_tabular_ensemble.joblib"
DEFAULT_METRICS_PATH = MODELS_DIR / "training_metrics.json"
DEFAULT_REPORT_PATH = MODELS_DIR / "TRAINING_REPORT.md"


@dataclass
class AccountHistoryBundle:
    anon_account_id: str
    account_type: str
    initial_balance: float
    balance: float
    daily_loss_limit: Optional[float]
    max_drawdown: Optional[float]
    trades: list[ImportedTradeRecord]
    journal_by_date: dict[str, JournalContextItem]
    source_split: str  # "REAL_DB" | "SYNTHETIC_ARCHETYPE"


def _parse_json_obj(raw: Any) -> dict[str, Any]:
    if raw is None:
        return {}
    if isinstance(raw, dict):
        return raw
    if isinstance(raw, str):
        try:
            parsed = json.loads(raw)
            return parsed if isinstance(parsed, dict) else {}
        except Exception:
            return {}
    return {}


def _safe_float(val: Any) -> Optional[float]:
    if val is None or val == "":
        return None
    try:
        num = float(val)
        return num if num == num else None
    except (TypeError, ValueError):
        return None


def _hash_anon_id(raw_id: str) -> str:
    return hashlib.sha256(f"torex-behavior-anon:{raw_id}".encode("utf-8")).hexdigest()[:16]


def _load_db_env() -> dict[str, Any]:
    for candidate in (
        WORKSPACE_ROOT / "backend-nest" / ".env",
        WORKSPACE_ROOT / ".env",
        QUANT_ENGINE_ROOT / ".env",
    ):
        if candidate.exists():
            load_dotenv(candidate, override=False)
            break
    return {
        "host": os.environ.get("DB_HOST", "127.0.0.1"),
        "port": int(os.environ.get("DB_PORT", "5432")),
        "user": os.environ.get("DB_USER", "postgres"),
        "password": os.environ.get("DB_PASS", "postgres"),
        "database": os.environ.get("DB_NAME", "trading_cossa"),
    }


def _rows_to_dicts(cursor: Any) -> list[dict[str, Any]]:
    cols = [desc[0] for desc in cursor.description]
    return [dict(zip(cols, row)) for row in cursor.fetchall()]


def load_real_accounts_from_postgres() -> tuple[list[AccountHistoryBundle], dict[str, Any]]:
    cfg = _load_db_env()
    conn = pg8000.dbapi.connect(
        host=cfg["host"],
        port=cfg["port"],
        user=cfg["user"],
        password=cfg["password"],
        database=cfg["database"],
        timeout=10,
    )
    try:
        cur = conn.cursor()
        cur.execute(
            """
            SELECT id::text AS id, user_id, type, currency,
                   initial_balance::float8 AS initial_balance,
                   balance::float8 AS balance,
                   leverage, prop_firm_rules
            FROM accounts
            """
        )
        account_rows = _rows_to_dicts(cur)

        cur.execute(
            """
            SELECT id::text AS id, account_id, ticket, "contractId" AS contract_id,
                   symbol, type,
                   volume::float8 AS volume,
                   open_price::float8 AS open_price,
                   close_price::float8 AS close_price,
                   profit::float8 AS profit,
                   commission::float8 AS commission,
                   swap::float8 AS swap,
                   "netPnl"::float8 AS net_pnl,
                   sl::float8 AS sl,
                   tp::float8 AS tp,
                   mfe::float8 AS mfe,
                   mae::float8 AS mae,
                   open_time, close_time, status, magic, comment,
                   session, mood, rating, setup, lesson, tags,
                   "qualityFlags" AS quality_flags
            FROM trades
            WHERE status = 'CLOSED' AND open_time IS NOT NULL
            ORDER BY account_id, open_time ASC
            """
        )
        trade_rows = _rows_to_dicts(cur)

        cur.execute(
            """
            SELECT user_id, trade_id, setup, mistakes, lessons, rating, psych_check
            FROM trade_notes
            """
        )
        trade_note_rows = _rows_to_dicts(cur)

        cur.execute(
            """
            SELECT account_id::text AS account_id, date::text AS date,
                   "strategyUsed" AS strategy_used, mistakes, rating,
                   "entryPrecision" AS entry_precision,
                   "riskManagement" AS risk_management,
                   "emotionalState" AS emotional_state,
                   "executionSpeed" AS execution_speed,
                   "rulesBroken" AS rules_broken
            FROM technical_journals
            """
        )
        tech_journal_rows = _rows_to_dicts(cur)

        cur.execute(
            """
            SELECT user_id, account_key, date::text AS date, title, mood, psych_check
            FROM daily_notes
            """
        )
        daily_note_rows = _rows_to_dicts(cur)

        cur.execute(
            """
            SELECT account_id::text AS account_id, date::text AS date,
                   "sleepQuality" AS sleep_quality, energy, focus,
                   mood, stress, caffeine, "overallScore" AS overall_score
            FROM mental_logs
            """
        )
        mental_rows = _rows_to_dicts(cur)
    finally:
        conn.close()

    accounts_by_id: dict[str, dict[str, Any]] = {str(a["id"]): a for a in account_rows}
    notes_by_key: dict[str, dict[str, Any]] = {}
    for n in trade_note_rows:
        tid = str(n.get("trade_id") or "").strip()
        if tid:
            notes_by_key[tid] = n

    journals_by_acc_date: dict[tuple[str, str], JournalContextItem] = {}
    for m in mental_rows:
        acc_id = str(m.get("account_id") or "").strip()
        d = str(m.get("date") or "")[:10]
        if not acc_id or not d:
            continue
        journals_by_acc_date[(acc_id, d)] = JournalContextItem(
            date=d,
            sleepQuality=_safe_float(m.get("sleep_quality")),
            energy=_safe_float(m.get("energy")),
            focus=_safe_float(m.get("focus")),
            moodScore=_safe_float(m.get("mood")),
            stress=_safe_float(m.get("stress")),
        )

    for tj in tech_journal_rows:
        acc_id = str(tj.get("account_id") or "").strip()
        d = str(tj.get("date") or "")[:10]
        if not acc_id or not d:
            continue
        existing = journals_by_acc_date.get((acc_id, d)) or JournalContextItem(date=d)
        existing.strategyUsed = tj.get("strategy_used") or existing.strategyUsed
        existing.emotionalState = tj.get("emotional_state") or existing.emotionalState
        existing.rulesBroken = tj.get("rules_broken") or existing.rulesBroken
        journals_by_acc_date[(acc_id, d)] = existing

    # Daily notes fallback keyed by user_id -> attach to matching accounts
    accounts_by_user: dict[str, list[str]] = {}
    for acc_id, acc in accounts_by_id.items():
        uid = str(acc.get("user_id") or "").strip()
        if uid:
            accounts_by_user.setdefault(uid, []).append(acc_id)

    for dn in daily_note_rows:
        uid = str(dn.get("user_id") or "").strip()
        d = str(dn.get("date") or "")[:10]
        if not uid or not d:
            continue
        psych = _parse_json_obj(dn.get("psych_check"))
        acc_key = str(dn.get("account_key") or "all").strip()
        target_accs = [acc_key] if acc_key in accounts_by_id else accounts_by_user.get(uid, [])
        for acc_id in target_accs:
            existing = journals_by_acc_date.get((acc_id, d)) or JournalContextItem(date=d)
            if not existing.emotionalState and (psych.get("moodState") or dn.get("mood")):
                existing.emotionalState = str(psych.get("moodState") or dn.get("mood"))
            if existing.stress is None and psych.get("stress") is not None:
                existing.stress = _safe_float(psych.get("stress"))
            if existing.sleepQuality is None and psych.get("sleep") is not None:
                existing.sleepQuality = _safe_float(psych.get("sleep"))
            if existing.energy is None and psych.get("energy") is not None:
                existing.energy = _safe_float(psych.get("energy"))
            if existing.focus is None and psych.get("focus") is not None:
                existing.focus = _safe_float(psych.get("focus"))
            journals_by_acc_date[(acc_id, d)] = existing

    trades_by_acc: dict[str, list[ImportedTradeRecord]] = {}
    annotated_trades = 0
    human_feedback_trades = 0
    for r in trade_rows:
        acc_id = str(r.get("account_id") or "").strip()
        if not acc_id:
            continue
        tid = str(r["id"])
        ticket = str(r.get("ticket") or "").strip() or None
        note = notes_by_key.get(tid) or (notes_by_key.get(ticket) if ticket else None)
        psych = _parse_json_obj(note.get("psych_check")) if note else {}

        qflags = _parse_json_obj(r.get("quality_flags"))
        fb = _parse_json_obj(qflags.get("behavioralFeedback"))
        raw_verdict = fb.get("verdict")
        fb_verdict = raw_verdict if raw_verdict in {"CONFIRM", "FALSE_POSITIVE"} else None
        raw_fb_flags = fb.get("correctedFlags")
        fb_flags = [str(f) for f in raw_fb_flags] if isinstance(raw_fb_flags, list) else None
        if fb_verdict is not None:
            human_feedback_trades += 1

        setup = (note.get("setup") if note and note.get("setup") else None) or r.get("setup")
        mistakes = note.get("mistakes") if note else None
        rating = note.get("rating") if note and note.get("rating") is not None else r.get("rating")
        if note or r.get("setup") or r.get("mood"):
            annotated_trades += 1

        rec = ImportedTradeRecord(
            id=tid,
            ticket=ticket,
            symbol=str(r.get("symbol") or "UNKNOWN"),
            type=str(r.get("type") or "BUY"),
            volume=float(r.get("volume") or 0.0),
            openPrice=float(r.get("open_price") or 0.0),
            closePrice=float(r.get("close_price") or 0.0),
            sl=_safe_float(r.get("sl")),
            tp=_safe_float(r.get("tp")),
            profit=float(r.get("profit") or 0.0),
            commission=float(r.get("commission") or 0.0),
            swap=float(r.get("swap") or 0.0),
            netPnl=_safe_float(r.get("net_pnl")),
            mfe=_safe_float(r.get("mfe")),
            mae=_safe_float(r.get("mae")),
            openTime=r["open_time"].isoformat() if isinstance(r["open_time"], datetime) else str(r["open_time"]),
            closeTime=(
                r["close_time"].isoformat()
                if isinstance(r.get("close_time"), datetime)
                else (str(r["close_time"]) if r.get("close_time") else None)
            ),
            magic=int(r.get("magic") or 0),
            comment=r.get("comment"),
            session=r.get("session"),
            setup=setup,
            mood=r.get("mood"),
            rating=_safe_float(rating),
            tags=r.get("tags") if isinstance(r.get("tags"), list) else None,
            followingPlan=psych.get("followingPlan"),
            entryDriver=psych.get("entryDriver"),
            riskComfort=psych.get("riskComfort"),
            mistakes=mistakes,
            feedbackVerdict=fb_verdict,
            feedbackFlags=fb_flags,
        )
        trades_by_acc.setdefault(acc_id, []).append(rec)

    bundles: list[AccountHistoryBundle] = []
    for acc_id, acc_trades in trades_by_acc.items():
        if not acc_trades:
            continue
        acc = accounts_by_id.get(acc_id, {})
        rules = _parse_json_obj(acc.get("prop_firm_rules"))
        acc_journals = {
            d: j for (a_id, d), j in journals_by_acc_date.items() if a_id == acc_id
        }
        bundles.append(
            AccountHistoryBundle(
                anon_account_id=_hash_anon_id(acc_id),
                account_type=str(acc.get("type") or "live"),
                initial_balance=float(acc.get("initial_balance") or 0.0),
                balance=float(acc.get("balance") or 0.0),
                daily_loss_limit=_safe_float(rules.get("dailyLossLimit")),
                max_drawdown=_safe_float(rules.get("maxDrawdown")),
                trades=acc_trades,
                journal_by_date=acc_journals,
                source_split="REAL_DB",
            )
        )

    stats = {
        "real_accounts": len(bundles),
        "real_trades": sum(len(b.trades) for b in bundles),
        "real_annotated_trades": annotated_trades,
        "human_feedback_trades": human_feedback_trades,
        "trade_notes_rows": len(trade_note_rows),
        "technical_journals_rows": len(tech_journal_rows),
        "daily_notes_rows": len(daily_note_rows),
        "mental_logs_rows": len(mental_rows),
    }
    return bundles, stats


def generate_synthetic_archetype_sequences(
    num_accounts: int = 60,
    seed: int = 42,
) -> list[AccountHistoryBundle]:
    """Generate realistic multi-session imported-trade sequences across 5 behavioral archetypes."""
    rng = random.Random(seed)
    archetypes = (
        "disciplined",
        "revenge_escalator",
        "prop_tilt",
        "ea_manual_override",
        "fomo_overtrader",
    )
    bundles: list[AccountHistoryBundle] = []
    base_start = datetime(2026, 6, 1, 8, 0, tzinfo=timezone.utc)

    for acc_idx in range(num_accounts):
        archetype = archetypes[acc_idx % len(archetypes)]
        is_prop = archetype == "prop_tilt" or (acc_idx % 4 == 2)
        acc_type = rng.choice(["challenge", "prop_firm", "funded"]) if is_prop else rng.choice(["live", "demo"])
        init_bal = rng.choice([5000.0, 10000.0, 25000.0, 50000.0, 100000.0])
        daily_limit = round(init_bal * 0.04, 2) if is_prop else None
        max_dd = round(init_bal * 0.08, 2) if is_prop else None

        base_vol = round(max(0.01, (init_bal / 10000.0) * rng.uniform(0.15, 0.45)), 2)
        primary_symbol = rng.choice(["XAUUSD", "EURUSD", "NAS100", "GBPUSD"])
        alt_symbol = "BTCUSD" if primary_symbol != "BTCUSD" else "USDJPY"
        primary_setup = rng.choice(["LONDON_OPEN", "NY_BREAKOUT", "SMC_OB", "LIQUIDITY_SWEEP"])
        primary_hour = 9 if primary_setup == "LONDON_OPEN" else 14
        is_ea_acc = archetype == "ea_manual_override"
        ea_magic = rng.randint(10001, 99999) if is_ea_acc else 0

        num_trades = rng.randint(44, 68)
        cur_dt = base_start + timedelta(days=rng.randint(0, 15))
        trades: list[ImportedTradeRecord] = []
        journals: dict[str, JournalContextItem] = {}

        equity = init_bal
        peak_equity = init_bal
        consec_losses = 0
        consec_wins = 0
        day_pnl = 0.0
        last_day = cur_dt.strftime("%Y-%m-%d")

        for step in range(num_trades):
            # Advance across days naturally
            if step > 0 and rng.random() < 0.28:
                cur_dt = (cur_dt + timedelta(days=1)).replace(
                    hour=primary_hour, minute=rng.randint(0, 45), second=0
                )
            elif step > 0:
                cur_dt = cur_dt + timedelta(minutes=rng.randint(35, 110))

            day_str = cur_dt.strftime("%Y-%m-%d")
            if day_str != last_day:
                day_pnl = 0.0
                last_day = day_str

            if day_str not in journals and rng.random() < 0.35:
                stress_base = 7.5 if archetype in {"revenge_escalator", "prop_tilt"} and consec_losses >= 2 else 3.5
                journals[day_str] = JournalContextItem(
                    date=day_str,
                    sleepQuality=round(rng.uniform(4.5, 9.0), 1),
                    energy=round(rng.uniform(4.5, 9.0), 1),
                    focus=round(rng.uniform(4.0, 9.0), 1),
                    stress=round(min(10.0, max(1.0, stress_base + rng.uniform(-1.5, 2.0))), 1),
                    strategyUsed=primary_setup,
                )

            symbol = primary_symbol
            setup = primary_setup if rng.random() < 0.72 else None
            magic = ea_magic if (is_ea_acc and rng.random() < 0.78) else 0
            vol = round(max(0.01, base_vol * rng.uniform(0.85, 1.15)), 2)
            open_price = 2650.0 if symbol == "XAUUSD" else 1.0850
            sl = round(open_price * 0.996, 4)
            tp = round(open_price * 1.008, 4)

            entry_driver: Optional[str] = None
            following_plan: Optional[str] = None
            risk_comfort: Optional[str] = None
            mistakes: Optional[str] = None
            mood: Optional[str] = None

            # Inject archetype behaviors causally after prior context
            trigger_revenge = (
                archetype in {"revenge_escalator", "prop_tilt"}
                and consec_losses >= 1
                and step >= 8
                and rng.random() < (0.72 if consec_losses >= 2 else 0.40)
            )
            trigger_burst = (
                archetype == "fomo_overtrader"
                and step >= 10
                and rng.random() < 0.25
            )
            trigger_euphoria = (
                archetype in {"disciplined", "fomo_overtrader"}
                and consec_wins >= 3
                and rng.random() < 0.55
            )
            trigger_manual_override = (
                is_ea_acc
                and step >= 10
                and consec_losses >= 1
                and rng.random() < 0.55
            )
            trigger_prop_tilt = (
                is_prop
                and daily_limit is not None
                and (-day_pnl) >= daily_limit * 0.62
                and step >= 10
            )

            if trigger_revenge:
                if trades:
                    prev_close = datetime.fromisoformat(str(trades[-1].closeTime))
                    cur_dt = prev_close + timedelta(minutes=rng.randint(1, 9))
                vol = round(base_vol * rng.uniform(1.6, 2.8), 2)
                if rng.random() < 0.55:
                    sl = None
                if rng.random() < 0.45:
                    symbol = alt_symbol
                    setup = None
                if rng.random() < 0.45:
                    entry_driver = "Vingança"
                    following_plan = "Não"
                    risk_comfort = "Não"
                    mood = "Frustrated"
            elif trigger_burst:
                # 4 rapid clustered entries on unfamiliar hour/symbol
                for burst_i in range(4):
                    b_dt = cur_dt + timedelta(minutes=burst_i * rng.randint(4, 10))
                    b_close = b_dt + timedelta(minutes=rng.randint(3, 8))
                    b_pnl = round(base_vol * init_bal * 0.002 * rng.choice([-1.2, -0.8, 0.7]), 2)
                    b_driver = "FOMO" if (burst_i >= 2 and rng.random() < 0.4) else None
                    trades.append(
                        ImportedTradeRecord(
                            id=f"syn-{acc_idx}-{step}-b{burst_i}",
                            symbol=alt_symbol if burst_i >= 2 else primary_symbol,
                            type=rng.choice(["BUY", "SELL"]),
                            volume=round(base_vol * rng.uniform(1.1, 1.6), 2),
                            openPrice=open_price,
                            closePrice=open_price * 1.001,
                            sl=sl,
                            tp=tp,
                            profit=b_pnl,
                            netPnl=b_pnl,
                            openTime=b_dt.isoformat(),
                            closeTime=b_close.isoformat(),
                            magic=0,
                            setup=None,
                            entryDriver=b_driver,
                            followingPlan="Não" if b_driver else None,
                        )
                    )
                    equity += b_pnl
                    peak_equity = max(peak_equity, equity)
                    day_pnl += b_pnl
                    if b_pnl < 0:
                        consec_losses += 1
                        consec_wins = 0
                    else:
                        consec_wins += 1
                        consec_losses = 0
                cur_dt = cur_dt + timedelta(minutes=45)
                continue
            elif trigger_manual_override:
                magic = 0
                vol = round(base_vol * rng.uniform(1.3, 2.0), 2)
                setup = None
                if rng.random() < 0.35:
                    following_plan = "Não"
            elif trigger_euphoria:
                vol = round(base_vol * rng.uniform(1.55, 2.2), 2)
                if rng.random() < 0.4:
                    sl = None
                if rng.random() < 0.35:
                    mood = "Euphoric"
            elif trigger_prop_tilt:
                vol = round(base_vol * rng.uniform(1.35, 2.1), 2)
                if rng.random() < 0.5:
                    sl = None
                if rng.random() < 0.4:
                    risk_comfort = "Não"

            # Occasional off-session drift after loss
            if archetype in {"revenge_escalator", "fomo_overtrader"} and consec_losses >= 2 and rng.random() < 0.35:
                cur_dt = cur_dt.replace(hour=22, minute=rng.randint(5, 40))

            # Occasional positive journal labeling on clean trades
            if not any([trigger_revenge, trigger_euphoria, trigger_manual_override, trigger_prop_tilt]) and rng.random() < 0.25:
                entry_driver = "Estratégia / Plano"
                following_plan = "Sim"
                risk_comfort = "Sim"
                mood = "Focused"

            duration_min = rng.randint(12, 95)
            close_dt = cur_dt + timedelta(minutes=duration_min)
            win_prob = 0.58 if archetype == "disciplined" else 0.44
            is_win = rng.random() < win_prob
            pnl_mag = (vol / base_vol) * init_bal * rng.uniform(0.004, 0.011)
            pnl = round(pnl_mag if is_win else -pnl_mag * 0.9, 2)

            trades.append(
                ImportedTradeRecord(
                    id=f"syn-{acc_idx}-{step}",
                    symbol=symbol,
                    type=rng.choice(["BUY", "SELL"]),
                    volume=vol,
                    openPrice=open_price,
                    closePrice=open_price * (1.002 if is_win else 0.998),
                    sl=sl,
                    tp=tp,
                    profit=pnl,
                    netPnl=pnl,
                    openTime=cur_dt.isoformat(),
                    closeTime=close_dt.isoformat(),
                    magic=magic,
                    setup=setup,
                    mood=mood,
                    entryDriver=entry_driver,
                    followingPlan=following_plan,
                    riskComfort=risk_comfort,
                    mistakes=mistakes,
                )
            )
            equity += pnl
            peak_equity = max(peak_equity, equity)
            day_pnl += pnl
            if pnl > 0:
                consec_wins += 1
                consec_losses = 0
            elif pnl < 0:
                consec_losses += 1
                consec_wins = 0

        bundles.append(
            AccountHistoryBundle(
                anon_account_id=f"syn_acc_{acc_idx:03d}_{archetype}",
                account_type=acc_type,
                initial_balance=init_bal,
                balance=round(equity, 2),
                daily_loss_limit=daily_limit,
                max_drawdown=max_dd,
                trades=trades,
                journal_by_date=journals,
                source_split="SYNTHETIC_ARCHETYPE",
            )
        )
    return bundles


def hash_bucket_diagnostics(df: pl.DataFrame) -> dict[str, Any]:
    """Report how many distinct out-of-vocabulary tokens share each hashed embedding bucket.

    Symbols and strategies outside the fixed vocabularies are hashed into a small range of
    embedding rows, so two unrelated tokens can end up with the same learned vector.
    """
    specs = (
        ("symbol_idx", "symbol_token", max(SYMBOL_BASE_VOCAB.values()) + 1),
        ("strategy_idx", "effective_strategy", max(STRATEGY_BASE_VOCAB.values()) + 1),
    )
    out: dict[str, Any] = {}
    for idx_col, token_col, hashed_start in specs:
        if len(df) == 0 or idx_col not in df.columns or token_col not in df.columns:
            continue
        hashed = df.filter(pl.col(idx_col) >= hashed_start)
        grouped = (
            hashed.group_by(idx_col)
            .agg(pl.col(token_col).unique().sort().alias("tokens"), pl.len().alias("rows"))
            .sort(idx_col)
        )
        collisions = [
            {"bucket": int(r[idx_col]), "tokens": list(r["tokens"])[:10], "rows": int(r["rows"])}
            for r in grouped.iter_rows(named=True)
            if len(r["tokens"]) > 1
        ]
        out[idx_col] = {
            "hashedBuckets": int(CAT_VOCAB_SIZES[idx_col] - hashed_start),
            "bucketsUsed": int(grouped.height),
            "distinctHashedTokens": int(hashed[token_col].n_unique()) if hashed.height else 0,
            "hashedRowShare": round(hashed.height / max(1, len(df)), 4),
            "collidingBuckets": collisions,
        }
    return out


def build_behavior_dataset(
    *,
    include_real_db: bool = True,
    synthetic_accounts: int = 60,
    seed: int = 42,
    parquet_path: Path = DEFAULT_PARQUET_PATH,
    manifest_path: Path = DEFAULT_MANIFEST_PATH,
) -> tuple[pl.DataFrame, dict[str, Any]]:
    bundles: list[AccountHistoryBundle] = []
    db_stats: dict[str, Any] = {"real_accounts": 0, "real_trades": 0}

    if include_real_db:
        try:
            real_bundles, db_stats = load_real_accounts_from_postgres()
            bundles.extend(real_bundles)
        except Exception as exc:
            db_stats = {"real_accounts": 0, "real_trades": 0, "db_error": str(exc)}

    if synthetic_accounts > 0:
        bundles.extend(generate_synthetic_archetype_sequences(num_accounts=synthetic_accounts, seed=seed))

    rows: list[dict[str, Any]] = []
    for bundle in bundles:
        seq = extract_causal_sequence(
            trades=bundle.trades,
            account_type=bundle.account_type,
            initial_balance=bundle.initial_balance,
            balance=bundle.balance,
            daily_loss_limit=bundle.daily_loss_limit,
            max_drawdown=bundle.max_drawdown,
            journal_by_date=bundle.journal_by_date,
            compute_labels=True,
        )
        total_len = len(bundle.trades)
        cont = seq["cont"]
        cats = seq["cats"]
        targets = seq["targets"]
        weights = seq["weights"]
        is_clean = seq["is_clean"]
        meta = seq["meta"]

        # Strict per-account chronological split (earliest 80% train, latest 20% val)
        train_cutoff = max(1, int(total_len * 0.80)) if total_len >= 5 else total_len

        for i in range(total_len):
            split_name = "train" if i < train_cutoff else "val"
            row: dict[str, Any] = {
                "anon_account_id": bundle.anon_account_id,
                "source_split": bundle.source_split,
                "split": split_name,
                "account_seq_idx": i,
                "account_total_len": total_len,
                "effective_session": meta[i]["effective_session"],
                "symbol_token": meta[i]["symbol_token"],
                "effective_strategy": meta[i]["effective_strategy"],
                "execution_mode": meta[i]["execution_mode"],
                "sample_weight": float(weights[i]),
                "label_source": label_source_for_row(weights[i], bundle.source_split),
                "is_clean_step": bool(is_clean[i]),
            }
            for f_idx, f_name in enumerate(CONT_FEATURE_NAMES):
                row[f_name] = float(cont[i, f_idx])
            for c_idx, c_name in enumerate(CAT_FEATURE_NAMES):
                row[c_name] = int(cats[i, c_idx])
            for t_idx, cls_name in enumerate(BEHAVIOR_CLASSES):
                row[f"y_{cls_name}"] = float(targets[i, t_idx])
            rows.append(row)

    df = pl.DataFrame(rows)
    parquet_path.parent.mkdir(parents=True, exist_ok=True)
    df.write_parquet(parquet_path)

    class_counts = {
        cls_name: int(df[f"y_{cls_name}"].sum()) if len(df) > 0 else 0
        for cls_name in BEHAVIOR_CLASSES
    }
    label_provenance: dict[str, dict[str, int]] = {}
    if len(df) > 0:
        prov_df = df.group_by(["source_split", "label_source"]).len()
        for rec in prov_df.iter_rows(named=True):
            label_provenance.setdefault(str(rec["source_split"]), {})[str(rec["label_source"])] = int(rec["len"])

    manifest = {
        "createdAtUtc": datetime.now(timezone.utc).isoformat(),
        "parquetPath": str(parquet_path),
        "totalRows": int(len(df)),
        "realDbRows": int(df.filter(pl.col("source_split") == "REAL_DB").height) if len(df) > 0 else 0,
        "syntheticRows": int(df.filter(pl.col("source_split") == "SYNTHETIC_ARCHETYPE").height) if len(df) > 0 else 0,
        "trainRows": int(df.filter(pl.col("split") == "train").height) if len(df) > 0 else 0,
        "valRows": int(df.filter(pl.col("split") == "val").height) if len(df) > 0 else 0,
        "cleanSteps": int(df["is_clean_step"].sum()) if len(df) > 0 else 0,
        "continuousFeatures": list(CONT_FEATURE_NAMES),
        "categoricalFeatures": list(CAT_FEATURE_NAMES),
        "behaviorClasses": list(BEHAVIOR_CLASSES),
        "positiveCounts": class_counts,
        "labelProvenance": label_provenance,
        "hashBucketDiagnostics": hash_bucket_diagnostics(df),
        "dbStats": db_stats,
        "piiSanitized": True,
    }
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    manifest_path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8")
    return df, manifest
