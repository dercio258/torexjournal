from __future__ import annotations

from collections import Counter, deque
from datetime import datetime, timezone
import hashlib
import heapq
import math
import re
from typing import Any, Optional, Sequence

import numpy as np

from .schemas import BEHAVIOR_CLASSES, ImportedTradeRecord, JournalContextItem


CONT_FEATURE_NAMES: tuple[str, ...] = (
    "volume_ratio_median20",
    "volume_zscore20",
    "dt_since_prev_close_log",
    "trades_last_1h_norm",
    "trades_today_norm",
    "cadence_burst_ratio",
    "prev_trade_pnl_norm",
    "loss_streak_before",
    "win_streak_before",
    "daily_pnl_before_pct",
    "rolling_drawdown_before_pct",
    "prop_daily_dd_utilization",
    "has_sl",
    "has_tp",
    "sl_discipline_drop",
    "planned_rr_norm",
    "is_unfamiliar_session_or_symbol",
    "mental_stress_fatigue_score",
    "hour_sin",
    "hour_cos",
    "dow_sin",
    "dow_cos",
)

CAT_FEATURE_NAMES: tuple[str, ...] = (
    "session_idx",
    "symbol_idx",
    "strategy_idx",
    "account_type_idx",
    "exec_mode_idx",
)

SESSION_VOCAB: dict[str, int] = {
    "<PAD>": 0,
    "<UNK>": 1,
    "Sydney": 2,
    "Tokyo": 3,
    "London": 4,
    "New York": 5,
    "Sydney / Tokyo": 6,
    "Tokyo / London": 7,
    "London / New York": 8,
    "New York / Sydney": 9,
    "Off-Session": 10,
    "Other": 11,
}

SYMBOL_BASE_VOCAB: dict[str, int] = {
    "<PAD>": 0,
    "<UNK>": 1,
    "XAUUSD": 2,
    "EURUSD": 3,
    "GBPUSD": 4,
    "USDJPY": 5,
    "USDCAD": 6,
    "AUDUSD": 7,
    "NZDUSD": 8,
    "USDCHF": 9,
    "EURJPY": 10,
    "GBPJPY": 11,
    "EURGBP": 12,
    "NAS100": 13,
    "USTEC": 14,
    "US30": 15,
    "US500": 16,
    "SPX500": 17,
    "GER40": 18,
    "DAX": 19,
    "BTCUSD": 20,
    "ETHUSD": 21,
    "XAGUSD": 22,
    "USOIL": 23,
    "UKOIL": 24,
    "VOLATILITY_10": 25,
    "VOLATILITY_25": 26,
    "VOLATILITY_50": 27,
    "VOLATILITY_75": 28,
    "VOLATILITY_100": 29,
    "BOOM": 30,
    "CRASH": 31,
    "STEP": 32,
    "JUMP": 33,
}

STRATEGY_BASE_VOCAB: dict[str, int] = {
    "<PAD>": 0,
    "<UNK>": 1,
    "<UNTAGGED>": 2,
    "LONDON_OPEN": 3,
    "NY_BREAKOUT": 4,
    "SMC_OB": 5,
    "LIQUIDITY_SWEEP": 6,
    "TREND_FOLLOW": 7,
    "MEAN_REVERSION": 8,
    "SCALPING": 9,
    "SWING": 10,
    "EMA_CROSS": 11,
    "PRICE_ACTION": 12,
    "ICT_FVG": 13,
    "EA_BOT": 14,
}

ACCOUNT_TYPE_VOCAB: dict[str, int] = {
    "<PAD>": 0,
    "<UNK>": 1,
    "live": 2,
    "demo": 3,
    "prop_firm": 4,
    "challenge": 5,
    "funded": 6,
    "custom": 7,
}

EXEC_MODE_VOCAB: dict[str, int] = {
    "<PAD>": 0,
    "MANUAL": 1,
    "EA_BOT": 2,
    "MANUAL_ON_EA_ACCOUNT": 3,
    "DERIV_CONTRACT": 4,
}

CAT_VOCAB_SIZES: dict[str, int] = {
    "session_idx": 12,
    "symbol_idx": 64,
    "strategy_idx": 48,
    "account_type_idx": 10,
    "exec_mode_idx": 5,
}

# Sample weights double as label provenance markers (see compute_behavior_targets).
LABEL_WEIGHT_FEEDBACK = 5.0  # human-in-the-loop verdict on a model alert
LABEL_WEIGHT_JOURNAL = 3.0  # trader journal fields (entryDriver, mistakes, mood, ...)
LABEL_WEIGHT_WEAK = 1.0  # deterministic weak-supervision rules over X_t features only

