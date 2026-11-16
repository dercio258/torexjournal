from __future__ import annotations

import json
from pathlib import Path
import sys

from fastapi.testclient import TestClient
from hypothesis import given, settings, strategies as st
import pytest

ROOT_DIR = Path(__file__).resolve().parent.parent
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from app.analytics_qs import analyze_quant_session, run_monte_carlo_vectorized, run_what_if_decimal
from app.contracts import (
    CandleBar,
    MonteCarloRequest,
    OptunaOptimizeRequest,
    OrderIntentInput,
    OrderSide,
    OrderType,
    VectorSweepRequest,
    WhatIfRequest,
    WhatIfTradeInput,
)
from app.ledger import (
    calculate_instrument_lots,
    calculate_lot_based_pnl,
    compute_replay_stats,
    create_order_from_intent,
    preview_market_execution,
    round_money,
    simulate_orders,
)
from app.main import app
from app.ohlcv_polars import ANCHOR_MS, load_resampled_ohlcv_polars
from app.vector_optuna import run_optuna_optimization, run_vector_sweep


def build_golden_vectors() -> dict:
    # 1..5: Preview & Contract sizing across XAUUSD, BTCUSD, EURUSD, USDJPY, NAS100
    preview_cases = [
        {
            "name": "v1_xauusd_buy_market",
            "input": {
                "symbol": "XAUUSD",
                "side": "BUY",
                "orderType": "MARKET",
                "bid": 2720.0,
                "requestedPrice": None,
                "balance": 100000.0,
                "riskPercent": 1.0,
                "slDistancePct": 0.5,
                "rrTarget": 2.0,
                "spread": 0.3,
                "commission": 7.0,
                "decimals": 2,
            },
        },
        {
            "name": "v2_btcusd_sell_market",
            "input": {
                "symbol": "BTCUSD",
                "side": "SELL",
                "orderType": "MARKET",
                "bid": 91200.0,
                "requestedPrice": None,
                "balance": 100000.0,
                "riskPercent": 1.0,
                "slDistancePct": 1.0,
                "rrTarget": 2.5,
                "spread": 15.0,
                "commission": 12.0,
                "decimals": 2,
            },
        },
        {
            "name": "v3_eurusd_crossed_buy_limit",
            "input": {
                "symbol": "EURUSD",
                "side": "BUY",
                "orderType": "LIMIT",
                "bid": 1.08600,
                "requestedPrice": 1.08850,
                "balance": 50000.0,
                "riskPercent": 1.0,
                "slDistancePct": 0.4,
                "rrTarget": 2.0,
                "spread": 0.00015,
                "commission": 5.0,
                "decimals": 5,
            },
        },
        {
            "name": "v4_usdjpy_crossed_sell_stop",
            "input": {
                "symbol": "USDJPY",
                "side": "SELL",
                "orderType": "STOP",
                "bid": 153.500,
                "requestedPrice": 153.900,
                "balance": 100000.0,
                "riskPercent": 1.0,
                "slDistancePct": 0.5,
                "rrTarget": 2.0,
                "spread": 0.02,
                "commission": 6.0,
                "decimals": 3,
            },
        },
        {
            "name": "v5_nas100_resting_buy_limit",
            "input": {
                "symbol": "NAS100",
                "side": "BUY",
                "orderType": "LIMIT",
                "bid": 20500.0,
                "requestedPrice": 20420.0,
                "balance": 100000.0,
                "riskPercent": 1.5,
                "slDistancePct": 0.6,
                "rrTarget": 3.0,
                "spread": 1.5,
                "commission": 4.0,
                "decimals": 2,
            },
        },
    ]

    preview_vectors = []
    for case in preview_cases:
        inp = OrderIntentInput(**case["input"])
        out = preview_market_execution(inp).model_dump()
        preview_vectors.append({"name": case["name"], "input": case["input"], "expected": out})

    # 6..12: Deterministic Replay Lifecycle & Stats Vectors
    base_ts = 1_767_225_600_000
    bars = [
        CandleBar(timestamp=base_ts, open=2720.0, high=2722.0, low=2719.0, close=2721.0, volume=100),
        CandleBar(timestamp=base_ts + 900_000, open=2721.0, high=2723.5, low=2716.0, close=2718.0, volume=120),
        CandleBar(timestamp=base_ts + 1_800_000, open=2718.0, high=2736.0, low=2717.5, close=2735.0, volume=150),
        CandleBar(timestamp=base_ts + 2_700_000, open=2735.0, high=2738.0, low=2710.0, close=2712.0, volume=160),
    ]

    # V6: BUY MARKET TP win
    o6 = create_order_from_intent(
        order_id="v6",
        symbol="XAUUSD",
        side="BUY",
        order_type="MARKET",
        price=2720.0,
        sl_distance=6.0,
        rr_ratio=2.0,
        risk_amount=1000.0,
        lots=1.67,
        opened_at=base_ts,
        decimals=2,
        spread=0.3,
        commission=7.0,
        reference_bid=2720.0,
    )
    r6 = simulate_orders([o6], bars=bars, symbol="XAUUSD", upto_ts=base_ts + 1_800_000, rewind=True)

    # V7: SELL MARKET SL loss
    btc_bars = [
        CandleBar(timestamp=base_ts, open=91200.0, high=91300.0, low=91100.0, close=91200.0, volume=50),
        CandleBar(timestamp=base_ts + 900_000, open=91200.0, high=92350.0, low=91050.0, close=92200.0, volume=80),
    ]
    o7 = create_order_from_intent(
        order_id="v7",
        symbol="BTCUSD",
        side="SELL",
        order_type="MARKET",
        price=91200.0,
        sl_distance=900.0,
        rr_ratio=2.0,
        risk_amount=1000.0,
        lots=1.11,
        opened_at=base_ts,
        decimals=2,
        spread=15.0,
        commission=10.0,
        reference_bid=91200.0,
    )
    r7 = simulate_orders([o7], bars=btc_bars, symbol="BTCUSD", upto_ts=base_ts + 900_000, rewind=True)

    # V8: Crossed BUY LIMIT above ASK -> preserves orderType='LIMIT', fills immediately at ASK, closes at TP
    eur_bars = [
        CandleBar(timestamp=base_ts, open=1.0860, high=1.0865, low=1.0858, close=1.0862, volume=200),
        CandleBar(timestamp=base_ts + 900_000, open=1.0862, high=1.0955, low=1.0859, close=1.0952, volume=220),
    ]
    o8 = create_order_from_intent(
        order_id="v8",
        symbol="EURUSD",
        side="BUY",
        order_type="LIMIT",
        price=1.0885,
        sl_distance=0.0040,
        rr_ratio=2.0,
        risk_amount=500.0,
        lots=1.25,
        opened_at=base_ts,
        decimals=5,
        spread=0.00015,
        commission=5.0,
        reference_bid=1.0860,
    )
    r8 = simulate_orders([o8], bars=eur_bars, symbol="EURUSD", upto_ts=base_ts + 900_000, rewind=True)

    # V9: Resting BUY LIMIT cancelled before fill -> CANCELLED
    o9 = create_order_from_intent(
        order_id="v9",
        symbol="XAUUSD",
        side="BUY",
        order_type="LIMIT",
        price=2705.0,
        sl_distance=6.0,
        rr_ratio=2.0,
        risk_amount=1000.0,
        lots=1.67,
        opened_at=base_ts,
        decimals=2,
        spread=0.3,
        commission=7.0,
        reference_bid=2720.0,
    )
    o9["cancelledAt"] = base_ts + 900_000
    r9 = simulate_orders([o9], bars=bars, symbol="XAUUSD", upto_ts=base_ts + 2_700_000, rewind=False)

    # V10: Non-rewind finalized order immutability (frozen WIN even if different bars passed)
    frozen_win = {
        "id": "v10",
        "symbol": "XAUUSD",
        "side": "BUY",
        "orderType": "LIMIT",
        "entryPrice": 2710.0,
        "stopLoss": 2700.0,
        "initialStopLoss": 2700.0,
        "takeProfit": 2730.0,
        "lots": 1.0,
        "riskAmount": 1000.0,
        "rrRatio": 2.0,
        "spread": 0.2,
        "commission": 7.0,
        "status": "WIN",
        "exitPrice": 2730.0,
        "exitReason": "TP",
        "pnl": 1993.0,
        "rMultiple": 2.0,
        "mfe": 2000.0,
        "mae": 120.0,
        "openedAt": base_ts,
        "filledAt": base_ts + 300_000,
        "closedAt": base_ts + 900_000,
    }
    r10 = simulate_orders([frozen_win], bars=bars, symbol="XAUUSD", upto_ts=base_ts + 2_700_000, rewind=False)

    # V11: Rewind before close restores OPEN state from closed order
    r11 = simulate_orders([frozen_win], bars=bars, symbol="XAUUSD", upto_ts=base_ts + 1_800_000, rewind=True)

    # V12: compute_replay_stats chronological drawdown & CANCELLED exclusion
    stats_orders = [
        {
            "id": "s1", "symbol": "XAUUSD", "side": "BUY", "orderType": "MARKET",
            "entryPrice": 2700.0, "stopLoss": 2690.0, "takeProfit": 2720.0,
            "lots": 1.0, "riskAmount": 1000.0, "rrRatio": 2.0,
            "status": "WIN", "pnl": 2000.0, "rMultiple": 2.0, "mfe": 2000.0, "mae": 0.0,
            "openedAt": base_ts, "closedAt": base_ts + 900_000,
        },
        {
            "id": "s2", "symbol": "XAUUSD", "side": "SELL", "orderType": "MARKET",
            "entryPrice": 2720.0, "stopLoss": 2730.0, "takeProfit": 2700.0,
            "lots": 1.0, "riskAmount": 1000.0, "rrRatio": 2.0,
            "status": "LOSS", "pnl": -1000.0, "rMultiple": -1.0, "mfe": 0.0, "mae": 1000.0,
            "openedAt": base_ts + 900_000, "closedAt": base_ts + 1_800_000,
        },
        {
            "id": "s3", "symbol": "XAUUSD", "side": "BUY", "orderType": "MARKET",
            "entryPrice": 2710.0, "stopLoss": 2700.0, "takeProfit": 2730.0,
            "lots": 1.0, "riskAmount": 1000.0, "rrRatio": 2.0,
            "status": "WIN", "pnl": 1500.0, "rMultiple": 1.5, "mfe": 1500.0, "mae": 0.0,
            "openedAt": base_ts + 1_800_000, "closedAt": base_ts + 2_700_000,
        },
        {
            "id": "s4", "symbol": "XAUUSD", "side": "BUY", "orderType": "LIMIT",
            "entryPrice": 2680.0, "stopLoss": 2670.0, "takeProfit": 2700.0,
            "lots": 1.0, "riskAmount": 1000.0, "rrRatio": 2.0,
            "status": "CANCELLED", "pnl": 0.0, "rMultiple": 0.0, "mfe": 0.0, "mae": 0.0,
            "openedAt": base_ts + 2_700_000, "cancelledAt": base_ts + 3_000_000,
        },
    ]
    s12 = compute_replay_stats(stats_orders, 100000.0).model_dump()

    return {
        "previewVectors": preview_vectors,
        "replayVectors": [
            {
                "name": "v6_xauusd_buy_market_tp_win",
                "intent": {
                    "id": "v6", "symbol": "XAUUSD", "side": "BUY", "orderType": "MARKET",
                    "price": 2720.0, "slDistance": 6.0, "rrRatio": 2.0, "riskAmount": 1000.0,
                    "lots": 1.67, "openedAt": base_ts, "decimals": 2, "spread": 0.3,
                    "commission": 7.0, "referenceBid": 2720.0,
                },
                "bars": [b.model_dump() for b in bars],
                "uptoTs": base_ts + 1_800_000,
                "rewind": True,
                "expectedOrder": r6[0],
            },
            {
                "name": "v7_btcusd_sell_market_sl_loss",
                "intent": {
                    "id": "v7", "symbol": "BTCUSD", "side": "SELL", "orderType": "MARKET",
                    "price": 91200.0, "slDistance": 900.0, "rrRatio": 2.0, "riskAmount": 1000.0,
                    "lots": 1.11, "openedAt": base_ts, "decimals": 2, "spread": 15.0,
                    "commission": 10.0, "referenceBid": 91200.0,
                },
                "bars": [b.model_dump() for b in btc_bars],
                "uptoTs": base_ts + 900_000,
                "rewind": True,
                "expectedOrder": r7[0],
            },
            {
                "name": "v8_eurusd_crossed_buy_limit_immediate_tp",
                "intent": {
                    "id": "v8", "symbol": "EURUSD", "side": "BUY", "orderType": "LIMIT",
                    "price": 1.0885, "slDistance": 0.0040, "rrRatio": 2.0, "riskAmount": 500.0,
                    "lots": 1.25, "openedAt": base_ts, "decimals": 5, "spread": 0.00015,
                    "commission": 5.0, "referenceBid": 1.0860,
                },
                "bars": [b.model_dump() for b in eur_bars],
                "uptoTs": base_ts + 900_000,
                "rewind": True,
                "expectedOrder": r8[0],
            },
            {
                "name": "v9_xauusd_pending_limit_cancelled",
                "intent": {
                    "id": "v9", "symbol": "XAUUSD", "side": "BUY", "orderType": "LIMIT",
                    "price": 2705.0, "slDistance": 6.0, "rrRatio": 2.0, "riskAmount": 1000.0,
                    "lots": 1.67, "openedAt": base_ts, "decimals": 2, "spread": 0.3,
                    "commission": 7.0, "referenceBid": 2720.0,
                    "cancelledAt": base_ts + 900_000,
                },
                "bars": [b.model_dump() for b in bars],
                "uptoTs": base_ts + 2_700_000,
                "rewind": False,
                "expectedOrder": r9[0],
            },
            {
                "name": "v10_non_rewind_finalized_immutability",
                "inputOrder": frozen_win,
                "bars": [b.model_dump() for b in bars],
                "uptoTs": base_ts + 2_700_000,
                "rewind": False,
                "expectedOrder": r10[0],
            },
            {
                "name": "v11_rewind_preserves_open_trade",
                "inputOrder": frozen_win,
                "bars": [b.model_dump() for b in bars],
                "uptoTs": base_ts + 1_800_000,
                "rewind": True,
                "expectedOrder": r11[0],
            },
        ],
        "statsVector": {
            "name": "v12_stats_chronological_and_cancelled_excluded",
            "initialBalance": 100000.0,
            "orders": stats_orders,
            "expectedStats": s12,
        },
    }


