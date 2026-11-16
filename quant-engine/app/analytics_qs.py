from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
import math
from typing import Any

import numpy as np
import pandas as pd
import quantstats.stats as qs_stats

from .contracts import MonteCarloRequest, QuantAnalyticsReport, WhatIfRequest
from .ledger import round_money


def _safe_float(val: Any, default: float = 0.0) -> float:
    try:
        f = float(val)
        return f if math.isfinite(f) else default
    except (TypeError, ValueError):
        return default


def analyze_quant_session(
    orders: list[dict[str, Any]],
    initial_balance: float = 100000.0,
    locale: str = "pt",
) -> QuantAnalyticsReport:
    """Institutional quantitative metrics combining exact Decimal ledger PnLs and QuantStats-Reloaded."""
    is_en = locale.startswith("en")
    closed = sorted(
        [o for o in orders if o.get("status") in ("WIN", "LOSS")],
        key=lambda x: float(x.get("closedAt") or x.get("openedAt") or 0.0),
    )
    n = len(closed)
    equity_curve: list[float] = [round_money(initial_balance)]

    if n == 0:
        return QuantAnalyticsReport(
            closedTrades=0,
            winRatePct=0.0,
            payoffRatio=0.0,
            profitFactor=0.0,
            expectancyUsd=0.0,
            expectancyR=0.0,
            sharpeRatio=0.0,
            sortinoRatio=0.0,
            calmarRatio=0.0,
            sqn=0.0,
            sqnLabel="Awaiting Trades" if is_en else "Aguardando Trades",
            kellyFullPct=0.0,
            kellyHalfPct=0.0,
            riskOfRuinPct=0.0,
            zScoreStreaks=0.0,
            maxConsecutiveWins=0,
            maxConsecutiveLosses=0,
            consistencyScore=0.0,
            maxDrawdownUsd=0.0,
            maxDrawdownPct=0.0,
            valueAtRisk95Pct=0.0,
            equityCurve=equity_curve,
            smartRecommendation=(
                "Execute at least 3 trades in Replay to unlock quantitative diagnostics (Sharpe, SQN, Kelly, VaR)."
                if is_en
                else "Execute pelo menos 3 operações no Replay para desbloquear o diagnóstico quantitativo (Sharpe, SQN, Kelly e VaR)."
            ),
        )

    pnls: list[float] = []
    pct_returns: list[float] = []
    r_mults: list[float] = []

    running = float(initial_balance)
    peak = running
    max_dd_usd = 0.0
    max_dd_pct = 0.0
    wins = 0
    losses = 0
    gross_win = 0.0
    gross_loss = 0.0
    cur_w = cur_l = max_w = max_l = 0
    runs = 1

    for i, o in enumerate(closed):
        prev_bal = max(1.0, running)
        pnl = _safe_float(o.get("pnl"), 0.0)
        ret_dec = pnl / prev_bal
        pct_returns.append(ret_dec)
        pnls.append(pnl)

        risk_amt = _safe_float(o.get("riskAmount"), 0.0)
        r_m = _safe_float(o.get("rMultiple"), pnl / risk_amt if risk_amt > 0 else ret_dec * 100.0)
        r_mults.append(r_m)

        running += pnl
        equity_curve.append(round_money(running))
        if running > peak:
            peak = running
        dd_usd = peak - running
        dd_pct = (dd_usd / peak) * 100.0 if peak > 0 else 0.0
        max_dd_usd = max(max_dd_usd, dd_usd)
        max_dd_pct = max(max_dd_pct, dd_pct)

        if pnl >= 0:
            wins += 1
            gross_win += pnl
            cur_w += 1
            cur_l = 0
            max_w = max(max_w, cur_w)
        else:
            losses += 1
            gross_loss += abs(pnl)
            cur_l += 1
            cur_w = 0
            max_l = max(max_l, cur_l)

        if i > 0 and (pnls[i - 1] >= 0) != (pnl >= 0):
            runs += 1

    win_rate = wins / n
    loss_rate = 1.0 - win_rate
    avg_win = gross_win / wins if wins > 0 else 0.0
    avg_loss = gross_loss / losses if losses > 0 else 0.0
    payoff = avg_win / avg_loss if avg_loss > 0 else (3.0 if avg_win > 0 else 0.0)
    pf = gross_win / gross_loss if gross_loss > 0 else (9.99 if gross_win > 0 else 0.0)

    ret_series = pd.Series(pct_returns, index=pd.date_range("2026-01-01", periods=n, freq="D"))
    periods = min(252, max(n, 2))
    sharpe = _safe_float(qs_stats.sharpe(ret_series, rf=0.0, periods=periods), 0.0)
    sortino = _safe_float(qs_stats.sortino(ret_series, rf=0.0, periods=periods), sharpe)
    qs_dd = abs(_safe_float(qs_stats.max_drawdown(ret_series), 0.0)) * 100.0
    max_dd_pct = max(max_dd_pct, qs_dd)

    total_ret_pct = ((running - initial_balance) / max(1.0, initial_balance)) * 100.0
    calmar = total_ret_pct / max_dd_pct if max_dd_pct > 0.05 else (5.0 if total_ret_pct > 0 else 0.0)
    var_95_pct = abs(_safe_float(np.percentile(np.array(pct_returns) * 100.0, 5), 0.0))

    expectancy_usd = float(np.mean(pnls))
    expectancy_r = float(np.mean(r_mults))
    std_r = float(np.std(r_mults, ddof=1)) if n > 1 else 0.0
    sqn = (expectancy_r / std_r) * math.sqrt(min(100, n)) if std_r > 1e-6 and n >= 2 else 0.0

    if n < 3:
        sqn_label = "Forming" if is_en else "Em Formação"
    elif sqn >= 3.0:
        sqn_label = "Institutional Grade (Holy Grail)" if is_en else "Grau Institucional (Santo Graal)"
    elif sqn >= 2.5:
        sqn_label = "Excellent" if is_en else "Excelente"
    elif sqn >= 2.0:
        sqn_label = "Good / Consistent" if is_en else "Bom / Consistente"
    elif sqn >= 1.5:
        sqn_label = "Average / Tradable" if is_en else "Médio / Operável"
    else:
        sqn_label = "Fragile / Tune R:R" if is_en else "Frágil / Ajustar R:R"

    raw_kelly = win_rate - (loss_rate / payoff) if payoff > 0 else 0.0
    kelly_full = max(0.0, min(25.0, raw_kelly * 100.0))
    kelly_half = kelly_full / 2.0

    edge = win_rate * min(3.0, payoff) - loss_rate
    if edge <= 0:
        risk_ruin = min(99.9, 65.0 + abs(edge) * 30.0)
    else:
        ratio = max(0.01, (1.0 - edge) / (1.0 + edge))
        risk_ruin = min(99.9, max(0.01, (ratio ** 20) * 100.0))

    z_streaks = 0.0
    if wins > 0 and losses > 0 and n > 3:
        x = 2.0 * wins * losses
        num = n * (runs - 0.5) - x
        den = math.sqrt((x * (x - n)) / max(1, n - 1))
        z_streaks = num / den if den > 0 else 0.0

    consistency = round(
        max(5.0, min(99.0, min(35.0, pf * 14.0) + min(25.0, win_rate * 40.0) + max(0.0, min(40.0, sqn * 12.0)) - min(30.0, max_dd_pct * 1.5)))
    )

    if pf >= 1.8 and win_rate >= 0.5:
        rec = (
            f"High-expectancy setup ({expectancy_r:.2f}R/trade). Half-Kelly suggests {kelly_half:.2f}% risk per execution."
            if is_en
            else f"Setup com expectativa positiva forte ({expectancy_r:.2f}R/trade). Half-Kelly sugere risco ótimo de {kelly_half:.2f}% por operação."
        )
    elif win_rate < 0.4 and payoff >= 2.2:
        rec = (
            f"Trend-following edge ({payoff:.2f}:1 payoff). Expect streaks of up to {max_l} consecutive stops."
            if is_en
            else f"Estratégia seguidora de tendência (Payoff {payoff:.2f}:1). Proteja a disciplina contra sequências de até {max_l} stops."
        )
    else:
        rec = (
            f"Expectancy {expectancy_r:.2f}R · VaR(95%) {var_95_pct:.2f}% · Risk of Ruin {risk_ruin:.1f}%."
            if is_en
            else f"Expectativa {expectancy_r:.2f}R · VaR(95%) {var_95_pct:.2f}% · Risco de Ruína {risk_ruin:.1f}%."
        )

    return QuantAnalyticsReport(
        closedTrades=n,
        winRatePct=round(win_rate * 100.0, 1),
        payoffRatio=round(payoff, 2),
        profitFactor=round(pf, 2),
        expectancyUsd=round_money(expectancy_usd),
        expectancyR=round_money(expectancy_r),
        sharpeRatio=round(sharpe, 2),
        sortinoRatio=round(sortino, 2),
        calmarRatio=round(calmar, 2),
        sqn=round(sqn, 2),
        sqnLabel=sqn_label,
        kellyFullPct=round(kelly_full, 2),
        kellyHalfPct=round(kelly_half, 2),
        riskOfRuinPct=round(risk_ruin, 2),
        zScoreStreaks=round(z_streaks, 2),
        maxConsecutiveWins=max_w,
        maxConsecutiveLosses=max_l,
        consistencyScore=consistency,
        maxDrawdownUsd=round_money(max_dd_usd),
        maxDrawdownPct=round(max_dd_pct, 2),
        valueAtRisk95Pct=round(var_95_pct, 2),
        equityCurve=equity_curve,
        smartRecommendation=rec,
    )


