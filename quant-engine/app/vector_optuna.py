from __future__ import annotations

import math
import threading
import time
from typing import Any

from numba import njit
import numpy as np
import optuna
import pandas as pd
import polars as pl
import vectorbt as vbt

from .analytics_qs import generate_quantstats_tearsheet
from .contracts import (
    HeatmapCell,
    OptunaOptimizeRequest,
    OptunaOptimizeResponse,
    OptunaTrialSummary,
    RealisticVerificationSummary,
    StrategyFamily,
    VectorSweepConfigRow,
    VectorSweepRequest,
    VectorSweepResponse,
    WalkForwardSplitMetrics,
)
from .ohlcv_polars import load_ohlcv_with_source, load_resampled_ohlcv_polars, normalize_timeframe
from .realistic_sim import build_session_entry_mask, run_realistic_bar_simulation

_VBT_LOCK = threading.Lock()
_VBT_WARMED = False

_VBT_FREQ_MAP: dict[str, str] = {
    "1m": "1min",
    "3m": "3min",
    "5m": "5min",
    "15m": "15min",
    "30m": "30min",
    "1h": "1h",
    "2h": "2h",
    "4h": "4h",
    "1d": "1D",
    "1w": "7D",
}

_STRATEGY_CODE_MAP: dict[StrategyFamily, int] = {
    "SMC_DONCHIAN_ATR": 0,
    "EMA_CROSS_RSI": 1,
    "BOLLINGER_MEAN_REV": 2,
}