def test_p0_1_finalized_immutability_and_rewind():
    base_ts = ANCHOR_MS
    bars = [
        CandleBar(timestamp=base_ts, open=2720.0, high=2721.0, low=2719.0, close=2720.0),
        CandleBar(timestamp=base_ts + 900_000, open=2720.0, high=2720.5, low=2690.0, close=2695.0),
    ]
    historical_win = {
        "id": "ord-win-1",
        "symbol": "XAUUSD",
        "side": "BUY",
        "orderType": "LIMIT",
        "entryPrice": 2710.0,
        "stopLoss": 2700.0,
        "initialStopLoss": 2700.0,
        "takeProfit": 2730.0,
        "lots": 1.0,
        "riskAmount": 1000.0,
        "rrRatio": 2.0,
        "spread": 0.2,
        "commission": 7.0,
        "status": "WIN",
        "exitPrice": 2730.0,
        "exitReason": "TP",
        "pnl": 1993.0,
        "rMultiple": 2.0,
        "mfe": 2000.0,
        "mae": -150.0,  # legacy negative MAE normalized on load
        "openedAt": base_ts - 3_600_000,
        "filledAt": base_ts - 1_800_000,
        "closedAt": base_ts - 60_000,
    }
    res = simulate_orders([historical_win], bars=bars, symbol="XAUUSD", upto_ts=base_ts + 900_000, rewind=False)
    assert res[0]["status"] == "WIN"
    assert res[0]["pnl"] == 1993.0
    assert res[0]["mae"] == 150.0