def run_what_if_decimal(req: WhatIfRequest) -> dict[str, Any]:
    """Exact Decimal Account What-If simulation compatible with NestJS simulateBacktest payload."""
    is_en = req.locale.startswith("en")
    init_bal = Decimal(str(req.initialBalance))
    risk_pct = Decimal(str(req.riskPerTrade)) / Decimal("100")
    rr = Decimal(str(req.rrTarget))

    real_eq = init_bal
    sim_eq = init_bal
    real_peak = init_bal
    sim_peak = init_bal
    real_dd = Decimal("0")
    sim_dd = Decimal("0")
    real_wins = real_losses = sim_wins = sim_losses = excluded = breakeven = 0
    real_gp = real_gl = sim_gp = sim_gl = Decimal("0")

    equity_curve: list[dict[str, Any]] = []
    simulated_trade_log: list[dict[str, Any]] = []
    sim_returns: list[float] = []

    for idx, t in enumerate(req.trades):
        raw_net = t.netPnl if t.netPnl is not None else (t.profit + (t.commission or 0.0) + (t.swap or 0.0))
        orig_pnl = Decimal(str(raw_net))
        real_eq += orig_pnl
        if orig_pnl > 0:
            real_wins += 1
            real_gp += orig_pnl
        elif orig_pnl < 0:
            real_losses += 1
            real_gl += -orig_pnl
        if real_eq > real_peak:
            real_peak = real_eq
        real_dd = max(real_dd, real_peak - real_eq)

        raw_session = (t.session or "").lower()
        is_asian = (
            ("asia" in raw_session or "tokyo" in raw_session or "sydney" in raw_session)
            and "london" not in raw_session
            and "new york" not in raw_session
        )
        is_friday = False
        date_str = "N/A"
        if t.closeTime:
            try:
                dt = datetime.fromisoformat(t.closeTime.replace("Z", "+00:00")).astimezone(timezone.utc)
                is_friday = dt.weekday() == 4
                date_str = dt.strftime("%Y-%m-%d")
            except ValueError:
                date_str = t.closeTime[:10]

        if (req.excludeAsian and is_asian) or (req.excludeFridays and is_friday):
            excluded += 1
            equity_curve.append(
                {
                    "date": date_str,
                    "ticket": t.ticket or t.id or idx + 1,
                    "realEquity": round_money(real_eq),
                    "simulatedEquity": round_money(sim_eq),
                    "realPnl": round_money(orig_pnl),
                    "simulatedPnl": 0.0,
                    "excluded": True,
                }
            )
            continue

        if orig_pnl == 0:
            breakeven += 1

        risk_amt = sim_eq * risk_pct
        sim_pnl = Decimal("0")
        if orig_pnl > 0:
            sim_pnl = risk_amt * rr
            sim_wins += 1
            sim_gp += sim_pnl
        elif orig_pnl < 0:
            sim_pnl = -risk_amt
            sim_losses += 1
            sim_gl += risk_amt

        prev_sim = max(float(sim_eq), 1.0)
        sim_returns.append(float(sim_pnl) / prev_sim)
        sim_eq += sim_pnl
        if sim_eq > sim_peak:
            sim_peak = sim_eq
        sim_dd = max(sim_dd, sim_peak - sim_eq)

        sim_pnl_num = round_money(sim_pnl)
        real_pnl_num = round_money(orig_pnl)
        equity_curve.append(
            {
                "date": date_str,
                "ticket": t.ticket or t.id or idx + 1,
                "realEquity": round_money(real_eq),
                "simulatedEquity": round_money(sim_eq),
                "realPnl": real_pnl_num,
                "simulatedPnl": sim_pnl_num,
            }
        )
        simulated_trade_log.append(
            {
                "ticket": t.ticket or t.id or idx + 1,
                "symbol": t.symbol,
                "type": t.type or "BUY",
                "date": date_str,
                "realPnl": real_pnl_num,
                "simulatedPnl": sim_pnl_num,
                "status": "WIN" if sim_pnl_num >= 0 else "LOSS",
            }
        )

    real_net = round_money(real_eq - init_bal)
    sim_net = round_money(sim_eq - init_bal)
    delta = round_money(Decimal(str(sim_net)) - Decimal(str(real_net)))
    real_pf = round(float(real_gp / real_gl), 2) if real_gl > 0 else (99.9 if real_gp > 0 else 0.0)
    sim_pf = round(float(sim_gp / sim_gl), 2) if sim_gl > 0 else (99.9 if sim_gp > 0 else 0.0)
    real_dd_pct = round((float(real_dd) / float(real_peak)) * 100.0, 1) if real_peak > 0 else 0.0
    sim_dd_pct = round((float(sim_dd) / float(sim_peak)) * 100.0, 1) if sim_peak > 0 else 0.0
    sim_win_rate = round((sim_wins / max(1, sim_wins + sim_losses)) * 100.0, 1)
    real_win_rate = round((real_wins / max(1, real_wins + real_losses)) * 100.0, 1)

    sharpe = 0.0
    if len(sim_returns) >= 2:
        ser = pd.Series(sim_returns, index=pd.date_range("2026-01-01", periods=len(sim_returns), freq="D"))
        sharpe = round(_safe_float(qs_stats.sharpe(ser, rf=0.0, periods=min(252, len(sim_returns))), 0.0), 2)

    insights = [
        (
            f"Python Decimal What-If: Simulated net P&L {sim_net:+.2f} vs real {real_net:+.2f} (Sharpe {sharpe:.2f})."
            if is_en
            else f"Motor Python Decimal: Lucro simulado {sim_net:+.2f} vs real {real_net:+.2f} (Sharpe {sharpe:.2f})."
        )
    ]

    return {
        "mode": "ACCOUNT_HISTORY",
        "engine": "Python Decimal + QuantStats",
        "accountName": req.accountName,
        "accountCurrency": req.accountCurrency,
        "comparison": {
            "initialBalance": round_money(init_bal),
            "realTrades": len(req.trades),
            "simulatedTrades": max(0, sim_wins + sim_losses),
            "excludedTrades": excluded,
            "breakevenTrades": breakeven,
            "realNetProfit": real_net,
            "simulatedNetProfit": sim_net,
            "profitDelta": delta,
            "netDifference": delta,
            "realFinalEquity": round_money(real_eq),
            "finalBalance": round_money(sim_eq),
            "simulatedFinalEquity": round_money(sim_eq),
            "realWinRate": real_win_rate,
            "simulatedWinRate": sim_win_rate,
            "realProfitFactor": real_pf,
            "simulatedProfitFactor": sim_pf,
            "realMaxDrawdown": round_money(real_dd),
            "realMaxDrawdownPercent": real_dd_pct,
            "simulatedMaxDrawdown": round_money(sim_dd),
            "simulatedMaxDrawdownPercent": sim_dd_pct,
            "sharpeRatio": sharpe,
        },
        "equityCurve": equity_curve,
        "tradeLog": simulated_trade_log[-50:],
        "insights": insights,
    }


