"""
Realistic Event-Driven Bar-by-Bar Trading Simulator & Session/Killzone Masks (Phase 2).

Simulates `open -> high/low -> close` execution with:
  - Institutional UTC Killzone / Session entry filters & Friday-late block
  - Spread + bps & ATR volatility slippage + gap-through SL fills
  - Conservative intrabar SL-first collision resolution
  - Contract-spec lot sizing & lot-based USD PnL from `ledger.py`
  - Transparent friction attribution (Spread / Slippage / Commission USD)
"""

from __future__ import annotations

import math
from typing import Any, Optional

import numpy as np
import polars as pl

from .contracts import RealisticVerificationSummary, SessionFilterOption, StrategyFamily
from .ledger import (
    calculate_instrument_lots,
    calculate_lot_based_pnl,
    get_instrument_contract_spec,
    round_money,
)


def build_session_entry_mask(
    timestamps_ms: np.ndarray,
    session_filter: SessionFilterOption = "ALL",
    avoid_friday_late: bool = False,
) -> np.ndarray:
    """
    Build a boolean mask of allowed entry bars based on UTC session/Killzone hours.
      - ALL:         24h
      - LONDON_ONLY: 07:00 - 12:00 UTC
      - NY_ONLY:     12:00 - 17:00 UTC
      - LONDON_NY:   07:00 - 17:00 UTC (London + NY Overlap Killzones)
      - NO_ASIA:     07:00 - 21:00 UTC
    When `avoid_friday_late=True`, entries from Friday 19:00 UTC onward are blocked.
    """
    n = len(timestamps_ms)
    if n == 0:
        return np.zeros(0, dtype=np.bool_)

    sec = timestamps_ms.astype(np.int64) // 1000
    hour = ((sec // 3600) % 24).astype(np.int32)
    # 1970-01-01 was Thursday (3 in Mon=0..Sun=6)
    weekday = (((sec // 86400) + 3) % 7).astype(np.int32)

    flt = (session_filter or "ALL").upper()
    if flt == "LONDON_ONLY":
        mask = (hour >= 7) & (hour < 12)
    elif flt == "NY_ONLY":
        mask = (hour >= 12) & (hour < 17)
    elif flt == "LONDON_NY":
        mask = (hour >= 7) & (hour < 17)
    elif flt == "NO_ASIA":
        mask = (hour >= 7) & (hour < 21)
    else:
        mask = np.ones(n, dtype=np.bool_)

    if avoid_friday_late:
        mask = mask & ~((weekday == 4) & (hour >= 19))

    return mask


def _compute_signals_from_df(
    df: pl.DataFrame,
    strategy_family: StrategyFamily,
    fast_period: int,
    slow_period: int,
    rsi_threshold: float,
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Compute raw entry triggers and ATR array matching vector_optuna definitions."""
    fast_p = max(3, int(fast_period))
    slow_p = max(fast_p + 2, int(slow_period))
    donch_win = max(10, slow_p // 2)

    prev_close = pl.col("close").shift(1)
    tr = pl.max_horizontal(
        pl.col("high") - pl.col("low"),
        (pl.col("high") - prev_close).abs(),
        (pl.col("low") - prev_close).abs(),
    )
    delta = pl.col("close").diff()
    gain = pl.when(delta > 0).then(delta).otherwise(0.0)
    loss = pl.when(delta < 0).then(-delta).otherwise(0.0)

    work = df.with_columns(
        [
            pl.col("close").ewm_mean(span=fast_p, adjust=False).alias("_ema_fast"),
            pl.col("close").ewm_mean(span=slow_p, adjust=False).alias("_ema_slow"),
            tr.ewm_mean(alpha=1.0 / 14.0, adjust=False).alias("_atr14"),
            gain.ewm_mean(alpha=1.0 / 14.0, adjust=False).alias("_avg_gain"),
            loss.ewm_mean(alpha=1.0 / 14.0, adjust=False).alias("_avg_loss"),
            pl.col("high").rolling_max(window_size=donch_win).shift(1).alias("_donch_hi"),
            pl.col("low").rolling_min(window_size=donch_win).shift(1).alias("_donch_lo"),
            pl.col("close").rolling_mean(window_size=20).alias("_bb_mid"),
            pl.col("close").rolling_std(window_size=20).alias("_bb_std"),
        ]
    )

    close = work["close"].to_numpy().astype(np.float64)
    fast = np.nan_to_num(work["_ema_fast"].to_numpy().astype(np.float64), nan=close)
    slow = np.nan_to_num(work["_ema_slow"].to_numpy().astype(np.float64), nan=close)
    atr = np.nan_to_num(work["_atr14"].to_numpy().astype(np.float64), nan=close * 0.002)

    avg_g = np.nan_to_num(work["_avg_gain"].to_numpy().astype(np.float64), nan=0.0)
    avg_l = np.nan_to_num(work["_avg_loss"].to_numpy().astype(np.float64), nan=1e-9)
    rs = np.where(avg_l > 1e-12, avg_g / np.maximum(avg_l, 1e-12), 100.0)
    rsi = 100.0 - (100.0 / (1.0 + rs))

    donch_hi = work["_donch_hi"].to_numpy().astype(np.float64)
    donch_lo = work["_donch_lo"].to_numpy().astype(np.float64)
    bb_mid = work["_bb_mid"].to_numpy().astype(np.float64)
    bb_std = work["_bb_std"].to_numpy().astype(np.float64)
    bb_up = bb_mid + 2.0 * bb_std
    bb_lo = bb_mid - 2.0 * bb_std

    n = len(close)
    long_sig = np.zeros(n, dtype=np.bool_)
    short_sig = np.zeros(n, dtype=np.bool_)

    warmup = min(25, max(2, n // 10))
    for t in range(warmup, n):
        if strategy_family == "EMA_CROSS_RSI":
            if fast[t - 1] <= slow[t - 1] and fast[t] > slow[t] and rsi[t] >= rsi_threshold:
                long_sig[t] = True
            elif fast[t - 1] >= slow[t - 1] and fast[t] < slow[t] and rsi[t] <= (100.0 - rsi_threshold):
                short_sig[t] = True
        elif strategy_family == "BOLLINGER_MEAN_REV":
            if not np.isnan(bb_lo[t]) and close[t - 1] < bb_lo[t - 1] and close[t] >= bb_lo[t] and rsi[t] <= 48.0:
                long_sig[t] = True
            elif not np.isnan(bb_up[t]) and close[t - 1] > bb_up[t - 1] and close[t] <= bb_up[t] and rsi[t] >= 52.0:
                short_sig[t] = True
        else:  # SMC_DONCHIAN_ATR
            if (
                not np.isnan(donch_hi[t])
                and close[t] > donch_hi[t]
                and fast[t] > slow[t]
                and rsi[t] >= (rsi_threshold - 4.0)
            ):
                long_sig[t] = True
            elif (
                not np.isnan(donch_lo[t])
                and close[t] < donch_lo[t]
                and fast[t] < slow[t]
                and rsi[t] <= ((100.0 - rsi_threshold) + 4.0)
            ):
                short_sig[t] = True

    return long_sig, short_sig, atr


def _usd_delta_abs(symbol: str, ref_price: float, price_diff: float, lots: float) -> float:
    if price_diff <= 0 or lots <= 0:
        return 0.0
    pnl = calculate_lot_based_pnl(symbol, "BUY", ref_price, ref_price + price_diff, lots, 0.0)
    return abs(float(pnl))


def run_realistic_bar_simulation(
    df: pl.DataFrame,
    symbol: str = "XAUUSD",
    strategy_family: StrategyFamily = "SMC_DONCHIAN_ATR",
    fast_period: int = 14,
    slow_period: int = 55,
    rr_target: float = 2.2,
    sl_atr_mult: float = 1.5,
    rsi_threshold: float = 52.0,
    initial_capital: float = 100000.0,
    risk_pct: float = 1.0,
    spread_pct: float = 0.00015,
    commission_pct: float = 0.00007,
    slippage_bps: float = 1.5,
    session_filter: SessionFilterOption = "ALL",
    avoid_friday_late: bool = False,
    raw_long_signals: Optional[np.ndarray] = None,
    raw_short_signals: Optional[np.ndarray] = None,
    atr_override: Optional[np.ndarray] = None,
    locale: str = "pt",
) -> dict[str, Any]:
    """
    Execute an event-driven `open -> high/low -> close` backtest on `df`.
    Returns summary metrics, friction attribution, Replay-compatible orders, and equity curve.
    """
    n = df.height
    if n < 30:
        empty_summary = RealisticVerificationSummary(
            totalTrades=0,
            winRatePct=0.0,
            profitFactor=0.0,
            totalReturnPct=0.0,
            maxDrawdownPct=0.0,
            sharpe=0.0,
            netPnlUsd=0.0,
            totalSpreadCostUsd=0.0,
            totalSlippageCostUsd=0.0,
            totalCommissionCostUsd=0.0,
            totalFrictionUsd=0.0,
            signalsGenerated=0,
            signalsFilteredBySession=0,
            avgMfeR=0.0,
            avgMaeR=0.0,
            expectancyR=0.0,
            verdict="Sem dados suficientes para simulação realista." if locale == "pt" else "Insufficient bars for realistic simulation.",
        )
        return {
            "summary": empty_summary,
            "equityCurve": [],
            "orders": [],
        }

    ts = df["timestamp"].to_numpy().astype(np.int64)
    opens = df["open"].to_numpy().astype(np.float64)
    highs = df["high"].to_numpy().astype(np.float64)
    lows = df["low"].to_numpy().astype(np.float64)
    closes = df["close"].to_numpy().astype(np.float64)

    if raw_long_signals is not None and raw_short_signals is not None and atr_override is not None:
        long_sig = raw_long_signals.astype(np.bool_)
        short_sig = raw_short_signals.astype(np.bool_)
        atr = atr_override.astype(np.float64)
    else:
        long_sig, short_sig, atr = _compute_signals_from_df(
            df, strategy_family, fast_period, slow_period, rsi_threshold
        )

    allowed_mask = build_session_entry_mask(ts, session_filter=session_filter, avoid_friday_late=avoid_friday_late)

    balance = float(initial_capital)
    peak_equity = balance
    max_dd_pct = 0.0

    pos_side = 0  # 0 flat, 1 BUY, -1 SELL
    entry_price = 0.0
    sl_price = 0.0
    tp_price = 0.0
    risk_dist = 1.0
    lots = 0.01
    entry_ts = 0
    entry_bar = 0
    entry_comm = 0.0
    entry_spread_usd = 0.0
    entry_slip_usd = 0.0
    best_fav_r = 0.0
    worst_adv_r = 0.0

    signals_generated = 0
    signals_filtered = 0
    total_spread_usd = 0.0
    total_slip_usd = 0.0
    total_comm_usd = 0.0

    orders: list[dict[str, Any]] = []
    equity_curve: list[dict[str, Any]] = [{"timestamp": int(ts[0]), "equity": round(balance, 2)}]

    spec = get_instrument_contract_spec(symbol, float(closes[0]))
    sample_step = max(1, n // 140)

    def _close_position(exit_px_raw: float, exit_slip_px: float, exit_spread_half_px: float, exit_ts_ms: int, reason: str) -> None:
        nonlocal balance, peak_equity, max_dd_pct, pos_side
        nonlocal total_spread_usd, total_slip_usd, total_comm_usd

        side_str = "BUY" if pos_side == 1 else "SELL"
        if pos_side == 1:
            fill_exit = max(1e-6, exit_px_raw - exit_spread_half_px - exit_slip_px)
        else:
            fill_exit = max(1e-6, exit_px_raw + exit_spread_half_px + exit_slip_px)

        exit_spread_usd = _usd_delta_abs(symbol, fill_exit, exit_spread_half_px, lots)
        exit_slip_usd = _usd_delta_abs(symbol, fill_exit, exit_slip_px, lots)
        notional_exit = _usd_delta_abs(symbol, fill_exit, fill_exit, lots)
        exit_comm = round_money(notional_exit * commission_pct)
        total_comm = round_money(entry_comm + exit_comm)

        net_pnl = calculate_lot_based_pnl(symbol, side_str, entry_price, fill_exit, lots, total_comm)
        balance = round_money(balance + net_pnl)

        total_spread_usd += entry_spread_usd + exit_spread_usd
        total_slip_usd += entry_slip_usd + exit_slip_usd
        total_comm_usd += total_comm

        # R-multiple relative to intended price risk distance scaled by lot size
        one_r_usd = max(_usd_delta_abs(symbol, entry_price, risk_dist, lots), 1e-6)
        r_mult = round(net_pnl / one_r_usd, 3)

        orders.append(
            {
                "id": f"rsim-{len(orders) + 1}",
                "symbol": symbol,
                "side": side_str,
                "type": "MARKET",
                "status": "CLOSED",
                "entryPrice": round(entry_price, 6),
                "exitPrice": round(fill_exit, 6),
                "sl": round(sl_price, 6),
                "tp": round(tp_price, 6),
                "lots": lots,
                "commission": total_comm,
                "pnl": net_pnl,
                "rMultiple": r_mult,
                "mfe": round(max(0.0, best_fav_r), 3),
                "mae": round(max(0.0, worst_adv_r), 3),
                "exitReason": reason,
                "openedAt": int(entry_ts),
                "filledAt": int(entry_ts),
                "closedAt": int(exit_ts_ms),
                "setup": f"{strategy_family} ({session_filter})",
            }
        )

        peak_equity = max(peak_equity, balance)
        if peak_equity > 0:
            dd = ((peak_equity - balance) / peak_equity) * 100.0
            max_dd_pct = max(max_dd_pct, dd)
        pos_side = 0

    for t in range(1, n):
        # 1. Enter on bar t open using signal triggered on bar t-1 close (zero look-ahead)
        if pos_side == 0:
            wants_long = bool(long_sig[t - 1])
            wants_short = bool(short_sig[t - 1]) and not wants_long
            if wants_long or wants_short:
                signals_generated += 1
                if not bool(allowed_mask[t]):
                    signals_filtered += 1
                else:
                    ref_open = float(opens[t])
                    atr_prev = float(atr[t - 1]) if np.isfinite(atr[t - 1]) and atr[t - 1] > 0 else ref_open * 0.002
                    spread_half = ref_open * (spread_pct * 0.5)
                    slip_entry_px = (ref_open * (slippage_bps / 10_000.0)) + (
                        0.015 * atr_prev if slippage_bps > 0 else 0.0
                    )
                    base_sl_dist = max(sl_atr_mult * atr_prev, ref_open * 0.0008, 1e-6)
                    min_buffer = spread_half + slip_entry_px + ref_open * 0.0003
                    risk_dist = max(base_sl_dist, min_buffer)
                    tp_dist = risk_dist * rr_target

                    risk_usd = max(balance, initial_capital * 0.1) * (risk_pct / 100.0)
                    lots, spec, _ = calculate_instrument_lots(symbol, ref_open, risk_dist, risk_usd)

                    if wants_long:
                        pos_side = 1
                        entry_price = ref_open + spread_half + slip_entry_px
                        sl_price = ref_open - risk_dist
                        tp_price = ref_open + tp_dist
                    else:
                        pos_side = -1
                        entry_price = max(1e-6, ref_open - spread_half - slip_entry_px)
                        sl_price = ref_open + risk_dist
                        tp_price = max(1e-6, ref_open - tp_dist)

                    entry_ts = int(ts[t])
                    entry_bar = t
                    best_fav_r = 0.0
                    worst_adv_r = 0.0
                    entry_spread_usd = _usd_delta_abs(symbol, entry_price, spread_half, lots)
                    entry_slip_usd = _usd_delta_abs(symbol, entry_price, slip_entry_px, lots)
                    notional_entry = _usd_delta_abs(symbol, entry_price, entry_price, lots)
                    entry_comm = round_money(notional_entry * commission_pct)

        # 2. Evaluate open position on bar t: gap open check -> SL-first intrabar check -> MFE/MAE
        if pos_side != 0:
            bar_open = float(opens[t])
            bar_high = float(highs[t])
            bar_low = float(lows[t])
            bar_close = float(closes[t])
            bar_atr = float(atr[t]) if np.isfinite(atr[t]) and atr[t] > 0 else bar_close * 0.002
            spread_half_exit = bar_close * (spread_pct * 0.5)
            slip_stop_px = (bar_close * (slippage_bps / 10_000.0)) + (0.015 * bar_atr if slippage_bps > 0 else 0.0)

            if pos_side == 1:
                fav_move = (bar_high - entry_price) / max(risk_dist, 1e-6)
                adv_move = (entry_price - bar_low) / max(risk_dist, 1e-6)
                best_fav_r = max(best_fav_r, fav_move)
                worst_adv_r = max(worst_adv_r, adv_move)

                if t > entry_bar and bar_open <= sl_price:
                    _close_position(bar_open, slip_stop_px, spread_half_exit, int(ts[t]), "SL")
                elif bar_low <= sl_price:
                    # Conservative SL-first rule if both SL & TP hit inside the same bar
                    _close_position(sl_price, slip_stop_px, spread_half_exit, int(ts[t]), "SL")
                elif bar_high >= tp_price:
                    # TP limit fill: no extra stop slippage
                    _close_position(tp_price, 0.0, spread_half_exit, int(ts[t]), "TP")
            else:
                fav_move = (entry_price - bar_low) / max(risk_dist, 1e-6)
                adv_move = (bar_high - entry_price) / max(risk_dist, 1e-6)
                best_fav_r = max(best_fav_r, fav_move)
                worst_adv_r = max(worst_adv_r, adv_move)

                if t > entry_bar and bar_open >= sl_price:
                    _close_position(bar_open, slip_stop_px, spread_half_exit, int(ts[t]), "SL")
                elif bar_high >= sl_price:
                    _close_position(sl_price, slip_stop_px, spread_half_exit, int(ts[t]), "SL")
                elif bar_low <= tp_price:
                    _close_position(tp_price, 0.0, spread_half_exit, int(ts[t]), "TP")

            if pos_side != 0 and t == n - 1:
                _close_position(bar_close, slip_stop_px * 0.5, spread_half_exit, int(ts[t]), "MANUAL")

        # Track unrealized drawdown & downsampled equity curve
        unrealized = 0.0
        if pos_side != 0:
            side_str = "BUY" if pos_side == 1 else "SELL"
            unrealized = calculate_lot_based_pnl(symbol, side_str, entry_price, float(closes[t]), lots, 0.0)
        mark_eq = round(balance + unrealized, 2)
        peak_equity = max(peak_equity, mark_eq)
        if peak_equity > 0:
            max_dd_pct = max(max_dd_pct, ((peak_equity - mark_eq) / peak_equity) * 100.0)

        if t % sample_step == 0 or t == n - 1:
            equity_curve.append({"timestamp": int(ts[t]), "equity": mark_eq})

    pnls = np.array([float(o["pnl"]) for o in orders], dtype=np.float64)
    r_mults = np.array([float(o["rMultiple"]) for o in orders], dtype=np.float64)
    mfes = np.array([float(o["mfe"]) for o in orders], dtype=np.float64)
    maes = np.array([float(o["mae"]) for o in orders], dtype=np.float64)

    total_trades = len(orders)
    wins = pnls[pnls > 0]
    losses = pnls[pnls <= 0]
    win_rate = (len(wins) / total_trades * 100.0) if total_trades > 0 else 0.0
    gross_profit = float(wins.sum()) if len(wins) else 0.0
    gross_loss = float(abs(losses.sum())) if len(losses) else 0.0
    pf = gross_profit / gross_loss if gross_loss > 1e-9 else (10.0 if gross_profit > 0 else 0.0)

    net_pnl = round_money(balance - initial_capital)
    total_return_pct = (net_pnl / initial_capital) * 100.0 if initial_capital > 0 else 0.0

    # Annualized Sharpe approximation over trade returns or bar equity changes
    sharpe = 0.0
    if len(equity_curve) > 4:
        eq_vals = np.array([p["equity"] for p in equity_curve], dtype=np.float64)
        rets = np.diff(eq_vals) / np.maximum(eq_vals[:-1], 1e-6)
        std = float(np.std(rets, ddof=1)) if len(rets) > 1 else 0.0
        if std > 1e-9:
            sharpe = float((np.mean(rets) / std) * math.sqrt(min(252, len(rets))))

    total_friction = round_money(total_spread_usd + total_slip_usd + total_comm_usd)
    expectancy_r = float(np.mean(r_mults)) if total_trades > 0 else 0.0

    if total_trades < 5:
        verdict = (
            f"Amostra baixa ({total_trades} trades reais simulados). Aumente histórico ou suavize filtro."
            if locale == "pt"
            else f"Low sample ({total_trades} simulated trades). Expand history or relax filter."
        )
    elif total_return_pct > 0 and pf >= 1.25 and max_dd_pct <= 18.0:
        verdict = (
            f"Aprovado na auditoria realista ({pf:.2f} PF após ${total_friction:,.2f} de fricção)."
            if locale == "pt"
            else f"Passed realistic audit ({pf:.2f} PF after ${total_friction:,.2f} total friction)."
        )
    elif total_return_pct > 0:
        verdict = (
            f"Positivo porém sensível à fricção (${total_friction:,.2f} custos, DD {max_dd_pct:.1f}%)."
            if locale == "pt"
            else f"Positive but friction-sensitive (${total_friction:,.2f} costs, DD {max_dd_pct:.1f}%)."
        )
    else:
        verdict = (
            f"Degradado sob slippage/spread reais (${total_friction:,.2f} de custos totais)."
            if locale == "pt"
            else f"Degraded under realistic spread/slippage (${total_friction:,.2f} total costs)."
        )

    summary = RealisticVerificationSummary(
        totalTrades=total_trades,
        winRatePct=round(win_rate, 2),
        profitFactor=round(min(pf, 99.0), 3),
        totalReturnPct=round(total_return_pct, 2),
        maxDrawdownPct=round(max_dd_pct, 2),
        sharpe=round(sharpe, 3),
        netPnlUsd=net_pnl,
        totalSpreadCostUsd=round_money(total_spread_usd),
        totalSlippageCostUsd=round_money(total_slip_usd),
        totalCommissionCostUsd=round_money(total_comm_usd),
        totalFrictionUsd=total_friction,
        signalsGenerated=signals_generated,
        signalsFilteredBySession=signals_filtered,
        avgMfeR=round(float(np.mean(mfes)) if total_trades > 0 else 0.0, 2),
        avgMaeR=round(float(np.mean(maes)) if total_trades > 0 else 0.0, 2),
        expectancyR=round(expectancy_r, 3),
        verdict=verdict,
    )

    return {
        "summary": summary,
        "equityCurve": equity_curve,
        "orders": orders,
    }