def test_p0_2_crossed_limit_stop_immediate_fill_preserves_type():
    buy_lim = create_order_from_intent(
        order_id="bl-cross",
        symbol="XAUUSD",
        side="BUY",
        order_type="LIMIT",
        price=2725.0,
        sl_distance=5.0,
        rr_ratio=2.0,
        risk_amount=1000.0,
        lots=2.0,
        opened_at=ANCHOR_MS,
        spread=0.3,
        commission=7.0,
        reference_bid=2720.0,
    )
    assert buy_lim["orderType"] == "LIMIT"
    assert buy_lim["status"] == "OPEN"
    assert buy_lim["entryPrice"] == 2720.3

    sell_lim = create_order_from_intent(
        order_id="sl-cross",
        symbol="BTCUSD",
        side="SELL",
        order_type="LIMIT",
        price=90000.0,
        sl_distance=500.0,
        rr_ratio=2.0,
        risk_amount=1000.0,
        lots=2.0,
        opened_at=ANCHOR_MS,
        spread=15.0,
        commission=10.0,
        reference_bid=91200.0,
    )
    assert sell_lim["orderType"] == "LIMIT"
    assert sell_lim["status"] == "OPEN"
    assert sell_lim["entryPrice"] == 91200.0


def test_p0_3_decimal_lot_pnl_exact_cents_and_stats_p0_4():
    # XAUUSD: 1.50 lots = 150 oz; +$12.00 move = +$1,800.00 gross - $7.00 comm = $1,793.00
    assert calculate_lot_based_pnl("XAUUSD", "BUY", 2700.0, 2712.0, 1.50, 7.0) == 1793.00
    # EURUSD: 2.00 lots = 200,000 units; +0.0050 move = +$1,000.00 - $5.00 = $995.00
    assert calculate_lot_based_pnl("EURUSD", "BUY", 1.08000, 1.08500, 2.00, 5.0) == 995.00

    orders = [
        {"id": "1", "symbol": "XAUUSD", "side": "BUY", "orderType": "MARKET", "entryPrice": 2700, "status": "WIN", "pnl": 2000.0, "rMultiple": 2.0, "openedAt": 1, "closedAt": 2},
        {"id": "2", "symbol": "XAUUSD", "side": "BUY", "orderType": "MARKET", "entryPrice": 2710, "status": "LOSS", "pnl": -1000.0, "rMultiple": -1.0, "openedAt": 3, "closedAt": 4},
        {"id": "3", "symbol": "XAUUSD", "side": "BUY", "orderType": "LIMIT", "entryPrice": 2650, "status": "CANCELLED", "pnl": 0.0, "rMultiple": 0.0, "openedAt": 5, "cancelledAt": 6},
    ]
    st_res = compute_replay_stats(orders, 100_000.0)
    assert st_res.trades == 2
    assert st_res.winRate == 50.0
    assert st_res.netProfit == 1000.0
    assert st_res.realizedBalance == 101_000.0