LABEL_SOURCE_FEEDBACK = "FEEDBACK"
LABEL_SOURCE_JOURNAL = "JOURNAL"
LABEL_SOURCE_WEAK = "WEAK_RULE"
# Journal-style fields written by the synthetic archetype generator. They follow the generator's
# script, not a human, so they must never count as gold evidence.
LABEL_SOURCE_SYNTHETIC = "SYNTHETIC_SCRIPTED"
GOLD_LABEL_SOURCES: frozenset[str] = frozenset({LABEL_SOURCE_FEEDBACK, LABEL_SOURCE_JOURNAL})
SYNTHETIC_SOURCE_SPLIT = "SYNTHETIC_ARCHETYPE"


def label_source_for_row(weight: float, source_split: str) -> str:
    """Label provenance for a dataset row: scripted synthetic labels are never gold."""
    base = label_source_from_weight(weight)
    if source_split == SYNTHETIC_SOURCE_SPLIT and base != LABEL_SOURCE_WEAK:
        return LABEL_SOURCE_SYNTHETIC
    return base


def label_source_from_weight(weight: float) -> str:
    """Recover label provenance from the sample weight assigned by compute_behavior_targets."""
    w = float(weight)
    if w >= LABEL_WEIGHT_FEEDBACK:
        return LABEL_SOURCE_FEEDBACK
    if w >= LABEL_WEIGHT_JOURNAL:
        return LABEL_SOURCE_JOURNAL
    return LABEL_SOURCE_WEAK


_COMMENT_NOISE_RE = re.compile(
    # Import markers ("Imported via ...", "Imported HTML") and Deriv contract descriptions
    # ("Win payout if Volatility 75 Index ...") are not strategies.
    r"^(imported\b.*|(win|lose|loss) payout.*|sl|tp|\[sl.*|\[tp.*|so:|partial.*|auto.*|\d+)$",
    re.IGNORECASE,
)


def parse_timestamp_sec(value: Any) -> float:
    """Parse ISO string, datetime, or epoch ms/sec into UTC seconds."""
    if value is None:
        return 0.0
    if isinstance(value, datetime):
        dt = value if value.tzinfo else value.replace(tzinfo=timezone.utc)
        return float(dt.timestamp())
    if isinstance(value, (int, float)):
        num = float(value)
        if not math.isfinite(num) or num <= 0:
            return 0.0
        return num / 1000.0 if num > 1e11 else num
    text = str(value).strip()
    if not text:
        return 0.0
    try:
        num = float(text)
        if math.isfinite(num) and num > 0:
            return num / 1000.0 if num > 1e11 else num
    except ValueError:
        pass
    norm = text.replace("Z", "+00:00").replace(".", "-", 2)
    try:
        dt = datetime.fromisoformat(norm)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return float(dt.timestamp())
    except ValueError:
        return 0.0


def infer_session_from_timestamp(ts_sec: float) -> str:
    """Match backend-nest adapter UTC session bucketing."""
    if ts_sec <= 0:
        return "Off-Session"
    dt = datetime.fromtimestamp(ts_sec, tz=timezone.utc)
    hour = dt.hour
    sessions: list[str] = []
    if hour >= 22 or hour < 7:
        sessions.append("Sydney")
    if 0 <= hour < 9:
        sessions.append("Tokyo")
    if 8 <= hour < 17:
        sessions.append("London")
    if 13 <= hour < 22:
        sessions.append("New York")
    return " / ".join(sessions) if sessions else "Off-Session"


def normalize_session_label(raw_session: Optional[str], open_ts_sec: float) -> str:
    if raw_session:
        cleaned = " ".join(str(raw_session).strip().split())
        if cleaned and cleaned.lower() not in {"unknown", "none", "null", "n/a"}:
            if cleaned in SESSION_VOCAB:
                return cleaned
            low = cleaned.lower()
            parts: list[str] = []
            if "sydney" in low:
                parts.append("Sydney")
            if "tokyo" in low or "asia" in low:
                parts.append("Tokyo")
            if "london" in low:
                parts.append("London")
            if "new york" in low or low == "ny":
                parts.append("New York")
            if parts:
                joined = " / ".join(parts)
                return joined if joined in SESSION_VOCAB else parts[0]
            if "off" in low:
                return "Off-Session"
    return infer_session_from_timestamp(open_ts_sec)


def session_to_idx(session_label: str) -> int:
    if session_label in SESSION_VOCAB:
        return SESSION_VOCAB[session_label]
    return SESSION_VOCAB["Other"]


