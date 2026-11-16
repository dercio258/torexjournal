from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
import sys

from fastapi.testclient import TestClient
import numpy as np
import polars as pl
import pytest

ROOT_DIR = Path(__file__).resolve().parent.parent
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from app import market_data_parquet
from app.analytics_qs import generate_quantstats_tearsheet
from app.main import app
from app.realistic_sim import build_session_entry_mask, run_realistic_bar_simulation

client = TestClient(app)


def test_real_parquet_ingest_sanitize_catalog_and_resample(tmp_path, monkeypatch):
    monkeypatch.setattr(market_data_parquet, "REAL_DATA_DIR", tmp_path)

    base_ts = int(datetime(2026, 2, 2, 0, 0, tzinfo=timezone.utc).timestamp() * 1000)
    candles = []
    px = 2700.0
    for i in range(160):
        px += 0.8 if (i % 3 != 0) else -0.4
        o = px
        c = px + (0.6 if i % 2 == 0 else -0.3)
        # Deliberately invert high/low on every 10th candle to test sanitizer invariant enforcement
        if i % 10 == 0:
            h = min(o, c) - 1.5
            l = max(o, c) + 1.5
        else:
            h = max(o, c) + 1.2
            l = min(o, c) - 1.1
        candles.append(
            {
                "timestamp": base_ts + i * 900_000,
                "open": round(o, 2),
                "high": round(h, 2),
                "low": round(l, 2),
                "close": round(c, 2),
                "volume": 100.0 + i,
            }
        )

    # Inject duplicate & out-of-order rows
    candles.append(dict(candles[5]))
    candles[10], candles[2] = candles[2], candles[10]

    resp = client.post(
        "/api/quant/market-data/sync",
        json={
            "symbol": "TESTXAU",
            "timeframe": "15m",
            "sourcePreference": "MT5_TV",
            "candles": candles,
        },
    )
    assert resp.status_code == 200
    sync_data = resp.json()
    assert sync_data["isRealMarket"] is True
    assert sync_data["barsCount"] == 160
    assert sync_data["diagnostics"]["duplicatesRemoved"] >= 1
    assert sync_data["diagnostics"]["anomaliesFixed"] >= 1
    assert (tmp_path / "TESTXAU_15m.parquet").exists()
    assert (tmp_path / "TESTXAU_15m.meta.json").exists()

    cat_resp = client.get("/api/quant/market-data/catalog")
    assert cat_resp.status_code == 200
    cat = cat_resp.json()
    assert cat["realDatasetsCount"] == 1
    assert cat["datasets"][0]["symbol"] == "TESTXAU"

    ohlcv_resp = client.get("/api/quant/ohlcv?symbol=TESTXAU&timeframe=15m&limit=200&source=real")
    assert ohlcv_resp.status_code == 200
    ohlcv = ohlcv_resp.json()
    assert ohlcv["isRealMarket"] is True
    assert ohlcv["count"] == 160
    prev_ts = 0
    for bar in ohlcv["candles"]:
        assert bar["timestamp"] > prev_ts
        prev_ts = bar["timestamp"]
        assert bar["high"] >= max(bar["open"], bar["close"])
        assert bar["low"] <= min(bar["open"], bar["close"])

    # Verify Polars 15m -> 1h resampling from the real Parquet file
    resamp_resp = client.get("/api/quant/ohlcv?symbol=TESTXAU&timeframe=1h&limit=100&source=real")
    assert resamp_resp.status_code == 200
    resamp = resamp_resp.json()
    assert resamp["isRealMarket"] is True
    assert 35 <= resamp["count"] <= 45
    assert "resampled-15m" in resamp["dataProvider"]


def test_session_killzone_mask_and_friday_cutoff():
    # Friday 2026-02-06 at 02:00 (Asia), 09:00 (London), 14:00 (NY), 18:00 (Late NY), 20:00 (Friday late)
    hours = [2, 9, 14, 18, 20]
    ts = np.array(
        [int(datetime(2026, 2, 6, h, 0, tzinfo=timezone.utc).timestamp() * 1000) for h in hours],
        dtype=np.int64,
    )
    assert list(build_session_entry_mask(ts, "ALL", False)) == [True, True, True, True, True]
    assert list(build_session_entry_mask(ts, "LONDON_ONLY", False)) == [False, True, False, False, False]
    assert list(build_session_entry_mask(ts, "NY_ONLY", False)) == [False, False, True, False, False]
    assert list(build_session_entry_mask(ts, "LONDON_NY", False)) == [False, True, True, False, False]
    assert list(build_session_entry_mask(ts, "NO_ASIA", False)) == [False, True, True, True, True]
    assert list(build_session_entry_mask(ts, "ALL", True)) == [True, True, True, True, False]
    assert list(build_session_entry_mask(ts, "NO_ASIA", True)) == [False, True, True, True, False]