@given(
    symbol=st.sampled_from(["XAUUSD", "BTCUSD", "EURUSD", "GBPUSD", "USDJPY", "NAS100"]),
    side=st.sampled_from(["BUY", "SELL"]),
    lots=st.floats(min_value=0.01, max_value=25.0, allow_nan=False, allow_infinity=False),
    entry=st.floats(min_value=1.05, max_value=95000.0, allow_nan=False, allow_infinity=False),
    move_pct=st.floats(min_value=0.0005, max_value=0.05, allow_nan=False, allow_infinity=False),
    commission=st.floats(min_value=0.0, max_value=50.0, allow_nan=False, allow_infinity=False),
)
@settings(max_examples=80, deadline=None)
def test_hypothesis_lot_pnl_commission_conservation(symbol, side, lots, entry, move_pct, commission):
    lots_q = round_money(lots)
    fav_exit = entry * (1.0 + move_pct) if side == "BUY" else entry * (1.0 - move_pct)
    adv_exit = entry * (1.0 - move_pct) if side == "BUY" else entry * (1.0 + move_pct)

    gross_win = calculate_lot_based_pnl(symbol, side, entry, fav_exit, lots_q, 0.0)
    net_win = calculate_lot_based_pnl(symbol, side, entry, fav_exit, lots_q, commission)
    gross_loss = calculate_lot_based_pnl(symbol, side, entry, adv_exit, lots_q, 0.0)

    assert gross_win >= 0.0
    assert gross_loss <= 0.0
    assert abs((gross_win - round_money(commission)) - net_win) <= 0.02