def normalize_symbol_token(raw_symbol: Optional[str]) -> str:
    s = re.sub(r"[^A-Z0-9]", "", str(raw_symbol or "UNKNOWN").upper())
    if not s:
        return "UNKNOWN"
    for suffix in ("M", "PRO", "RAW", "ECN", "MICRO", "C"):
        if len(s) > 6 and s.endswith(suffix) and s[:6] in SYMBOL_BASE_VOCAB:
            return s[:6]
    if "VOLATILITY100" in s or "1HZ100V" in s or s == "R100":
        return "VOLATILITY_100"
    if "VOLATILITY75" in s or "1HZ75V" in s or s == "R75":
        return "VOLATILITY_75"
    if "VOLATILITY50" in s or "1HZ50V" in s or s == "R50":
        return "VOLATILITY_50"
    if "VOLATILITY25" in s or "1HZ25V" in s or s == "R25":
        return "VOLATILITY_25"
    if "VOLATILITY10" in s or "1HZ10V" in s or s == "R10":
        return "VOLATILITY_10"
    if "BOOM" in s:
        return "BOOM"
    if "CRASH" in s:
        return "CRASH"
    if "STEPINDEX" in s or s == "STEP":
        return "STEP"
    if "JUMP" in s:
        return "JUMP"
    if s in {"GOLD", "XAUUSD"} or s.startswith("XAUUSD"):
        return "XAUUSD"
    if s in {"US100", "NDX", "NQ", "NAS100"}:
        return "NAS100"
    if s in {"DJ30", "US30", "DJI"}:
        return "US30"
    return s


def _stable_hash_bucket(token: str, start_idx: int, vocab_size: int) -> int:
    span = max(1, vocab_size - start_idx)
    digest = hashlib.sha256(token.encode("utf-8")).digest()
    val = int.from_bytes(digest[:4], "big")
    return start_idx + (val % span)


def symbol_to_idx(symbol_token: str) -> int:
    if symbol_token in SYMBOL_BASE_VOCAB:
        return SYMBOL_BASE_VOCAB[symbol_token]
    start = max(SYMBOL_BASE_VOCAB.values()) + 1
    return _stable_hash_bucket(symbol_token, start, CAT_VOCAB_SIZES["symbol_idx"])


def resolve_effective_strategy(
    setup: Optional[str],
    journal_strategy: Optional[str],
    magic: int,
    comment: Optional[str],
) -> str:
    for candidate in (setup, journal_strategy):
        if candidate:
            cleaned = str(candidate).strip()
            if cleaned and cleaned.lower() not in {"unknown", "none", "null", "n/a", "-"}:
                return cleaned[:64]
    if magic and int(magic) != 0:
        return f"EA:{int(magic)}"
    if comment:
        c = str(comment).strip()
        if c and not _COMMENT_NOISE_RE.match(c) and len(c) >= 3:
            return f"CMD:{c[:32]}"
    return "<UNTAGGED>"


def strategy_to_idx(strategy_label: str) -> int:
    if strategy_label == "<UNTAGGED>":
        return STRATEGY_BASE_VOCAB["<UNTAGGED>"]
    norm = re.sub(r"[^A-Z0-9]+", "_", strategy_label.upper()).strip("_")
    if norm in STRATEGY_BASE_VOCAB:
        return STRATEGY_BASE_VOCAB[norm]
    if norm.startswith("EA_"):
        # Blend structural EA token or hash bucket
        start = max(STRATEGY_BASE_VOCAB.values()) + 1
        return _stable_hash_bucket(norm, start, CAT_VOCAB_SIZES["strategy_idx"])
    # Match whole tokens, not substrings: "NY" must not fire on "ANY", "OB" on "ROBOT",
    # "OPEN" on "REOPEN" or "ICT" on "STRICT". Long distinctive stems still match as prefixes.
    tokens = [tok for tok in norm.split("_") if tok]
    token_set = set(tokens)

    def _has_prefix(*stems: str) -> bool:
        return any(tok.startswith(stem) for tok in tokens for stem in stems)

    if token_set & {"LONDON", "OPEN", "LDN"}:
        return STRATEGY_BASE_VOCAB["LONDON_OPEN"]
    if token_set & {"NY", "NYC", "NEWYORK", "BREAKOUT", "BO"} or "NEW_YORK" in norm:
        return STRATEGY_BASE_VOCAB["NY_BREAKOUT"]
    if token_set & {"SMC", "OB", "ORDERBLOCK"} or "ORDER_BLOCK" in norm:
        return STRATEGY_BASE_VOCAB["SMC_OB"]
    if _has_prefix("LIQUID", "SWEEP") or "LIQ" in token_set:
        return STRATEGY_BASE_VOCAB["LIQUIDITY_SWEEP"]
    if _has_prefix("TREND", "PULLBACK"):
        return STRATEGY_BASE_VOCAB["TREND_FOLLOW"]
    if _has_prefix("SCALP"):
        return STRATEGY_BASE_VOCAB["SCALPING"]
    if _has_prefix("SWING"):
        return STRATEGY_BASE_VOCAB["SWING"]
    if token_set & {"FVG", "ICT"}:
        return STRATEGY_BASE_VOCAB["ICT_FVG"]
    start = max(STRATEGY_BASE_VOCAB.values()) + 1
    return _stable_hash_bucket(norm or "UNKNOWN", start, CAT_VOCAB_SIZES["strategy_idx"])