def test_realistic_simulator_friction_sl_first_and_session_filtering():
    # 1) Direct unit test for conservative SL-first intrabar tie-breaking
    n = 40
    base_ts = int(datetime(2026, 2, 3, 8, 0, tzinfo=timezone.utc).timestamp() * 1000)
    timestamps = [base_ts + i * 900_000 for i in range(n)]
    opens = [2700.0] * n
    highs = [2701.0] * n
    lows = [2699.0] * n
    closes = [2700.0] * n
    # Bar 11 triggers huge wick hitting BOTH SL and TP on a BUY entered on Bar 11 open
    highs[11] = 2780.0
    lows[11] = 2620.0
    closes[11] = 2705.0

    df = pl.DataFrame(
        {
            "timestamp": timestamps,
            "open": opens,
            "high": highs,
            "low": lows,
            "close": closes,
            "volume": [100.0] * n,
        }
    )
    long_sig = np.zeros(n, dtype=np.bool_)
    short_sig = np.zeros(n, dtype=np.bool_)
    atr_arr = np.full(n, 2.0, dtype=np.float64)
    long_sig[10] = True  # Fill at bar 11 open

    res = run_realistic_bar_simulation(
        df=df,
        symbol="XAUUSD",
        rr_target=2.0,
        sl_atr_mult=1.5,
        slippage_bps=0.0,
        spread_pct=0.0,
        commission_pct=0.0,
        raw_long_signals=long_sig,
        raw_short_signals=short_sig,
        atr_override=atr_arr,
    )
    assert len(res["orders"]) == 1
    assert res["orders"][0]["exitReason"] == "SL"
    assert res["summary"].totalSlippageCostUsd == 0.0

    # 2) Endpoint test comparing zero vs non-zero slippage + LONDON_NY filtering
    r_zero = client.post(
        "/api/quant/simulate/realistic",
        json={
            "symbol": "XAUUSD",
            "timeframe": "15m",
            "barsCount": 800,
            "dataMode": "SYNTHETIC",
            "sessionFilter": "ALL",
            "slippageBps": 0.0,
            "spreadPct": 0.0,
        },
    )
    assert r_zero.status_code == 200
    d_zero = r_zero.json()
    assert d_zero["summary"]["totalSlippageCostUsd"] == 0.0
    assert d_zero["summary"]["totalSpreadCostUsd"] == 0.0

    r_real = client.post(
        "/api/quant/simulate/realistic",
        json={
            "symbol": "XAUUSD",
            "timeframe": "15m",
            "barsCount": 800,
            "dataMode": "SYNTHETIC",
            "sessionFilter": "LONDON_NY",
            "avoidFridayLate": True,
            "slippageBps": 3.0,
            "spreadPct": 0.00025,
        },
    )
    assert r_real.status_code == 200
    d_real = r_real.json()
    assert d_real["summary"]["signalsFilteredBySession"] >= 0
    if d_real["summary"]["totalTrades"] > 0:
        assert d_real["summary"]["totalSlippageCostUsd"] > 0.0
        assert d_real["summary"]["totalFrictionUsd"] > 0.0