def test_polars_deterministic_ohlcv_and_analytics():
    df_a = load_resampled_ohlcv_polars("XAUUSD", "15m", to_ts=ANCHOR_MS + 40 * 86_400_000, limit=300, with_indicators=True)
    df_b = load_resampled_ohlcv_polars("XAUUSD", "15m", to_ts=ANCHOR_MS + 41 * 86_400_000, limit=500)
    assert len(df_a) == 300
    assert "ema_fast" in df_a.columns and "rsi" in df_a.columns and "atr" in df_a.columns
    # Same timestamps across different right-hand cursors MUST have identical prices
    joined = df_a.join(df_b, on="timestamp", how="inner", suffix="_b")
    assert len(joined) >= 200
    assert (joined["close"] - joined["close_b"]).abs().max() == 0.0


def test_vectorbt_sweep_and_optuna_walkforward():
    sweep_req = VectorSweepRequest(
        symbol="XAUUSD",
        timeframe="15m",
        barsCount=1200,
        strategyFamily="SMC_DONCHIAN_ATR",
        fastValues=[8, 12, 16, 20, 26],
        slowValues=[30, 42, 60, 84, 110],
        rrValues=[1.5, 2.0, 2.5],
        slAtrValues=[1.2, 1.8],
        topK=8,
    )
    sweep_res = run_vector_sweep(sweep_req)
    assert sweep_res.totalCombinations == 150
    assert len(sweep_res.topConfigs) == 8
    assert len(sweep_res.heatmapCells) == 25
    assert sweep_res.combinationsPerSec > 0

    opt_req = OptunaOptimizeRequest(
        symbol="BTCUSD",
        timeframe="15m",
        barsCount=1500,
        strategyFamily="EMA_CROSS_RSI",
        nTrials=12,
        trainRatio=0.70,
        seed=42,
    )
    opt_res = run_optuna_optimization(opt_req)
    assert opt_res.nTrialsCompleted == 12
    assert opt_res.trainBars + opt_res.testBars == opt_res.barsProcessed
    assert len(opt_res.paramImportances) > 0
    assert len(opt_res.equityCurve) > 10