@njit(cache=True)
def _generate_signal_matrices_multi_rsi_numba(
    close: np.ndarray,
    high: np.ndarray,
    low: np.ndarray,
    atr: np.ndarray,
    rsi: np.ndarray,
    bb_upper: np.ndarray,
    bb_lower: np.ndarray,
    sma_20: np.ndarray,
    ema_fast_mat: np.ndarray,
    ema_slow_mat: np.ndarray,
    don_hi_prev_mat: np.ndarray,
    don_lo_prev_mat: np.ndarray,
    sl_mults: np.ndarray,
    rr_targets: np.ndarray,
    rsi_thresholds: np.ndarray,
    strategy_code: int,
    allowed_entry_mask: np.ndarray,
) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    """Compiled Numba kernel generating non-overlapping Long/Short signals with per-combo RSI thresholds."""
    n_bars, n_combos = ema_fast_mat.shape
    long_entries = np.zeros((n_bars, n_combos), dtype=np.bool_)
    long_exits = np.zeros((n_bars, n_combos), dtype=np.bool_)
    short_entries = np.zeros((n_bars, n_combos), dtype=np.bool_)
    short_exits = np.zeros((n_bars, n_combos), dtype=np.bool_)
    filtered_counts = np.zeros(n_combos, dtype=np.int64)

    start_bar = min(25, max(2, n_bars // 10))

    for j in range(n_combos):
        pos = 0
        sl_px = 0.0
        tp_px = 0.0
        sl_m = sl_mults[j]
        rr_t = rr_targets[j]
        rsi_thresh = rsi_thresholds[j]
        rsi_low = 100.0 - rsi_thresh

        for t in range(start_bar, n_bars):
            c = close[t]
            h = high[t]
            l = low[t]
            ef = ema_fast_mat[t, j]
            es = ema_slow_mat[t, j]
            ef_prev = ema_fast_mat[t - 1, j]
            es_prev = ema_slow_mat[t - 1, j]
            r = rsi[t]
            cur_atr = atr[t]
            if cur_atr <= 1e-9:
                cur_atr = c * 0.002

            if pos == 1:
                hit_sl = l <= sl_px
                hit_tp = h >= tp_px
                rev_exit = False
                if strategy_code == 1:
                    rev_exit = ef < es
                elif strategy_code == 2:
                    rev_exit = c >= sma_20[t]
                if hit_sl or hit_tp or rev_exit:
                    long_exits[t, j] = True
                    pos = 0
                continue

            if pos == -1:
                hit_sl = h >= sl_px
                hit_tp = l <= tp_px
                rev_exit = False
                if strategy_code == 1:
                    rev_exit = ef > es
                elif strategy_code == 2:
                    rev_exit = c <= sma_20[t]
                if hit_sl or hit_tp or rev_exit:
                    short_exits[t, j] = True
                    pos = 0
                continue

            go_long = False
            go_short = False
            if strategy_code == 0:
                go_long = c > don_hi_prev_mat[t, j] and ef > es and r >= (rsi_thresh - 4.0)
                go_short = c < don_lo_prev_mat[t, j] and ef < es and r <= (rsi_low + 4.0)
            elif strategy_code == 1:
                go_long = ef_prev <= es_prev and ef > es and r >= rsi_thresh
                go_short = ef_prev >= es_prev and ef < es and r <= rsi_low
            else:
                go_long = close[t - 1] < bb_lower[t - 1] and c >= bb_lower[t] and r <= 48.0
                go_short = close[t - 1] > bb_upper[t - 1] and c <= bb_upper[t] and r >= 52.0

            if go_long and not go_short:
                if not allowed_entry_mask[t]:
                    filtered_counts[j] += 1
                    continue
                long_entries[t, j] = True
                pos = 1
                sl_dist = max(cur_atr * sl_m, c * 0.0005)
                sl_px = c - sl_dist
                tp_px = c + sl_dist * rr_t
            elif go_short and not go_long:
                if not allowed_entry_mask[t]:
                    filtered_counts[j] += 1
                    continue
                short_entries[t, j] = True
                pos = -1
                sl_dist = max(cur_atr * sl_m, c * 0.0005)
                sl_px = c + sl_dist
                tp_px = c - sl_dist * rr_t

    return long_entries, long_exits, short_entries, short_exits, filtered_counts


@njit(cache=True)
def _generate_signal_matrices_numba(
    close: np.ndarray,
    high: np.ndarray,
    low: np.ndarray,
    atr: np.ndarray,
    rsi: np.ndarray,
    bb_upper: np.ndarray,
    bb_lower: np.ndarray,
    sma_20: np.ndarray,
    ema_fast_mat: np.ndarray,
    ema_slow_mat: np.ndarray,
    don_hi_prev_mat: np.ndarray,
    don_lo_prev_mat: np.ndarray,
    sl_mults: np.ndarray,
    rr_targets: np.ndarray,
    rsi_thresh: float,
    strategy_code: int,
    allowed_entry_mask: np.ndarray,
) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    """Compiled Numba kernel generating non-overlapping Long/Short signals with ATR SL/TP exits and session mask."""
    rsi_arr = np.full(ema_fast_mat.shape[1], rsi_thresh, dtype=np.float64)
    return _generate_signal_matrices_multi_rsi_numba(
        close,
        high,
        low,
        atr,
        rsi,
        bb_upper,
        bb_lower,
        sma_20,
        ema_fast_mat,
        ema_slow_mat,
        don_hi_prev_mat,
        don_lo_prev_mat,
        sl_mults,
        rr_targets,
        rsi_arr,
        strategy_code,
        allowed_entry_mask,
    )


@njit(cache=True)
def _evaluate_signals_batch_numba(
    close: np.ndarray,
    le: np.ndarray,
    lx: np.ndarray,
    se: np.ndarray,
    sx: np.ndarray,
    size_fractions: np.ndarray,
    initial_capital: float,
    friction_rate: float,
    bars_per_year: float,
) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray, np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    """Evaluates compound bar-by-bar metrics directly across signal columns in Numba."""
    n_bars, n_combos = le.shape
    trades_arr = np.zeros(n_combos, dtype=np.float64)
    tot_ret_arr = np.zeros(n_combos, dtype=np.float64)
    max_dd_arr = np.zeros(n_combos, dtype=np.float64)
    sharpe_arr = np.zeros(n_combos, dtype=np.float64)
    sortino_arr = np.zeros(n_combos, dtype=np.float64)
    calmar_arr = np.zeros(n_combos, dtype=np.float64)
    win_rate_arr = np.zeros(n_combos, dtype=np.float64)
    pf_arr = np.zeros(n_combos, dtype=np.float64)

    ann_factor = math.sqrt(max(1.0, bars_per_year))

    for j in range(n_combos):
        cash = initial_capital
        peak_eq = initial_capital
        prev_eq = initial_capital
        max_dd = 0.0
        pos = 0
        entry_px = 0.0
        alloc = 0.0
        sf = min(1.0, max(0.05, size_fractions[j]))

        trades = 0
        wins = 0
        gross_win = 0.0
        gross_loss = 0.0
        sum_r = 0.0
        sum_r2 = 0.0
        sum_down2 = 0.0

        for t in range(n_bars):
            c = close[t]
            if pos == 1 and lx[t, j]:
                raw_r = ((c - entry_px) / max(entry_px, 1e-9)) - 2.0 * friction_rate
                pnl = alloc * raw_r
                cash = max(1.0, cash + pnl)
                trades += 1
                if pnl > 0.0:
                    wins += 1
                    gross_win += pnl
                else:
                    gross_loss += abs(pnl)
                pos = 0
                alloc = 0.0
            elif pos == -1 and sx[t, j]:
                raw_r = ((entry_px - c) / max(entry_px, 1e-9)) - 2.0 * friction_rate
                pnl = alloc * raw_r
                cash = max(1.0, cash + pnl)
                trades += 1
                if pnl > 0.0:
                    wins += 1
                    gross_win += pnl
                else:
                    gross_loss += abs(pnl)
                pos = 0
                alloc = 0.0

            if pos == 0:
                if le[t, j]:
                    pos = 1
                    entry_px = c
                    alloc = cash * sf
                elif se[t, j]:
                    pos = -1
                    entry_px = c
                    alloc = cash * sf

            if pos == 1:
                cur_eq = max(1.0, cash + alloc * (((c - entry_px) / max(entry_px, 1e-9)) - friction_rate))
            elif pos == -1:
                cur_eq = max(1.0, cash + alloc * (((entry_px - c) / max(entry_px, 1e-9)) - friction_rate))
            else:
                cur_eq = cash

            bar_r = (cur_eq - prev_eq) / max(prev_eq, 1.0)
            prev_eq = cur_eq
            sum_r += bar_r
            sum_r2 += bar_r * bar_r
            if bar_r < 0.0:
                sum_down2 += bar_r * bar_r

            if cur_eq > peak_eq:
                peak_eq = cur_eq
            else:
                dd = ((peak_eq - cur_eq) / max(peak_eq, 1.0)) * 100.0
                if dd > max_dd:
                    max_dd = dd

        ret_pct = ((prev_eq - initial_capital) / max(initial_capital, 1.0)) * 100.0
        mean_r = sum_r / max(1, n_bars)
        var_r = max(0.0, (sum_r2 / max(1, n_bars)) - (mean_r * mean_r))
        std_r = math.sqrt(var_r)
        down_std = math.sqrt(sum_down2 / max(1, n_bars))

        sh = (mean_r / std_r) * ann_factor if std_r > 1e-12 else 0.0
        so = (mean_r / down_std) * ann_factor if down_std > 1e-12 else 0.0
        sh = min(15.0, max(-15.0, sh))
        so = min(25.0, max(-25.0, so))
        wr = (wins / trades) * 100.0 if trades > 0 else 0.0
        pf_v = (gross_win / gross_loss) if gross_loss > 1e-9 else (10.0 if gross_win > 0.0 else 0.0)
        pf_v = min(20.0, max(0.0, pf_v))
        calmar = min(25.0, max(-25.0, ret_pct / max_dd)) if max_dd > 0.1 else (2.5 if ret_pct > 0.0 else 0.0)

        trades_arr[j] = float(trades)
        tot_ret_arr[j] = ret_pct
        max_dd_arr[j] = min(100.0, max(0.0, max_dd))
        sharpe_arr[j] = sh
        sortino_arr[j] = so
        calmar_arr[j] = calmar
        win_rate_arr[j] = wr
        pf_arr[j] = pf_v

    return trades_arr, tot_ret_arr, max_dd_arr, sharpe_arr, sortino_arr, calmar_arr, win_rate_arr, pf_arr


def _safe_num(val: Any, default: float = 0.0, cap: float = 99.9) -> float:
    try:
        f = float(val)
        if not math.isfinite(f):
            return default
        return max(-cap, min(cap, f))
    except (TypeError, ValueError):
        return default


def _series_to_array(res: Any, n_cols: int, default: float = 0.0) -> np.ndarray:
    if isinstance(res, (int, float, np.number)):
        return np.full(n_cols, float(res), dtype=np.float64)
    arr = np.asarray(res, dtype=np.float64).reshape(-1)
    if len(arr) != n_cols:
        out = np.full(n_cols, default, dtype=np.float64)
        k = min(n_cols, len(arr))
        out[:k] = arr[:k]
        return out
    return arr


def _prepare_indicator_cache(
    df: pl.DataFrame,
    fast_periods: list[int],
    slow_periods: list[int],
) -> tuple[dict[str, np.ndarray], dict[int, np.ndarray], dict[int, np.ndarray], dict[int, np.ndarray]]:
    """Computes shared OHLCV + technical indicator columns using Polars vectorized expressions."""
    prev_close = pl.col("close").shift(1).fill_null(pl.col("open"))
    tr = pl.max_horizontal(
        pl.col("high") - pl.col("low"),
        (pl.col("high") - prev_close).abs(),
        (pl.col("low") - prev_close).abs(),
    )
    delta = pl.col("close").diff().fill_null(0.0)
    gain = pl.when(delta > 0).then(delta).otherwise(0.0)
    loss = pl.when(delta < 0).then(-delta).otherwise(0.0)

    unique_emas = sorted(set([*fast_periods, *slow_periods]))
    unique_fast = sorted(set(fast_periods))

    exprs: list[pl.Expr] = [
        tr.rolling_mean(window_size=14, min_samples=1).alias("atr"),
        pl.col("close").rolling_mean(window_size=20, min_samples=1).alias("sma_20"),
        pl.col("close").rolling_std(window_size=20, min_samples=1).fill_null(0.0).alias("std_20"),
        gain.ewm_mean(alpha=1.0 / 14.0, adjust=False).alias("_avg_gain"),
        loss.ewm_mean(alpha=1.0 / 14.0, adjust=False).alias("_avg_loss"),
    ]
    for p in unique_emas:
        exprs.append(pl.col("close").ewm_mean(span=max(2, p), adjust=False).alias(f"ema_{p}"))
    for f in unique_fast:
        exprs.append(
            pl.col("high").rolling_max(window_size=max(2, f), min_samples=1).shift(1).fill_null(pl.col("high")).alias(f"don_hi_{f}")
        )
        exprs.append(
            pl.col("low").rolling_min(window_size=max(2, f), min_samples=1).shift(1).fill_null(pl.col("low")).alias(f"don_lo_{f}")
        )

    enriched = (
        df.with_columns(exprs)
        .with_columns(
            [
                (pl.col("sma_20") + 2.0 * pl.col("std_20")).alias("bb_upper"),
                (pl.col("sma_20") - 2.0 * pl.col("std_20")).alias("bb_lower"),
                pl.when(pl.col("_avg_loss") <= 1e-12)
                .then(100.0)
                .otherwise(100.0 - (100.0 / (1.0 + (pl.col("_avg_gain") / pl.col("_avg_loss")))))
                .alias("rsi"),
            ]
        )
    )

    base: dict[str, np.ndarray] = {
        "timestamp": enriched["timestamp"].to_numpy(),
        "close": enriched["close"].to_numpy().astype(np.float64),
        "high": enriched["high"].to_numpy().astype(np.float64),
        "low": enriched["low"].to_numpy().astype(np.float64),
        "atr": enriched["atr"].to_numpy().astype(np.float64),
        "rsi": enriched["rsi"].to_numpy().astype(np.float64),
        "sma_20": enriched["sma_20"].to_numpy().astype(np.float64),
        "bb_upper": enriched["bb_upper"].to_numpy().astype(np.float64),
        "bb_lower": enriched["bb_lower"].to_numpy().astype(np.float64),
    }
    ema_map = {p: enriched[f"ema_{p}"].to_numpy().astype(np.float64) for p in unique_emas}
    don_hi_map = {f: enriched[f"don_hi_{f}"].to_numpy().astype(np.float64) for f in unique_fast}
    don_lo_map = {f: enriched[f"don_lo_{f}"].to_numpy().astype(np.float64) for f in unique_fast}
    return base, ema_map, don_hi_map, don_lo_map


def _run_vbt_batch_with_diag(
    *,
    base: dict[str, np.ndarray],
    ema_map: dict[int, np.ndarray],
    don_hi_map: dict[int, np.ndarray],
    don_lo_map: dict[int, np.ndarray],
    combos: list[tuple[int, int, float, float]],
    rsi_thresh: float,
    strategy_family: StrategyFamily,
    timeframe: str,
    initial_capital: float,
    fees: float,
    slippage: float,
    size_fraction: float = 0.25,
    allowed_entry_mask: np.ndarray | None = None,
    slippage_bps: float = 0.0,
    rsi_thresholds: np.ndarray | None = None,
    size_fractions: np.ndarray | None = None,
) -> tuple[vbt.Portfolio, pd.DataFrame, np.ndarray]:
    n_bars = len(base["close"])
    n_combos = len(combos)

    ema_fast_mat = np.empty((n_bars, n_combos), dtype=np.float64)
    ema_slow_mat = np.empty((n_bars, n_combos), dtype=np.float64)
    don_hi_mat = np.empty((n_bars, n_combos), dtype=np.float64)
    don_lo_mat = np.empty((n_bars, n_combos), dtype=np.float64)
    sl_mults = np.empty(n_combos, dtype=np.float64)
    rr_targets = np.empty(n_combos, dtype=np.float64)

    for j, (fast_p, slow_p, sl_m, rr_t) in enumerate(combos):
        ema_fast_mat[:, j] = ema_map[fast_p]
        ema_slow_mat[:, j] = ema_map[slow_p]
        don_hi_mat[:, j] = don_hi_map[fast_p]
        don_lo_mat[:, j] = don_lo_map[fast_p]
        sl_mults[j] = sl_m
        rr_targets[j] = rr_t

    entry_mask = (
        allowed_entry_mask.astype(np.bool_)
        if allowed_entry_mask is not None
        else np.ones(n_bars, dtype=np.bool_)
    )
    strat_code = _STRATEGY_CODE_MAP[strategy_family]

    if rsi_thresholds is not None:
        rsi_arr = np.asarray(rsi_thresholds, dtype=np.float64)
        le, lx, se, sx, filtered_counts = _generate_signal_matrices_multi_rsi_numba(
            base["close"],
            base["high"],
            base["low"],
            base["atr"],
            base["rsi"],
            base["bb_upper"],
            base["bb_lower"],
            base["sma_20"],
            ema_fast_mat,
            ema_slow_mat,
            don_hi_mat,
            don_lo_mat,
            sl_mults,
            rr_targets,
            rsi_arr,
            strat_code,
            entry_mask,
        )
    else:
        le, lx, se, sx, filtered_counts = _generate_signal_matrices_numba(
            base["close"],
            base["high"],
            base["low"],
            base["atr"],
            base["rsi"],
            base["bb_upper"],
            base["bb_lower"],
            base["sma_20"],
            ema_fast_mat,
            ema_slow_mat,
            don_hi_mat,
            don_lo_mat,
            sl_mults,
            rr_targets,
            float(rsi_thresh),
            strat_code,
            entry_mask,
        )

    norm_tf, _ = normalize_timeframe(timeframe)
    vbt_freq = _VBT_FREQ_MAP.get(norm_tf, "15min")
    dt_index = pd.to_datetime(base["timestamp"], unit="ms", utc=True)
    cols = [f"c{j}" for j in range(n_combos)]

    close_df = pd.DataFrame(np.repeat(base["close"][:, None], n_combos, axis=1), index=dt_index, columns=cols)
    le_df = pd.DataFrame(le, index=dt_index, columns=cols)
    lx_df = pd.DataFrame(lx, index=dt_index, columns=cols)
    se_df = pd.DataFrame(se, index=dt_index, columns=cols)
    sx_df = pd.DataFrame(sx, index=dt_index, columns=cols)
    slippage_eff = max(0.0, float(slippage) + float(slippage_bps) / 10_000.0)
    if size_fractions is not None:
        clipped_sizes = np.clip(np.asarray(size_fractions, dtype=np.float64), 0.05, 1.0)
        size_arg: Any = np.broadcast_to(clipped_sizes, (n_bars, n_combos))
    else:
        size_arg = max(0.05, min(1.0, float(size_fraction)))

    with _VBT_LOCK:
        pf = vbt.Portfolio.from_signals(
            close_df,
            entries=le_df,
            exits=lx_df,
            short_entries=se_df,
            short_exits=sx_df,
            init_cash=float(initial_capital),
            size=size_arg,
            size_type="percent",
            fees=float(fees),
            slippage=slippage_eff,
            freq=vbt_freq,
        )

    return pf, close_df, filtered_counts


def _run_vbt_batch(
    *,
    base: dict[str, np.ndarray],
    ema_map: dict[int, np.ndarray],
    don_hi_map: dict[int, np.ndarray],
    don_lo_map: dict[int, np.ndarray],
    combos: list[tuple[int, int, float, float]],
    rsi_thresh: float,
    strategy_family: StrategyFamily,
    timeframe: str,
    initial_capital: float,
    fees: float,
    slippage: float,
    size_fraction: float = 0.25,
    allowed_entry_mask: np.ndarray | None = None,
    slippage_bps: float = 0.0,
    rsi_thresholds: np.ndarray | None = None,
    size_fractions: np.ndarray | None = None,
) -> tuple[vbt.Portfolio, pd.DataFrame]:
    pf, close_df, _ = _run_vbt_batch_with_diag(
        base=base,
        ema_map=ema_map,
        don_hi_map=don_hi_map,
        don_lo_map=don_lo_map,
        combos=combos,
        rsi_thresh=rsi_thresh,
        strategy_family=strategy_family,
        timeframe=timeframe,
        initial_capital=initial_capital,
        fees=fees,
        slippage=slippage,
        size_fraction=size_fraction,
        allowed_entry_mask=allowed_entry_mask,
        slippage_bps=slippage_bps,
        rsi_thresholds=rsi_thresholds,
        size_fractions=size_fractions,
    )
    return pf, close_df


def warmup_vectorbt() -> None:
    """Warms up Numba JIT caches once at startup so API requests stay fast."""
    global _VBT_WARMED
    if _VBT_WARMED:
        return
    try:
        n = 32
        nc = 2
        ones = np.full(n, 100.0, dtype=np.float64)
        mat = np.column_stack([ones, ones * 1.01])
        mask = np.ones(n, dtype=np.bool_)
        sl = np.full(nc, 1.5, dtype=np.float64)
        rr = np.full(nc, 2.0, dtype=np.float64)
        rsi_arr = np.full(nc, 52.0, dtype=np.float64)
        _generate_signal_matrices_numba(
            ones, ones + 1.0, ones - 1.0, np.full(n, 0.5), np.full(n, 50.0),
            ones + 2.0, ones - 2.0, ones, mat, mat * 0.99, mat + 1.0, mat - 1.0,
            sl, rr, 52.0, 0, mask,
        )
        le, lx, se, sx, _ = _generate_signal_matrices_multi_rsi_numba(
            ones, ones + 1.0, ones - 1.0, np.full(n, 0.5), np.full(n, 50.0),
            ones + 2.0, ones - 2.0, ones, mat, mat * 0.99, mat + 1.0, mat - 1.0,
            sl, rr, rsi_arr, 0, mask,
        )
        _evaluate_signals_batch_numba(
            ones, le, lx, se, sx, np.full(nc, 0.2, dtype=np.float64), 100_000.0, 0.0002, 252.0
        )

        idx = pd.date_range("2026-01-01", periods=64, freq="15min", tz="UTC")
        arr = np.linspace(100.0, 105.0, 64)
        close_df = pd.DataFrame({"c0": arr, "c1": arr * 1.01}, index=idx)
        e_df = pd.DataFrame({"c0": np.arange(64) % 10 == 1, "c1": np.arange(64) % 12 == 1}, index=idx)
        x_df = pd.DataFrame({"c0": np.arange(64) % 10 == 6, "c1": np.arange(64) % 12 == 7}, index=idx)
        with _VBT_LOCK:
            for cols in (["c0", "c1"], ["c0"]):
                pf = vbt.Portfolio.from_signals(
                    close_df[cols],
                    entries=e_df[cols],
                    exits=x_df[cols],
                    short_entries=x_df[cols],
                    short_exits=e_df[cols],
                    init_cash=100_000.0,
                    size=0.2,
                    size_type="percent",
                    fees=0.0001,
                    slippage=0.0001,
                    freq="15min",
                )
                _ = pf.total_return()
                _ = pf.sharpe_ratio()
                _ = pf.sortino_ratio()
                _ = pf.max_drawdown()
                _ = pf.value()
                _ = pf.drawdown()
                _ = pf.trades.count()
                _ = pf.trades.win_rate()
                _ = pf.trades.profit_factor()
        _VBT_WARMED = True
    except Exception:
        pass


def _extract_portfolio_metrics(pf: vbt.Portfolio, n_cols: int, initial_capital: float) -> list[dict[str, float]]:
    tot_ret = _series_to_array(pf.total_return(), n_cols, 0.0) * 100.0
    sharpe = _series_to_array(pf.sharpe_ratio(), n_cols, 0.0)
    sortino = _series_to_array(pf.sortino_ratio(), n_cols, 0.0)
    max_dd = np.abs(_series_to_array(pf.max_drawdown(), n_cols, 0.0)) * 100.0
    trades_cnt = _series_to_array(pf.trades.count(), n_cols, 0.0)
    win_rate = _series_to_array(pf.trades.win_rate(), n_cols, 0.0) * 100.0
    profit_factor = _series_to_array(pf.trades.profit_factor(), n_cols, 0.0)

    out: list[dict[str, float]] = []
    for j in range(n_cols):
        tr = int(max(0, round(_safe_num(trades_cnt[j], 0.0, 1e6))))
        ret_pct = _safe_num(tot_ret[j], 0.0, 5000.0)
        dd_pct = max(0.0, _safe_num(max_dd[j], 0.0, 100.0))
        sh = _safe_num(sharpe[j], 0.0, 15.0)
        so = _safe_num(sortino[j], 0.0, 25.0)
        wr = _safe_num(win_rate[j], 0.0, 100.0) if tr > 0 else 0.0
        pf_val = _safe_num(profit_factor[j], 0.0, 20.0) if tr > 0 else 0.0
        calmar = _safe_num(ret_pct / dd_pct, 0.0, 25.0) if dd_pct > 0.1 else (2.5 if ret_pct > 0 else 0.0)
        net_usd = round(initial_capital * (ret_pct / 100.0), 2)
        out.append(
            {
                "trades": float(tr),
                "totalReturnPct": round(ret_pct, 2),
                "netProfitUsd": net_usd,
                "maxDrawdownPct": round(dd_pct, 2),
                "sharpeRatio": round(sh, 2),
                "sortinoRatio": round(so, 2),
                "calmarRatio": round(calmar, 2),
                "winRatePct": round(wr, 1),
                "profitFactor": round(pf_val, 2),
            }
        )
    return out


def _composite_score(m: dict[str, float]) -> float:
    if m["trades"] < 5:
        return -10.0 + m["trades"] * 0.2
    dd_penalty = max(0.0, m["maxDrawdownPct"] - 12.0) * 0.18
    return round(
        m["sharpeRatio"] * 1.4 + min(3.0, m["profitFactor"]) * 0.65 + (m["totalReturnPct"] * 0.08) - dd_penalty,
        4,
    )


def run_vector_sweep(req: VectorSweepRequest) -> VectorSweepResponse:
    """Runs high-speed VectorBT grid backtest across thousands of combinations using Polars OHLCV."""
    t0 = time.perf_counter()
    norm_tf, _ = normalize_timeframe(req.timeframe)
    df, data_source_used, is_real_data = load_ohlcv_with_source(
        req.symbol,
        norm_tf,
        limit=req.barsCount,
        data_mode=req.dataMode,
        auto_sync_if_missing=(req.dataMode == "REAL"),
    )

    fast_vals = sorted(set(max(2, int(x)) for x in req.fastValues))
    slow_vals = sorted(set(max(5, int(x)) for x in req.slowValues))
    rr_vals = [float(x) for x in req.rrValues] or [2.0]
    sl_vals = [float(x) for x in req.slAtrValues] or [1.5]

    combos: list[tuple[int, int, float, float]] = []
    for f in fast_vals:
        for s in slow_vals:
            if f >= s:
                continue
            for sl_m in sl_vals:
                for rr_t in rr_vals:
                    combos.append((f, s, sl_m, rr_t))

    if not combos:
        combos = [(12, 34, 1.5, 2.0)]

    # Keep response interactive and memory bounded if massive grid submitted
    if len(combos) > 1500:
        combos = combos[:1500]

    base, ema_map, don_hi_map, don_lo_map = _prepare_indicator_cache(
        df,
        [c[0] for c in combos],
        [c[1] for c in combos],
    )
    entry_mask = build_session_entry_mask(
        base["timestamp"],
        session_filter=req.sessionFilter,
        avoid_friday_late=req.avoidFridayLate,
    )
    risk_alloc = max(0.05, min(0.90, req.riskPct * 0.2))
    pf, _, filtered_counts = _run_vbt_batch_with_diag(
        base=base,
        ema_map=ema_map,
        don_hi_map=don_hi_map,
        don_lo_map=don_lo_map,
        combos=combos,
        rsi_thresh=req.rsiThreshold,
        strategy_family=req.strategyFamily,
        timeframe=norm_tf,
        initial_capital=req.initialCapital,
        fees=req.commissionPct,
        slippage=req.spreadPct,
        size_fraction=risk_alloc,
        allowed_entry_mask=entry_mask,
        slippage_bps=req.slippageBps,
    )
    metrics_list = _extract_portfolio_metrics(pf, len(combos), req.initialCapital)

    scored_rows: list[tuple[float, int, tuple[int, int, float, float], dict[str, float]]] = []
    heatmap_acc: dict[tuple[int, int], list[dict[str, float]]] = {}

    for idx_c, (combo, m) in enumerate(zip(combos, metrics_list)):
        sc = _composite_score(m)
        scored_rows.append((sc, idx_c, combo, m))
        heatmap_acc.setdefault((combo[0], combo[1]), []).append(m)

    scored_rows.sort(key=lambda x: x[0], reverse=True)
    top_configs: list[VectorSweepConfigRow] = []
    for rank_idx, (sc, _idx_c, combo, m) in enumerate(scored_rows[: req.topK], start=1):
        top_configs.append(
            VectorSweepConfigRow(
                rank=rank_idx,
                fastPeriod=combo[0],
                slowPeriod=combo[1],
                slAtrMult=combo[2],
                rrTarget=combo[3],
                totalTrades=int(m["trades"]),
                winRatePct=m["winRatePct"],
                profitFactor=m["profitFactor"],
                sharpeRatio=m["sharpeRatio"],
                sortinoRatio=m["sortinoRatio"],
                totalReturnPct=m["totalReturnPct"],
                netProfitUsd=m["netProfitUsd"],
                maxDrawdownPct=m["maxDrawdownPct"],
                score=round(sc, 3),
            )
        )

    heatmap_cells: list[HeatmapCell] = []
    for (f, s), items in sorted(heatmap_acc.items()):
        best_item = max(items, key=lambda x: x["sharpeRatio"])
        heatmap_cells.append(
            HeatmapCell(
                xLabel=f"Fast {f}",
                yLabel=f"Slow {s}",
                xVal=float(f),
                yVal=float(s),
                sharpeRatio=round(best_item["sharpeRatio"], 2),
                totalReturnPct=round(best_item["totalReturnPct"], 2),
                winRatePct=round(best_item["winRatePct"], 1),
                trades=int(best_item["trades"]),
            )
        )

    elapsed_ms = max(1.0, (time.perf_counter() - t0) * 1000.0)
    combos_per_sec = round(len(combos) / (elapsed_ms / 1000.0), 1)
    best = top_configs[0]
    best_orig_idx = scored_rows[0][1] if scored_rows else 0
    best_filtered = int(filtered_counts[best_orig_idx]) if len(filtered_counts) > best_orig_idx else 0
    is_en = req.locale.startswith("en")
    src_badge = data_source_used if is_real_data else "synthetic-parquet"
    summary = (
        f"Evaluated {len(combos)} configurations over {len(df)} bars ({src_badge}, session {req.sessionFilter}) in {elapsed_ms:.0f} ms "
        f"({combos_per_sec:,.0f} cfg/s). Top edge: Fast {best.fastPeriod}/Slow {best.slowPeriod}, "
        f"ATR x{best.slAtrMult}, RR 1:{best.rrTarget} -> Sharpe {best.sharpeRatio:.2f}, Return {best.totalReturnPct:+.2f}%."
        if is_en
        else f"Varredura VectorBT: {len(combos)} configurações sobre {len(df)} candles ({src_badge} | {req.sessionFilter}) em {elapsed_ms:.0f} ms "
        f"({combos_per_sec:,.0f} configs/s). Melhor setup: Fast {best.fastPeriod}/Slow {best.slowPeriod}, "
        f"Stop ATR x{best.slAtrMult}, RR 1:{best.rrTarget} -> Sharpe {best.sharpeRatio:.2f} | Retorno {best.totalReturnPct:+.2f}%."
    )

    return VectorSweepResponse(
        engine="Polars + VectorBT + Numba",
        symbol=req.symbol.upper(),
        timeframe=norm_tf,
        strategyFamily=req.strategyFamily,
        barsProcessed=len(df),
        totalCombinations=len(combos),
        elapsedMs=round(elapsed_ms, 1),
        combinationsPerSec=combos_per_sec,
        topConfigs=top_configs,
        heatmapCells=heatmap_cells,
        summaryText=summary,
        dataSourceUsed=data_source_used,
        isRealMarketData=is_real_data,
        sessionFilter=req.sessionFilter,
        signalsFilteredBySession=best_filtered,
    )


def _fast_param_importances(study: optuna.Study) -> dict[str, float]:
    """Computes fast deterministic normalized Pearson sensitivity per hyperparameter."""
    keys = ["fastPeriod", "slowPeriod", "slAtrMult", "rrTarget", "riskPct", "rsiThreshold"]
    completed = [
        t for t in study.trials if t.state == optuna.trial.TrialState.COMPLETE and t.value is not None and math.isfinite(t.value)
    ]
    if len(completed) < 3:
        even = round(100.0 / len(keys), 1)
        return {k: even for k in keys}

    vals = np.array([float(t.value) for t in completed], dtype=np.float64)
    val_std = float(np.std(vals))
    if val_std <= 1e-12:
        even = round(100.0 / len(keys), 1)
        return {k: even for k in keys}

    raw: dict[str, float] = {}
    for k in keys:
        xs = np.array([float(t.params.get(k, 0.0)) for t in completed], dtype=np.float64)
        x_std = float(np.std(xs))
        if x_std <= 1e-12:
            raw[k] = 0.0
        else:
            corr = float(np.corrcoef(xs, vals)[0, 1])
            raw[k] = abs(corr) if math.isfinite(corr) else 0.0

    total = sum(raw.values())
    if total <= 1e-12:
        even = round(100.0 / len(keys), 1)
        return {k: even for k in keys}

    out = {k: round((v / total) * 100.0, 1) for k, v in raw.items()}
    diff = round(100.0 - sum(out.values()), 1)
    if abs(diff) > 0:
        top_k = max(out.items(), key=lambda item: item[1])[0]
        out[top_k] = round(max(0.0, out[top_k] + diff), 1)
    return out


def run_optuna_optimization(req: OptunaOptimizeRequest) -> OptunaOptimizeResponse:
    """Runs Optuna TPE Bayesian optimization with chronological Walk-Forward & Realistic verification."""
    t0 = time.perf_counter()
    optuna.logging.set_verbosity(optuna.logging.WARNING)

    norm_tf, tf_ms = normalize_timeframe(req.timeframe)
    df, data_source_used, is_real_data = load_ohlcv_with_source(
        req.symbol,
        norm_tf,
        limit=req.barsCount,
        data_mode=req.dataMode,
        auto_sync_if_missing=(req.dataMode == "REAL"),
    )
    n_total = len(df)
    split_idx = max(140, min(n_total - 80, int(n_total * req.trainRatio)))

    train_df = df.slice(0, split_idx)
    test_df = df.slice(split_idx, n_total - split_idx)

    fast_space = list(range(6, 35, 2))
    slow_space = sorted(set(range(28, 121, 4)) | {f + 10 for f in fast_space})
    train_base, train_ema, train_dhi, train_dlo = _prepare_indicator_cache(train_df, fast_space, slow_space)
    train_mask = build_session_entry_mask(
        train_base["timestamp"],
        session_filter=req.sessionFilter,
        avoid_friday_late=req.avoidFridayLate,
    )
    train_mask_bool = train_mask.astype(np.bool_)
    strat_code = _STRATEGY_CODE_MAP[req.strategyFamily]
    friction_rate = float(req.commissionPct) + float(req.spreadPct) + float(req.slippageBps) / 10_000.0
    bars_per_year = max(252.0, (365.0 * 86_400_000.0) / max(tf_ms, 60_000))
    n_train_bars = len(train_base["close"])

    trial_records: list[OptunaTrialSummary] = []

    def _score_trial(m: dict[str, float]) -> float:
        if m["trades"] < 5:
            return -10.0 + m["trades"] * 0.5
        if req.objectiveMetric == "sharpe":
            return m["sharpeRatio"] - max(0.0, m["maxDrawdownPct"] - 15.0) * 0.1
        if req.objectiveMetric == "calmar":
            return m["calmarRatio"]
        if req.objectiveMetric == "profit_factor":
            return m["profitFactor"]
        return _composite_score(m)

    sampler = optuna.samplers.TPESampler(seed=req.seed)
    study = optuna.create_study(direction="maximize", sampler=sampler)

    batch_size = 8
    completed = 0
    while completed < req.nTrials:
        b = min(batch_size, req.nTrials - completed)
        batch_trials: list[optuna.Trial] = []
        batch_combos: list[tuple[int, int, float, float]] = []
        batch_risks: list[float] = []
        batch_rsis: list[float] = []

        for _ in range(b):
            trial = study.ask()
            fast_p = trial.suggest_int("fastPeriod", 6, 34, step=2)
            slow_raw = trial.suggest_int("slowPeriod", 28, 120, step=4)
            slow_p = max(fast_p + 10, slow_raw)
            sl_m = trial.suggest_float("slAtrMult", 0.8, 3.0, step=0.2)
            rr_t = trial.suggest_float("rrTarget", 1.2, 4.0, step=0.2)
            risk_pct = trial.suggest_float("riskPct", 0.5, 2.5, step=0.25)
            rsi_thr = trial.suggest_float("rsiThreshold", 44.0, 62.0, step=2.0)

            batch_trials.append(trial)
            batch_combos.append((fast_p, slow_p, sl_m, rr_t))
            batch_risks.append(risk_pct)
            batch_rsis.append(rsi_thr)

        ema_fast_mat = np.empty((n_train_bars, b), dtype=np.float64)
        ema_slow_mat = np.empty((n_train_bars, b), dtype=np.float64)
        don_hi_mat = np.empty((n_train_bars, b), dtype=np.float64)
        don_lo_mat = np.empty((n_train_bars, b), dtype=np.float64)
        sl_mults = np.empty(b, dtype=np.float64)
        rr_targets = np.empty(b, dtype=np.float64)
        for j, (fast_p, slow_p, sl_m, rr_t) in enumerate(batch_combos):
            ema_fast_mat[:, j] = train_ema[fast_p]
            ema_slow_mat[:, j] = train_ema[slow_p]
            don_hi_mat[:, j] = train_dhi[fast_p]
            don_lo_mat[:, j] = train_dlo[fast_p]
            sl_mults[j] = sl_m
            rr_targets[j] = rr_t

        size_fracs = np.clip(np.asarray(batch_risks, dtype=np.float64) * 0.2, 0.08, 0.8)
        rsi_arr = np.asarray(batch_rsis, dtype=np.float64)

        le, lx, se, sx, _ = _generate_signal_matrices_multi_rsi_numba(
            train_base["close"],
            train_base["high"],
            train_base["low"],
            train_base["atr"],
            train_base["rsi"],
            train_base["bb_upper"],
            train_base["bb_lower"],
            train_base["sma_20"],
            ema_fast_mat,
            ema_slow_mat,
            don_hi_mat,
            don_lo_mat,
            sl_mults,
            rr_targets,
            rsi_arr,
            strat_code,
            train_mask_bool,
        )
        tr_arr, ret_arr, dd_arr, sh_arr, so_arr, cal_arr, wr_arr, pf_arr = _evaluate_signals_batch_numba(
            train_base["close"],
            le,
            lx,
            se,
            sx,
            size_fracs,
            float(req.initialCapital),
            friction_rate,
            bars_per_year,
        )

        metrics_batch = [
            {
                "trades": int(round(tr_arr[j])),
                "totalReturnPct": round(float(ret_arr[j]), 2),
                "maxDrawdownPct": round(float(dd_arr[j]), 2),
                "sharpeRatio": round(float(sh_arr[j]), 2),
                "sortinoRatio": round(float(so_arr[j]), 2),
                "calmarRatio": round(float(cal_arr[j]), 2),
                "winRatePct": round(float(wr_arr[j]), 1),
                "profitFactor": round(float(pf_arr[j]), 2),
            }
            for j in range(b)
        ]

        for trial, (fast_p, slow_p, sl_m, rr_t), risk_pct, m in zip(
            batch_trials, batch_combos, batch_risks, metrics_batch
        ):
            score = float(_score_trial(m))
            trial_records.append(
                OptunaTrialSummary(
                    trialNumber=trial.number + 1,
                    score=round(score, 3),
                    fastPeriod=fast_p,
                    slowPeriod=slow_p,
                    slAtrMult=round(sl_m, 2),
                    rrTarget=round(rr_t, 2),
                    riskPct=round(risk_pct, 2),
                    trades=int(m["trades"]),
                    sharpeRatio=m["sharpeRatio"],
                    totalReturnPct=m["totalReturnPct"],
                    maxDrawdownPct=m["maxDrawdownPct"],
                )
            )
            study.tell(trial, score)

        completed += b

    best_p = study.best_params
    best_fast = int(best_p.get("fastPeriod", 12))
    best_slow = max(best_fast + 10, int(best_p.get("slowPeriod", 38)))
    best_sl = float(best_p.get("slAtrMult", 1.5))
    best_rr = float(best_p.get("rrTarget", 2.0))
    best_risk = float(best_p.get("riskPct", req.riskPct))
    best_rsi = float(best_p.get("rsiThreshold", 52.0))
    size_frac = max(0.08, min(0.8, best_risk * 0.2))

    test_base, test_ema, test_dhi, test_dlo = _prepare_indicator_cache(test_df, [best_fast], [best_slow])
    full_base, full_ema, full_dhi, full_dlo = _prepare_indicator_cache(df, [best_fast], [best_slow])
    test_mask = build_session_entry_mask(
        test_base["timestamp"],
        session_filter=req.sessionFilter,
        avoid_friday_late=req.avoidFridayLate,
    )
    full_mask = build_session_entry_mask(
        full_base["timestamp"],
        session_filter=req.sessionFilter,
        avoid_friday_late=req.avoidFridayLate,
    )

    pf_is, _ = _run_vbt_batch(
        base=train_base,
        ema_map=train_ema,
        don_hi_map=train_dhi,
        don_lo_map=train_dlo,
        combos=[(best_fast, best_slow, best_sl, best_rr)],
        rsi_thresh=best_rsi,
        strategy_family=req.strategyFamily,
        timeframe=norm_tf,
        initial_capital=req.initialCapital,
        fees=req.commissionPct,
        slippage=req.spreadPct,
        size_fraction=size_frac,
        allowed_entry_mask=train_mask,
        slippage_bps=req.slippageBps,
    )
    m_is = _extract_portfolio_metrics(pf_is, 1, req.initialCapital)[0]

    pf_oos, _ = _run_vbt_batch(
        base=test_base,
        ema_map=test_ema,
        don_hi_map=test_dhi,
        don_lo_map=test_dlo,
        combos=[(best_fast, best_slow, best_sl, best_rr)],
        rsi_thresh=best_rsi,
        strategy_family=req.strategyFamily,
        timeframe=norm_tf,
        initial_capital=req.initialCapital,
        fees=req.commissionPct,
        slippage=req.spreadPct,
        size_fraction=size_frac,
        allowed_entry_mask=test_mask,
        slippage_bps=req.slippageBps,
    )
    m_oos = _extract_portfolio_metrics(pf_oos, 1, req.initialCapital)[0]

    pf_full, _ = _run_vbt_batch(
        base=full_base,
        ema_map=full_ema,
        don_hi_map=full_dhi,
        don_lo_map=full_dlo,
        combos=[(best_fast, best_slow, best_sl, best_rr)],
        rsi_thresh=best_rsi,
        strategy_family=req.strategyFamily,
        timeframe=norm_tf,
        initial_capital=req.initialCapital,
        fees=req.commissionPct,
        slippage=req.spreadPct,
        size_fraction=size_frac,
        allowed_entry_mask=full_mask,
        slippage_bps=req.slippageBps,
    )
    eq_series = np.asarray(pf_full.value(), dtype=np.float64).reshape(-1)
    dd_series = np.abs(np.asarray(pf_full.drawdown(), dtype=np.float64).reshape(-1)) * 100.0
    step = max(1, len(eq_series) // 180)
    equity_curve = []
    for idx_pt in range(0, len(eq_series), step):
        equity_curve.append(
            {
                "idx": idx_pt,
                "phase": "IN_SAMPLE" if idx_pt < split_idx else "OUT_OF_SAMPLE",
                "equity": round(_safe_num(eq_series[idx_pt], req.initialCapital, 1e9), 2),
                "drawdownPct": round(_safe_num(dd_series[idx_pt], 0.0, 100.0), 2),
            }
        )

    realistic_summary: RealisticVerificationSummary | None = None
    realistic_tearsheet: dict[str, Any] | None = None
    realistic_orders_count = 0
    if req.verifyRealistic and len(test_df) >= 35:
        rsim = run_realistic_bar_simulation(
            test_df,
            symbol=req.symbol.upper(),
            strategy_family=req.strategyFamily,
            fast_period=best_fast,
            slow_period=best_slow,
            rr_target=best_rr,
            sl_atr_mult=best_sl,
            rsi_threshold=best_rsi,
            initial_capital=req.initialCapital,
            risk_pct=best_risk,
            spread_pct=req.spreadPct,
            commission_pct=req.commissionPct,
            slippage_bps=req.slippageBps,
            session_filter=req.sessionFilter,
            avoid_friday_late=req.avoidFridayLate,
            locale=req.locale,
        )
        realistic_summary = rsim["summary"]
        realistic_orders = rsim["orders"]
        realistic_orders_count = len(realistic_orders)
        if realistic_orders:
            realistic_tearsheet = generate_quantstats_tearsheet(
                realistic_orders,
                initial_balance=req.initialCapital,
                symbol=req.symbol.upper(),
                locale=req.locale,
            )

    param_imp = _fast_param_importances(study)

    is_en = req.locale.startswith("en")
    if m_oos["totalReturnPct"] > 0 and m_oos["sharpeRatio"] >= 0.4 and m_oos["trades"] >= 3:
        if realistic_summary is not None and realistic_summary.totalTrades >= 3 and realistic_summary.netPnlUsd < 0:
            tone: Any = "warn"
            verdict = (
                f"Walk-Forward Divergence: VectorBT OOS ({m_oos['totalReturnPct']:+.2f}%) degraded under Realistic Bar-by-Bar (${realistic_summary.netPnlUsd:+,.2f} after ${realistic_summary.totalFrictionUsd:,.2f} friction)."
                if is_en
                else f"Divergência VectorBT vs Realista: VectorBT OOS ({m_oos['totalReturnPct']:+.2f}%) ficou negativo na auditoria Barra-a-Barra (${realistic_summary.netPnlUsd:+,.2f} após ${realistic_summary.totalFrictionUsd:,.2f} de fricção)."
            )
        else:
            tone = "accent"
            verdict = (
                f"Walk-Forward PASSED: Out-of-Sample stayed positive ({m_oos['totalReturnPct']:+.2f}%, Sharpe {m_oos['sharpeRatio']:.2f}) with controlled overfitting."
                if is_en
                else f"Walk-Forward APROVADO: Out-of-Sample positivo ({m_oos['totalReturnPct']:+.2f}%, Sharpe {m_oos['sharpeRatio']:.2f}) — baixa chance de overfitting."
            )
    elif m_oos["totalReturnPct"] >= -1.5:
        tone = "warn"
        verdict = (
            f"Walk-Forward NEUTRAL: Out-of-Sample marginal ({m_oos['totalReturnPct']:+.2f}%). Increase sample bars or widen stops."
            if is_en
            else f"Walk-Forward NEUTRO: Out-of-Sample marginal ({m_oos['totalReturnPct']:+.2f}%). Recomenda-se ampliar histórico ou ajustar ATR Stop."
        )
    else:
        tone = "danger"
        verdict = (
            f"Overfitting Warning: In-Sample ({m_is['totalReturnPct']:+.2f}%) degraded in Out-of-Sample ({m_oos['totalReturnPct']:+.2f}%)."
            if is_en
            else f"Alerta de Overfitting: In-Sample ({m_is['totalReturnPct']:+.2f}%) degradou no Out-of-Sample ({m_oos['totalReturnPct']:+.2f}%). Não operar sem revalidação."
        )

    top_trials = sorted(trial_records, key=lambda r: r.score, reverse=True)[:10]
    elapsed_ms = max(1.0, (time.perf_counter() - t0) * 1000.0)

    return OptunaOptimizeResponse(
        engine="Optuna TPE + Polars + VectorBT",
        symbol=req.symbol.upper(),
        timeframe=norm_tf,
        strategyFamily=req.strategyFamily,
        objectiveMetric=req.objectiveMetric,
        barsProcessed=n_total,
        trainBars=split_idx,
        testBars=n_total - split_idx,
        nTrialsCompleted=len(study.trials),
        elapsedMs=round(elapsed_ms, 1),
        bestScore=round(float(study.best_value), 3),
        bestParams={
            "fastPeriod": best_fast,
            "slowPeriod": best_slow,
            "slAtrMult": round(best_sl, 2),
            "rrTarget": round(best_rr, 2),
            "riskPct": round(best_risk, 2),
            "rsiThreshold": round(best_rsi, 1),
        },
        inSampleMetrics=WalkForwardSplitMetrics(
            totalTrades=int(m_is["trades"]),
            winRatePct=m_is["winRatePct"],
            profitFactor=m_is["profitFactor"],
            sharpeRatio=m_is["sharpeRatio"],
            sortinoRatio=m_is["sortinoRatio"],
            calmarRatio=m_is["calmarRatio"],
            totalReturnPct=m_is["totalReturnPct"],
            netProfitUsd=m_is["netProfitUsd"],
            maxDrawdownPct=m_is["maxDrawdownPct"],
        ),
        outOfSampleMetrics=WalkForwardSplitMetrics(
            totalTrades=int(m_oos["trades"]),
            winRatePct=m_oos["winRatePct"],
            profitFactor=m_oos["profitFactor"],
            sharpeRatio=m_oos["sharpeRatio"],
            sortinoRatio=m_oos["sortinoRatio"],
            calmarRatio=m_oos["calmarRatio"],
            totalReturnPct=m_oos["totalReturnPct"],
            netProfitUsd=m_oos["netProfitUsd"],
            maxDrawdownPct=m_oos["maxDrawdownPct"],
        ),
        robustnessVerdict=verdict,
        robustnessTone=tone,
        paramImportances=param_imp,
        topTrials=top_trials,
        equityCurve=equity_curve,
        dataSourceUsed=data_source_used,
        isRealMarketData=is_real_data,
        sessionFilter=req.sessionFilter,
        realisticVerification=realistic_summary,
        realisticTearsheet=realistic_tearsheet,
        realisticOrdersCount=realistic_orders_count,
    )