def test_vector_sweep_and_optuna_realistic_triple_verification():
    sweep_resp = client.post(
        "/api/quant/vector-sweep",
        json={
            "symbol": "XAUUSD",
            "timeframe": "15m",
            "barsCount": 600,
            "strategyFamily": "SMC_DONCHIAN_ATR",
            "fastValues": [8, 14],
            "slowValues": [30, 50],
            "rrValues": [2.0],
            "slAtrValues": [1.5],
            "sessionFilter": "LONDON_NY",
            "slippageBps": 1.5,
            "dataMode": "SYNTHETIC",
            "topK": 4,
        },
    )
    assert sweep_resp.status_code == 200
    sw = sweep_resp.json()
    assert sw["sessionFilter"] == "LONDON_NY"
    assert sw["totalCombinations"] == 4
    assert len(sw["topConfigs"]) > 0

    opt_resp = client.post(
        "/api/quant/optimize",
        json={
            "symbol": "XAUUSD",
            "timeframe": "15m",
            "barsCount": 600,
            "strategyFamily": "SMC_DONCHIAN_ATR",
            "nTrials": 8,
            "sessionFilter": "LONDON_NY",
            "avoidFridayLate": True,
            "slippageBps": 1.5,
            "dataMode": "SYNTHETIC",
            "verifyRealistic": True,
        },
    )
    assert opt_resp.status_code == 200
    opt = opt_resp.json()
    assert opt["nTrialsCompleted"] == 8
    assert opt["sessionFilter"] == "LONDON_NY"
    assert opt["realisticVerification"] is not None
    assert "totalFrictionUsd" in opt["realisticVerification"]
    assert "signalsFilteredBySession" in opt["realisticVerification"]
    if opt["realisticOrdersCount"] > 0:
        assert opt["realisticTearsheet"] is not None
        assert opt["realisticTearsheet"]["summary"]["cvar95Pct"] >= opt["realisticTearsheet"]["summary"]["var95Pct"]


def test_quantstats_tearsheet_invariants_and_endpoint():
    sample_orders = [
        {"id": "1", "symbol": "XAUUSD", "status": "CLOSED", "pnl": 1450.0, "rMultiple": 1.8, "openedAt": int(datetime(2026, 1, 5, 2, 0, tzinfo=timezone.utc).timestamp() * 1000), "closedAt": int(datetime(2026, 1, 5, 4, 0, tzinfo=timezone.utc).timestamp() * 1000)},
        {"id": "2", "symbol": "XAUUSD", "status": "CLOSED", "pnl": -950.0, "rMultiple": -1.0, "openedAt": int(datetime(2026, 1, 8, 9, 0, tzinfo=timezone.utc).timestamp() * 1000), "closedAt": int(datetime(2026, 1, 8, 11, 0, tzinfo=timezone.utc).timestamp() * 1000)},
        {"id": "3", "symbol": "XAUUSD", "status": "CLOSED", "pnl": 2100.0, "rMultiple": 2.1, "openedAt": int(datetime(2026, 1, 14, 14, 0, tzinfo=timezone.utc).timestamp() * 1000), "closedAt": int(datetime(2026, 1, 14, 16, 0, tzinfo=timezone.utc).timestamp() * 1000)},
        {"id": "4", "symbol": "XAUUSD", "status": "CLOSED", "pnl": -1200.0, "rMultiple": -1.2, "openedAt": int(datetime(2026, 2, 3, 18, 0, tzinfo=timezone.utc).timestamp() * 1000), "closedAt": int(datetime(2026, 2, 3, 19, 0, tzinfo=timezone.utc).timestamp() * 1000)},
        {"id": "5", "symbol": "XAUUSD", "status": "CLOSED", "pnl": 1800.0, "rMultiple": 1.8, "openedAt": int(datetime(2026, 2, 10, 10, 0, tzinfo=timezone.utc).timestamp() * 1000), "closedAt": int(datetime(2026, 2, 10, 12, 0, tzinfo=timezone.utc).timestamp() * 1000)},
    ]

    resp = client.post(
        "/api/quant/tearsheet",
        json={"orders": sample_orders, "initialBalance": 100000.0, "symbol": "XAUUSD", "locale": "pt"},
    )
    assert resp.status_code == 200
    ts = resp.json()
    s = ts["summary"]
    assert s["totalTrades"] == 5
    assert s["cvar95Pct"] >= s["var95Pct"] >= 0.0
    assert s["endingBalance"] == pytest.approx(103200.0, abs=0.01)
    assert len(ts["monthlyReturns"]) == 1
    assert ts["monthlyReturns"][0]["year"] == 2026
    assert set(ts["monthlyReturns"][0]["months"].keys()) == {"1", "2"}
    assert len(ts["sessionBreakdown"]) == 4
    assert sum(b["count"] for b in ts["rDistribution"]) == 5
    assert all(pt["underwaterPct"] <= 0.0 for pt in ts["underwaterSeries"])