def test_fastapi_endpoints_and_write_golden_vectors():
    client = TestClient(app)
    r_health = client.get("/api/quant/health")
    assert r_health.status_code == 200
    assert r_health.json()["status"] == "ok"

    r_ohlcv = client.get("/api/quant/ohlcv", params={"symbol": "XAUUSD", "timeframe": "15m", "limit": 120, "indicators": True})
    assert r_ohlcv.status_code == 200
    assert len(r_ohlcv.json()["candles"]) == 120

    r_whatif = client.post(
        "/api/quant/simulate/what-if",
        json=WhatIfRequest(
            initialBalance=100000,
            riskPerTrade=1.0,
            rrTarget=2.0,
            trades=[
                WhatIfTradeInput(ticket="1", symbol="XAUUSD", profit=500.0, session="London"),
                WhatIfTradeInput(ticket="2", symbol="XAUUSD", profit=-250.0, session="New York"),
                WhatIfTradeInput(ticket="3", symbol="EURUSD", profit=400.0, session="Tokyo"),
            ],
            excludeAsian=True,
        ).model_dump(),
    )
    assert r_whatif.status_code == 200
    whatif_data = r_whatif.json()
    assert whatif_data["comparison"]["excludedTrades"] == 1
    # Trade 1 (+500) -> +2% = $102,000; Trade 2 (-250) -> -1% of $102,000 = -$1,020 => Net +$980.00
    assert whatif_data["comparison"]["simulatedNetProfit"] == 980.0

    r_mc = client.post("/api/quant/simulate/monte-carlo", json=MonteCarloRequest(capital=100000, runs=300, trades=50).model_dump())
    assert r_mc.status_code == 200
    assert r_mc.json()["runs"] == 300

    golden = build_golden_vectors()
    assert len(golden["previewVectors"]) == 5
    assert len(golden["replayVectors"]) == 6
    out_path = ROOT_DIR / "golden_vectors.json"
    out_path.write_text(json.dumps(golden, indent=2), encoding="utf-8")
    assert out_path.exists()