def account_type_to_idx(account_type: Optional[str]) -> int:
    key = str(account_type or "live").strip().lower()
    return ACCOUNT_TYPE_VOCAB.get(key, ACCOUNT_TYPE_VOCAB["<UNK>"])


def is_deriv_trade(symbol_raw: Optional[str], comment: Optional[str]) -> bool:
    s = str(symbol_raw or "").upper()
    c = str(comment or "").upper()
    return (
        "VOLATILITY" in s
        or "BOOM" in s
        or "CRASH" in s
        or "STEP" in s
        or "JUMP" in s
        or s.startswith("1HZ")
        or s.startswith("R_")
        or "DERIV" in c
    )


def _robust_median(values: Sequence[float]) -> float:
    if not values:
        return 0.0
    return float(np.median(np.asarray(values, dtype=np.float64)))


def _robust_mad(values: Sequence[float], med: float) -> float:
    if len(values) < 2:
        return 0.0
    arr = np.asarray(values, dtype=np.float64)
    return float(np.median(np.abs(arr - med)))


def _compute_mental_fatigue(journal: Optional[JournalContextItem]) -> tuple[float, bool]:
    if journal is None:
        return 0.5, False
    parts: list[float] = []
    if journal.stress is not None and math.isfinite(journal.stress):
        parts.append(max(0.0, min(1.0, float(journal.stress) / 10.0)))
    if journal.sleepQuality is not None and math.isfinite(journal.sleepQuality):
        parts.append(max(0.0, min(1.0, (10.0 - float(journal.sleepQuality)) / 10.0)))
    if journal.focus is not None and math.isfinite(journal.focus):
        parts.append(max(0.0, min(1.0, (10.0 - float(journal.focus)) / 10.0)))
    if journal.energy is not None and math.isfinite(journal.energy):
        parts.append(max(0.0, min(1.0, (10.0 - float(journal.energy)) / 10.0)))
    if not parts:
        return 0.5, False
    return float(sum(parts) / len(parts)), True


def _trade_net_pnl(trade: ImportedTradeRecord) -> float:
    if trade.netPnl is not None and math.isfinite(float(trade.netPnl)):
        return float(trade.netPnl)
    return float(trade.profit) + float(trade.commission) + float(trade.swap)