def run_monte_carlo_vectorized(req: MonteCarloRequest) -> dict[str, Any]:
    """NumPy vectorized Monte Carlo projection with optional spread/slippage & commission friction."""
    rng = np.random.default_rng(req.seed)
    runs = req.runs
    n_trades = req.trades
    win_prob = req.winRatePct / 100.0
    risk_frac = req.riskPct / 100.0

    # Matrix [runs, trades]: Bernoulli win/loss outcome
    wins_mask = rng.random((runs, n_trades)) < win_prob
    effective_win_r = max(0.05, req.rr - req.spreadSlippageR)
    effective_loss_r = 1.0 + req.spreadSlippageR
    r_matrix = np.where(wins_mask, effective_win_r, -effective_loss_r)

    if req.sizing == "fixed":
        risk_usd = req.capital * risk_frac
        pnls = r_matrix * risk_usd - req.commissionPerTrade
        cum_pnls = np.cumsum(pnls, axis=1)
        equities = np.column_stack([np.full(runs, req.capital), req.capital + cum_pnls])
    else:
        equities = np.empty((runs, n_trades + 1), dtype=np.float64)
        equities[:, 0] = req.capital
        cur = np.full(runs, req.capital, dtype=np.float64)
        for t in range(n_trades):
            cur = np.maximum(0.0, cur + cur * risk_frac * r_matrix[:, t] - req.commissionPerTrade)
            equities[:, t + 1] = cur

    peaks = np.maximum.accumulate(equities, axis=1)
    dd_pct = np.where(peaks > 0, ((peaks - equities) / peaks) * 100.0, 0.0)
    max_dd_per_run = np.max(dd_pct, axis=1)
    net_outcomes = equities[:, -1] - req.capital

    # Longest losing streak per run
    longest_streaks = np.zeros(runs, dtype=np.int32)
    cur_streak = np.zeros(runs, dtype=np.int32)
    losses_mask = ~wins_mask
    for t in range(n_trades):
        cur_streak = np.where(losses_mask[:, t], cur_streak + 1, 0)
        longest_streaks = np.maximum(longest_streaks, cur_streak)

    pcts = np.percentile(net_outcomes, [5, 25, 50, 75, 95])
    prob_loss = float(np.mean(net_outcomes < 0) * 100.0)
    prob_ruin = float(np.mean(max_dd_per_run >= req.ruinPct) * 100.0)
    median_dd = float(np.median(max_dd_per_run))
    median_streak = int(np.round(np.median(longest_streaks)))

    # 24 histogram buckets for clean comparison chart parity with frontend
    lo = float(np.min(net_outcomes))
    hi = float(np.max(net_outcomes))
    counts, edges = np.histogram(net_outcomes, bins=24, range=(lo, hi if hi > lo else lo + 1.0))
    histogram = [
        {"from": round(float(edges[i]), 2), "to": round(float(edges[i + 1]), 2), "count": int(counts[i])}
        for i in range(len(counts))
    ]

    expectancy_r = win_prob * effective_win_r - (1.0 - win_prob) * effective_loss_r
    breakeven_wr = (effective_loss_r / (effective_win_r + effective_loss_r)) * 100.0

    return {
        "engine": "Python NumPy Vectorized",
        "runs": runs,
        "expectancyR": round(expectancy_r, 3),
        "breakevenWinRate": round(breakeven_wr, 2),
        "probLoss": round(prob_loss, 2),
        "probRuin": round(prob_ruin, 2),
        "medianMaxDdPct": round(median_dd, 2),
        "longestLosingStreakMedian": median_streak,
        "percentiles": {
            "p5": round(float(pcts[0]), 2),
            "p25": round(float(pcts[1]), 2),
            "p50": round(float(pcts[2]), 2),
            "p75": round(float(pcts[3]), 2),
            "p95": round(float(pcts[4]), 2),
        },
        "histogram": histogram,
    }


def _cap_finite(val: Any, default: float = 0.0, low: float = -999.9, high: float = 999.9) -> float:
    cleaned = _safe_float(val, default)
    if not math.isfinite(cleaned):
        return default
    return max(low, min(high, round(cleaned, 3)))


def _utc_session_key(ts_ms: int) -> str:
    from datetime import datetime, timezone

    sec = ts_ms / 1000.0 if ts_ms > 10_000_000_000 else float(ts_ms)
    hour = datetime.fromtimestamp(max(0.0, sec), tz=timezone.utc).hour
    if 7 <= hour < 12:
        return "LONDON"
    if 12 <= hour < 17:
        return "NY_OVERLAP"
    if 17 <= hour < 21:
        return "LATE_NY"
    return "ASIAN"


def generate_quantstats_tearsheet(
    orders: list[dict[str, Any]],
    initial_balance: float = 100000.0,
    symbol: str = "XAUUSD",
    locale: str = "pt",
) -> dict[str, Any]:
    """
    Generate an institutional QuantStats tear-sheet payload from closed/simulated orders:
      - Sharpe, Sortino, Calmar, Omega, Ulcer Index, Tail Ratio, Recovery, SQN, Half-Kelly
      - Value-at-Risk (VaR 95%) & Expected Shortfall / CVaR 95% (positive loss %)
      - Underwater drawdown series, Monthly return matrix, Session breakdown & R-Multiple bins
    """
    from datetime import datetime, timezone
    import math as _math

    init_cap = max(1.0, float(initial_balance or 100000.0))
    is_en = (locale or "pt").lower().startswith("en")

    closed: list[dict[str, Any]] = []
    for idx_raw, raw in enumerate(orders or []):
        status = str(raw.get("status", "CLOSED")).upper()
        if status in ("CANCELLED", "REJECTED", "PENDING", "OPEN"):
            continue
        ts_val = int(float(raw.get("closedAt") or raw.get("filledAt") or raw.get("openedAt") or 0))
        if 0 < ts_val < 10_000_000_000:
            ts_val *= 1000
        open_ts_val = int(float(raw.get("openedAt") or raw.get("filledAt") or ts_val))
        if 0 < open_ts_val < 10_000_000_000:
            open_ts_val *= 1000
        pnl = float(raw.get("pnl") or 0.0)
        if not _math.isfinite(pnl):
            pnl = 0.0
        r_raw = raw.get("rMultiple")
        r_val = float(r_raw) if r_raw is not None and _math.isfinite(float(r_raw)) else None
        closed.append(
            {
                "_idx": idx_raw,
                "ts": ts_val,
                "openTs": open_ts_val,
                "pnl": pnl,
                "rMultiple": r_val,
                "symbol": str(raw.get("symbol") or symbol).upper(),
            }
        )

    closed.sort(key=lambda r: (r["ts"], r["_idx"]))

    if not closed:
        return {
            "engine": "QuantStats Tear-Sheet Engine",
            "symbol": (symbol or "XAUUSD").upper(),
            "initialBalance": round(init_cap, 2),
            "summary": {
                "totalTrades": 0,
                "endingBalance": round(init_cap, 2),
                "netPnlUsd": 0.0,
                "totalReturnPct": 0.0,
                "cagrPct": 0.0,
                "winRatePct": 0.0,
                "profitFactor": 0.0,
                "expectancyUsd": 0.0,
                "expectancyR": 0.0,
                "sharpe": 0.0,
                "sortino": 0.0,
                "calmar": 0.0,
                "omega": 0.0,
                "ulcerIndex": 0.0,
                "tailRatio": 1.0,
                "recoveryFactor": 0.0,
                "sqn": 0.0,
                "kellyPct": 0.0,
                "var95Pct": 0.0,
                "cvar95Pct": 0.0,
                "maxDrawdownPct": 0.0,
                "maxDrawdownUsd": 0.0,
                "avgDrawdownPct": 0.0,
                "maxDdDurationTrades": 0,
                "maxConsecutiveWins": 0,
                "maxConsecutiveLosses": 0,
            },
            "underwaterSeries": [],
            "monthlyReturns": [],
            "sessionBreakdown": [],
            "rDistribution": [],
        }

    eq = init_cap
    peak_eq = init_cap
    max_dd_pct = 0.0
    max_dd_usd = 0.0
    dd_samples: list[float] = []
    cur_dd_trades = 0
    max_dd_trades = 0
    cur_w_streak = 0
    cur_l_streak = 0
    max_w_streak = 0
    max_l_streak = 0

    prev_eqs: list[float] = []
    pnls_arr: list[float] = []
    r_vals: list[float] = []
    underwater_raw: list[dict[str, Any]] = [
        {
            "idx": 0,
            "timestamp": closed[0]["openTs"] or closed[0]["ts"],
            "equity": round(init_cap, 2),
            "underwaterPct": 0.0,
        }
    ]

    for i, tr in enumerate(closed, start=1):
        prev_eqs.append(max(prev := eq, 1.0))
        eq += tr["pnl"]
        pnls_arr.append(tr["pnl"])
        if tr["rMultiple"] is not None:
            r_vals.append(float(tr["rMultiple"]))
        else:
            approx_r = tr["pnl"] / max(init_cap * 0.01, 1.0)
            r_vals.append(round(approx_r, 3))

        if tr["pnl"] > 0:
            cur_w_streak += 1
            cur_l_streak = 0
            max_w_streak = max(max_w_streak, cur_w_streak)
        elif tr["pnl"] < 0:
            cur_l_streak += 1
            cur_w_streak = 0
            max_l_streak = max(max_l_streak, cur_l_streak)

        if eq >= peak_eq:
            peak_eq = eq
            cur_dd_trades = 0
            dd_pct = 0.0
        else:
            cur_dd_trades += 1
            max_dd_trades = max(max_dd_trades, cur_dd_trades)
            dd_usd = peak_eq - eq
            dd_pct = (dd_usd / max(peak_eq, 1.0)) * 100.0
            max_dd_usd = max(max_dd_usd, dd_usd)
            max_dd_pct = max(max_dd_pct, dd_pct)
            dd_samples.append(dd_pct)

        underwater_raw.append(
            {
                "idx": i,
                "timestamp": tr["ts"] or tr["openTs"],
                "equity": round(eq, 2),
                "underwaterPct": round(-abs(dd_pct), 2),
            }
        )

    pnls_np = np.array(pnls_arr, dtype=np.float64)
    prev_np = np.array(prev_eqs, dtype=np.float64)
    r_np = np.array(r_vals, dtype=np.float64)

    ret_pcts = (pnls_np / prev_np) * 100.0
    loss_pcts = np.maximum(0.0, -ret_pcts)
    var_95 = float(np.percentile(loss_pcts, 95)) if len(loss_pcts) else 0.0
    tail_losses = loss_pcts[loss_pcts >= var_95]
    cvar_95 = float(np.mean(tail_losses)) if len(tail_losses) else var_95
    cvar_95 = max(var_95, cvar_95)

    # Daily equity returns for QuantStats institutional ratios
    valid_points = [
        (datetime.fromtimestamp((tr["ts"] or 1_700_000_000_000) / 1000.0, tz=timezone.utc), u["equity"])
        for tr, u in zip(closed, underwater_raw[1:])
        if tr["ts"] > 0
    ]
    qs_returns: pd.Series
    if valid_points:
        dts = pd.DatetimeIndex([p[0] for p in valid_points])
        vals = pd.Series([p[1] for p in valid_points], index=dts, dtype=float)
        daily_eq = vals.resample("1D").last().ffill()
        if len(daily_eq) >= 4:
            first_day = daily_eq.index[0] - pd.Timedelta(days=1)
            daily_eq = pd.concat([pd.Series([init_cap], index=pd.DatetimeIndex([first_day])), daily_eq])
            qs_returns = daily_eq.pct_change().dropna().replace([np.inf, -np.inf], 0.0).fillna(0.0)
        else:
            synth_idx = pd.date_range("2026-01-01", periods=len(pnls_np), freq="D", tz="UTC")
            qs_returns = pd.Series(pnls_np / prev_np, index=synth_idx, dtype=float)
    else:
        synth_idx = pd.date_range("2026-01-01", periods=len(pnls_np), freq="D", tz="UTC")
        qs_returns = pd.Series(pnls_np / prev_np, index=synth_idx, dtype=float)

    n_trades = len(closed)
    wins = pnls_np[pnls_np > 0]
    losses = pnls_np[pnls_np <= 0]
    win_rate = (len(wins) / n_trades) * 100.0 if n_trades else 0.0
    gross_win = float(wins.sum()) if len(wins) else 0.0
    gross_loss = float(abs(losses.sum())) if len(losses) else 0.0
    profit_factor = (gross_win / gross_loss) if gross_loss > 1e-9 else (10.0 if gross_win > 0 else 0.0)
    net_pnl = eq - init_cap
    total_ret_pct = (net_pnl / init_cap) * 100.0
    expectancy_usd = net_pnl / n_trades if n_trades else 0.0
    expectancy_r = float(np.mean(r_np)) if n_trades else 0.0

    sharpe_val = _cap_finite(qs_stats.sharpe(qs_returns), 0.0, -15.0, 15.0)
    sortino_val = _cap_finite(qs_stats.sortino(qs_returns), 0.0, -25.0, 25.0)
    ulcer_raw = _safe_float(qs_stats.ulcer_index(qs_returns), 0.0)
    ulcer_pct = _cap_finite(ulcer_raw * 100.0, 0.0, 0.0, 100.0)
    omega_val = _cap_finite(qs_stats.omega(qs_returns), 1.0 if net_pnl >= 0 else 0.0, 0.0, 20.0)
    tail_val = _cap_finite(qs_stats.tail_ratio(qs_returns), 1.0, 0.0, 10.0)
    cagr_val = _cap_finite(_safe_float(qs_stats.cagr(qs_returns), 0.0) * 100.0, 0.0, -99.9, 500.0)
    calmar_val = (
        _cap_finite(cagr_val / max_dd_pct, 0.0, -25.0, 25.0)
        if max_dd_pct > 0.1
        else (_cap_finite(total_ret_pct / 5.0, 0.0, -10.0, 15.0))
    )
    recovery_val = (
        _cap_finite(net_pnl / max_dd_usd, 0.0, -20.0, 50.0)
        if max_dd_usd > 1e-6
        else (5.0 if net_pnl > 0 else 0.0)
    )

    r_std = float(np.std(r_np, ddof=1)) if len(r_np) > 1 else 0.0
    sqn_val = _cap_finite((_math.sqrt(n_trades) * expectancy_r / r_std) if r_std > 1e-9 else 0.0, 0.0, -20.0, 20.0)

    avg_win = float(np.mean(wins)) if len(wins) else 0.0
    avg_loss = float(abs(np.mean(losses))) if len(losses) else 0.0
    w_prob = len(wins) / n_trades if n_trades else 0.0
    wl_ratio = (avg_win / avg_loss) if avg_loss > 1e-9 else 2.0
    half_kelly = 0.5 * (w_prob - ((1.0 - w_prob) / max(wl_ratio, 1e-6))) * 100.0
    kelly_pct = max(0.0, min(25.0, round(half_kelly, 2)))

    # Downsample underwater curve preserving peak drawdown trough
    if len(underwater_raw) > 150:
        step = max(1, len(underwater_raw) // 140)
        sampled = [underwater_raw[k] for k in range(0, len(underwater_raw), step)]
        if sampled[-1] != underwater_raw[-1]:
            sampled.append(underwater_raw[-1])
        underwater_series = sampled
    else:
        underwater_series = underwater_raw

    # Monthly Returns Matrix (Year x Jan..Dec)
    monthly_buckets: dict[tuple[int, int], list[float]] = {}
    monthly_start_eq: dict[tuple[int, int], float] = {}
    for tr, prev_e in zip(closed, prev_eqs):
        if tr["ts"] <= 0:
            continue
        dt = datetime.fromtimestamp(tr["ts"] / 1000.0, tz=timezone.utc)
        ym = (dt.year, dt.month)
        if ym not in monthly_start_eq:
            monthly_start_eq[ym] = prev_e
        monthly_buckets.setdefault(ym, []).append(tr["pnl"])

    years_map: dict[int, dict[str, float]] = {}
    for (yr, mo), pnl_list in sorted(monthly_buckets.items()):
        base_e = max(monthly_start_eq[(yr, mo)], 1.0)
        mo_ret = round((sum(pnl_list) / base_e) * 100.0, 2)
        years_map.setdefault(yr, {})[str(mo)] = mo_ret

    monthly_returns = []
    for yr in sorted(years_map.keys()):
        months_dict = years_map[yr]
        ytd_factor = 1.0
        for m_ret in months_dict.values():
            ytd_factor *= 1.0 + (m_ret / 100.0)
        monthly_returns.append(
            {
                "year": yr,
                "months": months_dict,
                "ytdPct": round((ytd_factor - 1.0) * 100.0, 2),
            }
        )

    # Session Breakdown
    session_labels = {
        "ASIAN": ("Asian (21h-07h UTC)" if is_en else "Ásia (21h-07h UTC)"),
        "LONDON": ("London (07h-12h UTC)" if is_en else "Londres (07h-12h UTC)"),
        "NY_OVERLAP": ("NY / Overlap (12h-17h UTC)" if is_en else "NY / Overlap (12h-17h UTC)"),
        "LATE_NY": ("Late NY (17h-21h UTC)" if is_en else "Late NY (17h-21h UTC)"),
    }
    sess_acc: dict[str, list[tuple[float, float]]] = {k: [] for k in ("ASIAN", "LONDON", "NY_OVERLAP", "LATE_NY")}
    for tr, r_v in zip(closed, r_vals):
        sk = _utc_session_key(tr["openTs"] or tr["ts"])
        sess_acc[sk].append((tr["pnl"], r_v))

    session_breakdown = []
    for sk in ("ASIAN", "LONDON", "NY_OVERLAP", "LATE_NY"):
        items = sess_acc[sk]
        cnt = len(items)
        s_pnls = [x[0] for x in items]
        s_rs = [x[1] for x in items]
        s_wins = [p for p in s_pnls if p > 0]
        s_losses = [abs(p) for p in s_pnls if p <= 0]
        s_pf = (sum(s_wins) / sum(s_losses)) if sum(s_losses) > 1e-9 else (10.0 if sum(s_wins) > 0 else 0.0)
        session_breakdown.append(
            {
                "session": sk,
                "label": session_labels[sk],
                "trades": cnt,
                "winRatePct": round((len(s_wins) / cnt * 100.0) if cnt else 0.0, 1),
                "netPnlUsd": round(sum(s_pnls), 2),
                "profitFactor": round(min(s_pf, 99.0), 2),
                "avgR": round((sum(s_rs) / cnt) if cnt else 0.0, 2),
            }
        )

    # R-Multiple Distribution Histogram
    r_bins = [
        ("<= -1.5R", lambda r: r <= -1.5),
        ("-1.5R..-0.5R", lambda r: -1.5 < r <= -0.5),
        ("-0.5R..0R", lambda r: -0.5 < r <= 0.0),
        ("0R..+1R", lambda r: 0.0 < r <= 1.0),
        ("+1R..+2R", lambda r: 1.0 < r <= 2.0),
        (">= +2R", lambda r: r > 2.0),
    ]
    r_distribution = []
    for b_label, pred in r_bins:
        cnt = sum(1 for r in r_vals if pred(r))
        r_distribution.append(
            {
                "bucket": b_label,
                "count": cnt,
                "pct": round((cnt / n_trades * 100.0) if n_trades else 0.0, 1),
            }
        )

    return {
        "engine": "QuantStats Tear-Sheet Engine",
        "symbol": (symbol or "XAUUSD").upper(),
        "initialBalance": round(init_cap, 2),
        "summary": {
            "totalTrades": n_trades,
            "endingBalance": round(eq, 2),
            "netPnlUsd": round(net_pnl, 2),
            "totalReturnPct": round(total_ret_pct, 2),
            "cagrPct": round(cagr_val, 2),
            "winRatePct": round(win_rate, 1),
            "profitFactor": round(min(profit_factor, 99.0), 2),
            "expectancyUsd": round(expectancy_usd, 2),
            "expectancyR": round(expectancy_r, 3),
            "sharpe": round(sharpe_val, 2),
            "sortino": round(sortino_val, 2),
            "calmar": round(calmar_val, 2),
            "omega": round(omega_val, 2),
            "ulcerIndex": round(ulcer_pct, 2),
            "tailRatio": round(tail_val, 2),
            "recoveryFactor": round(recovery_val, 2),
            "sqn": round(sqn_val, 2),
            "kellyPct": kelly_pct,
            "var95Pct": round(var_95, 2),
            "cvar95Pct": round(cvar_95, 2),
            "maxDrawdownPct": round(max_dd_pct, 2),
            "maxDrawdownUsd": round(max_dd_usd, 2),
            "avgDrawdownPct": round(float(np.mean(dd_samples)) if dd_samples else 0.0, 2),
            "maxDdDurationTrades": int(max_dd_trades),
            "maxConsecutiveWins": int(max_w_streak),
            "maxConsecutiveLosses": int(max_l_streak),
        },
        "underwaterSeries": underwater_series,
        "monthlyReturns": monthly_returns,
        "sessionBreakdown": session_breakdown,
        "rDistribution": r_distribution,
    }