def extract_causal_sequence(
    trades: Sequence[ImportedTradeRecord],
    account_type: str = "live",
    initial_balance: float = 0.0,
    balance: float = 0.0,
    daily_loss_limit: Optional[float] = None,
    max_drawdown: Optional[float] = None,
    journal_by_date: Optional[dict[str, JournalContextItem]] = None,
    compute_labels: bool = False,
) -> dict[str, Any]:
    """Build strictly causal sequence tensors for one account.

    CRITICAL ANTI-LEAKAGE INVARIANT:
    Step t features (X_t) NEVER inspect trade t's own profit, netPnl, mfe, mae,
    or post-trade notes (mistakes, followingPlan, entryDriver, riskComfort).
    Outcomes are read ONLY from strictly prior trades k < t that closed at or before openTime[t].
    """
    journal_map = journal_by_date or {}

    indexed_rows: list[tuple[float, float, str, ImportedTradeRecord]] = []
    for t in trades:
        open_ts = parse_timestamp_sec(t.openTime)
        close_ts = parse_timestamp_sec(t.closeTime) if t.closeTime is not None else open_ts
        if close_ts <= 0:
            close_ts = open_ts
        indexed_rows.append((open_ts, close_ts, str(t.id), t))

    indexed_rows.sort(key=lambda item: (item[0], item[1], item[2]))

    n = len(indexed_rows)
    cont = np.zeros((n, len(CONT_FEATURE_NAMES)), dtype=np.float32)
    cats = np.zeros((n, len(CAT_FEATURE_NAMES)), dtype=np.int64)
    targets = np.zeros((n, len(BEHAVIOR_CLASSES)), dtype=np.float32)
    weights = np.ones((n,), dtype=np.float32)
    is_clean = np.ones((n,), dtype=np.bool_)

    # Causal rolling state (only past entries k < t)
    prev_volumes: deque[float] = deque(maxlen=20)
    prev_has_sl: deque[float] = deque(maxlen=20)
    recent_open_times: deque[float] = deque()
    active_hours_seen: set[int] = set()
    session_counts: Counter[str] = Counter()
    symbol_counts: Counter[str] = Counter()
    strategy_counts: Counter[str] = Counter()
    ea_trades_prev = 0

    # Strictly realized closed-trade state (only trades with close_ts <= open_ts[t])
    pending_close_heap: list[tuple[float, int, float, str]] = []
    last_closed_ts: float = 0.0
    prev_closed_pnl: float = 0.0
    closed_pnls_abs: deque[float] = deque(maxlen=30)
    loss_streak = 0
    win_streak = 0
    cum_realized_pnl = 0.0
    peak_realized_pnl = 0.0
    daily_realized_pnl: dict[str, float] = {}
    daily_open_counts: Counter[str] = Counter()

    base_equity = float(initial_balance) if initial_balance > 0 else (float(balance) if balance > 0 else 1000.0)
    acc_type_idx = account_type_to_idx(account_type)
    is_prop_acc = str(account_type or "").lower() in {"prop_firm", "challenge", "funded"} or bool(
        (daily_loss_limit and daily_loss_limit > 0) or (max_drawdown and max_drawdown > 0)
    )

    step_meta: list[dict[str, Any]] = []

    for idx, (open_ts, close_ts, trade_id, t) in enumerate(indexed_rows):
        # 1. Drain all earlier trades whose close_time <= open_ts[idx]
        while pending_close_heap and pending_close_heap[0][0] <= open_ts:
            c_ts, _, c_pnl, c_day = heapq.heappop(pending_close_heap)
            last_closed_ts = max(last_closed_ts, c_ts)
            prev_closed_pnl = c_pnl
            closed_pnls_abs.append(abs(c_pnl))
            cum_realized_pnl += c_pnl
            if cum_realized_pnl > peak_realized_pnl:
                peak_realized_pnl = cum_realized_pnl
            daily_realized_pnl[c_day] = daily_realized_pnl.get(c_day, 0.0) + c_pnl
            if c_pnl > 0:
                win_streak += 1
                loss_streak = 0
            elif c_pnl < 0:
                loss_streak += 1
                win_streak = 0

        dt_utc = datetime.fromtimestamp(open_ts, tz=timezone.utc) if open_ts > 0 else datetime(2026, 1, 1, tzinfo=timezone.utc)
        day_str = dt_utc.strftime("%Y-%m-%d")
        hour_bucket = int(open_ts // 3600) if open_ts > 0 else 0
        journal = journal_map.get(day_str)

        # 2. Compute strictly causal entry-time features for step idx
        vol = max(0.0, float(t.volume))
        if prev_volumes:
            med_vol = max(1e-6, _robust_median(list(prev_volumes)))
            mad_vol = _robust_mad(list(prev_volumes), med_vol)
            vol_ratio = min(10.0, vol / med_vol)
            vol_scale = max(med_vol * 0.25, 1.4826 * mad_vol, 1e-4)
            vol_z = max(-10.0, min(10.0, (vol - med_vol) / vol_scale))
        else:
            vol_ratio = 1.0
            vol_z = 0.0

        # Time gap since last closed trade (or prior open if none closed yet)
        if last_closed_ts > 0 and open_ts >= last_closed_ts:
            dt_prev_sec = open_ts - last_closed_ts
            dt_log = min(1.5, math.log1p(dt_prev_sec) / 10.0)
        elif idx > 0 and open_ts >= indexed_rows[idx - 1][0]:
            dt_prev_sec = open_ts - indexed_rows[idx - 1][0]
            dt_log = min(1.5, math.log1p(dt_prev_sec) / 10.0)
        else:
            dt_prev_sec = 86400.0
            dt_log = 1.0

        while recent_open_times and open_ts - recent_open_times[0] > 3600.0:
            recent_open_times.popleft()
        trades_last_1h = len(recent_open_times)
        trades_today_before = daily_open_counts[day_str]

        mean_trades_per_active_hr = (idx / max(1, len(active_hours_seen))) if idx > 0 else 1.0
        cadence_burst = min(10.0, float(trades_last_1h) / max(1.0, mean_trades_per_active_hr))

        if closed_pnls_abs:
            pnl_scale = max(1e-4, _robust_median(list(closed_pnls_abs)), base_equity * 0.002)
            prev_pnl_norm = max(-10.0, min(10.0, prev_closed_pnl / pnl_scale))
        else:
            prev_pnl_norm = 0.0

        eff_equity = max(100.0, base_equity + cum_realized_pnl)
        daily_pnl_before = daily_realized_pnl.get(day_str, 0.0)
        daily_pnl_pct = max(-1.0, min(1.0, daily_pnl_before / eff_equity))
        dd_before_abs = max(0.0, peak_realized_pnl - cum_realized_pnl)
        dd_before_pct = min(1.0, dd_before_abs / eff_equity)

        if daily_loss_limit and daily_loss_limit > 0:
            prop_daily_util = min(2.0, max(0.0, -daily_pnl_before) / float(daily_loss_limit))
        else:
            prop_daily_util = 0.0
        if max_drawdown and max_drawdown > 0:
            prop_max_dd_util = min(2.0, dd_before_abs / float(max_drawdown))
        else:
            prop_max_dd_util = 0.0

        has_sl = 1.0 if (t.sl is not None and float(t.sl) > 0.0) else 0.0
        has_tp = 1.0 if (t.tp is not None and float(t.tp) > 0.0) else 0.0
        hist_sl_rate = (sum(prev_has_sl) / len(prev_has_sl)) if len(prev_has_sl) >= 5 else has_sl
        sl_drop = max(0.0, hist_sl_rate - has_sl)

        if has_sl > 0 and has_tp > 0 and t.openPrice > 0:
            risk_dist = abs(float(t.openPrice) - float(t.sl))
            reward_dist = abs(float(t.tp) - float(t.openPrice))
            planned_rr_norm = min(5.0, reward_dist / max(1e-6, risk_dist)) / 5.0
        else:
            planned_rr_norm = 0.0

        eff_session = normalize_session_label(t.session, open_ts)
        sym_token = normalize_symbol_token(t.symbol)
        eff_strategy = resolve_effective_strategy(
            t.setup,
            journal.strategyUsed if journal else None,
            int(t.magic or 0),
            t.comment,
        )

        # Familiarity check strictly against prior trades (k < idx)
        unfamiliar_session = idx >= 10 and (session_counts[eff_session] / max(1, idx)) < 0.10
        unfamiliar_symbol = idx >= 10 and (symbol_counts[sym_token] / max(1, idx)) < 0.08
        is_unfamiliar = 1.0 if (unfamiliar_session or unfamiliar_symbol) else 0.0

        tagged_prior = sum(cnt for strat, cnt in strategy_counts.items() if strat != "<UNTAGGED>")
        rare_or_untagged_strat = False
        if idx >= 10 and tagged_prior >= 5:
            if eff_strategy == "<UNTAGGED>" or (strategy_counts[eff_strategy] / max(1, idx)) < 0.08:
                rare_or_untagged_strat = True

        # Execution mode (Manual vs EA vs Manual override on EA-dominated account)
        magic_num = int(t.magic or 0)
        if magic_num > 0:
            exec_mode = "EA_BOT"
        elif idx >= 5 and (ea_trades_prev / max(1, idx)) >= 0.30:
            exec_mode = "MANUAL_ON_EA_ACCOUNT"
        elif is_deriv_trade(t.symbol, t.comment):
            exec_mode = "DERIV_CONTRACT"
        else:
            exec_mode = "MANUAL"

        mental_score, has_mental = _compute_mental_fatigue(journal)

        hour_angle = 2.0 * math.pi * ((dt_utc.hour + dt_utc.minute / 60.0) / 24.0)
        dow_angle = 2.0 * math.pi * (dt_utc.weekday() / 7.0)

        cont[idx] = np.asarray(
            [
                vol_ratio,
                vol_z,
                dt_log,
                min(4.0, trades_last_1h / 5.0),
                min(4.0, trades_today_before / 10.0),
                cadence_burst,
                prev_pnl_norm,
                min(2.0, loss_streak / 5.0),
                min(2.0, win_streak / 5.0),
                daily_pnl_pct,
                dd_before_pct,
                max(prop_daily_util, prop_max_dd_util),
                has_sl,
                has_tp,
                sl_drop,
                planned_rr_norm,
                is_unfamiliar,
                mental_score,
                math.sin(hour_angle),
                math.cos(hour_angle),
                math.sin(dow_angle),
                math.cos(dow_angle),
            ],
            dtype=np.float32,
        )

        cats[idx] = np.asarray(
            [
                session_to_idx(eff_session),
                symbol_to_idx(sym_token),
                strategy_to_idx(eff_strategy),
                acc_type_idx,
                EXEC_MODE_VOCAB.get(exec_mode, EXEC_MODE_VOCAB["MANUAL"]),
            ],
            dtype=np.int64,
        )

        step_meta.append(
            {
                "trade_id": trade_id,
                "ticket": t.ticket,
                "open_ts": open_ts,
                "day_str": day_str,
                "effective_session": eff_session,
                "symbol_token": sym_token,
                "effective_strategy": eff_strategy,
                "execution_mode": exec_mode,
                "volume_ratio": float(vol_ratio),
                "dt_prev_sec": float(dt_prev_sec),
                "trades_last_1h": int(trades_last_1h),
                "trades_today_before": int(trades_today_before),
                "cadence_burst": float(cadence_burst),
                "loss_streak_before": int(loss_streak),
                "win_streak_before": int(win_streak),
                "sl_drop": float(sl_drop),
                "has_sl": bool(has_sl > 0.5),
                "unfamiliar_session": bool(unfamiliar_session),
                "unfamiliar_symbol": bool(unfamiliar_symbol),
                "rare_or_untagged_strategy": bool(rare_or_untagged_strat),
                "prop_dd_util": float(max(prop_daily_util, prop_max_dd_util)),
                "dd_before_pct": float(dd_before_pct),
                "has_mental": bool(has_mental),
                "mental_score": float(mental_score),
            }
        )

        # 3. Optional target computation for training/evaluation ONLY (never fed into X_t)
        if compute_labels:
            y, w = compute_behavior_targets(
                trade=t,
                journal=journal,
                vol_ratio=vol_ratio,
                dt_prev_sec=dt_prev_sec,
                trades_last_1h=trades_last_1h,
                trades_today_before=trades_today_before,
                cadence_burst=cadence_burst,
                prev_pnl_norm=prev_pnl_norm,
                loss_streak=loss_streak,
                win_streak=win_streak,
                sl_drop=sl_drop,
                has_sl=has_sl,
                unfamiliar_session=unfamiliar_session,
                unfamiliar_symbol=unfamiliar_symbol,
                rare_or_untagged_strat=rare_or_untagged_strat,
                exec_mode=exec_mode,
                is_prop_acc=is_prop_acc,
                prop_util=max(prop_daily_util, prop_max_dd_util),
                dd_before_pct=dd_before_pct,
                prev_count=idx,
                mental_score=mental_score,
                has_mental=has_mental,
            )
            targets[idx] = y
            weights[idx] = w
            is_clean[idx] = bool(float(y.sum()) == 0.0)

        # 4. Update causal history state AFTER scoring step idx
        prev_volumes.append(vol)
        prev_has_sl.append(has_sl)
        recent_open_times.append(open_ts)
        active_hours_seen.add(hour_bucket)
        daily_open_counts[day_str] += 1
        session_counts[eff_session] += 1
        symbol_counts[sym_token] += 1
        strategy_counts[eff_strategy] += 1
        if magic_num > 0:
            ea_trades_prev += 1

        pnl = _trade_net_pnl(t)
        close_day = (
            datetime.fromtimestamp(close_ts, tz=timezone.utc).strftime("%Y-%m-%d")
            if close_ts > 0
            else day_str
        )
        heapq.heappush(pending_close_heap, (close_ts, idx, pnl, close_day))

    return {
        "cont": cont,
        "cats": cats,
        "targets": targets,
        "weights": weights,
        "is_clean": is_clean,
        "meta": step_meta,
    }


def compute_behavior_targets(
    *,
    trade: ImportedTradeRecord,
    journal: Optional[JournalContextItem],
    vol_ratio: float,
    dt_prev_sec: float,
    trades_last_1h: int,
    trades_today_before: int,
    cadence_burst: float,
    prev_pnl_norm: float,
    loss_streak: int,
    win_streak: int,
    sl_drop: float,
    has_sl: float,
    unfamiliar_session: bool,
    unfamiliar_symbol: bool,
    rare_or_untagged_strat: bool,
    exec_mode: str,
    is_prop_acc: bool,
    prop_util: float,
    dd_before_pct: float,
    prev_count: int,
    mental_score: float,
    has_mental: bool,
) -> tuple[np.ndarray, float]:
    """Semi-supervised gold (journal) + weak-supervision labels for training only."""
    y = np.zeros((len(BEHAVIOR_CLASSES),), dtype=np.float32)
    has_gold = False

    driver = str(trade.entryDriver or "").strip().lower()
    plan = str(trade.followingPlan or "").strip().lower()
    comfort = str(trade.riskComfort or "").strip().lower()
    mood_txt = " ".join(
        filter(None, [str(trade.mood or ""), str(journal.emotionalState if journal else "")])
    ).strip().lower()
    mistakes_txt = str(trade.mistakes or "").strip().lower()
    rules_broken = str(journal.rulesBroken if journal else "").strip().lower()

    if driver:
        has_gold = True
        if any(k in driver for k in ("vingan", "revenge")):
            y[0] = 1.0
        if any(k in driver for k in ("fomo", "impuls")):
            y[1] = 1.0
            if loss_streak >= 1:
                y[0] = 1.0

    if comfort in {"não", "nao", "no"}:
        has_gold = True
        y[2] = 1.0

    if plan in {"não", "nao", "no"} or (
        rules_broken and rules_broken not in {"none", "nenhum", "nenhuma", "n/a", "-"}
    ):
        has_gold = True
        y[4] = 1.0

    if mistakes_txt and mistakes_txt not in {"none", "nenhum", "nenhuma", "n/a", "-", "0"}:
        has_gold = True
        if any(k in mistakes_txt for k in ("revenge", "vingan")):
            y[0] = 1.0
        if any(k in mistakes_txt for k in ("overtrad", "fomo", "impuls")):
            y[1] = 1.0
        if any(k in mistakes_txt for k in ("lot", "size", "stop", "sl", "risco", "risk")):
            y[2] = 1.0

    if mood_txt:
        has_gold = True
        if any(k in mood_txt for k in ("frustrat", "frustrad", "tilt", "angry", "raiva", "anxious", "ansios")):
            if loss_streak >= 1:
                y[0] = 1.0
                y[2] = 1.0
        if any(k in mood_txt for k in ("eufor", "euphor", "overconfid", "gananc", "greed")):
            y[3] = 1.0

    # Weak supervision rules
    if (
        (loss_streak >= 1 and dt_prev_sec <= 900.0 and vol_ratio >= 1.35)
        or (loss_streak >= 2 and dt_prev_sec <= 1800.0 and (vol_ratio >= 1.20 or sl_drop >= 0.5))
        or (prev_pnl_norm <= -1.2 and dt_prev_sec <= 600.0 and vol_ratio >= 1.25)
    ):
        y[0] = 1.0

    if (
        trades_last_1h >= 4
        or trades_today_before >= 12
        or (prev_count >= 10 and cadence_burst >= 3.0 and dt_prev_sec <= 300.0)
        or (has_mental and mental_score >= 0.75 and trades_last_1h >= 3)
    ):
        y[1] = 1.0

    if (
        (loss_streak >= 2 and vol_ratio >= 1.75)
        or (loss_streak >= 1 and sl_drop >= 0.7 and vol_ratio >= 1.30)
        or (dd_before_pct >= 0.04 and vol_ratio >= 1.90)
    ):
        y[2] = 1.0

    if (win_streak >= 3 and vol_ratio >= 1.50) or (win_streak >= 4 and sl_drop >= 0.7):
        y[3] = 1.0

    if (
        exec_mode == "MANUAL_ON_EA_ACCOUNT"
        or (prev_count >= 12 and (unfamiliar_session or unfamiliar_symbol) and (loss_streak >= 1 or vol_ratio >= 1.25))
        or (prev_count >= 12 and rare_or_untagged_strat and loss_streak >= 1)
    ):
        y[4] = 1.0

    if is_prop_acc and prop_util >= 0.60 and (vol_ratio >= 1.15 or trades_last_1h >= 3 or has_sl < 0.5):
        y[5] = 1.0

    # Gold human-in-the-loop feedback override (evaluated strictly for target labels, never X_t)
    verdict = trade.feedbackVerdict
    if verdict in {"CONFIRM", "FALSE_POSITIVE"}:
        valid_flags = [
            BEHAVIOR_CLASSES.index(flag)
            for flag in (trade.feedbackFlags or [])
            if flag in BEHAVIOR_CLASSES
        ]
        if verdict == "FALSE_POSITIVE":
            y[:] = 0.0
            for c_idx in valid_flags:
                y[c_idx] = 1.0
        else:
            for c_idx in valid_flags:
                y[c_idx] = 1.0
        return y, LABEL_WEIGHT_FEEDBACK

    weight = LABEL_WEIGHT_JOURNAL if has_gold else LABEL_WEIGHT_WEAK
    return y, weight
