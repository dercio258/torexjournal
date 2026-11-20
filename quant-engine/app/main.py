from __future__ import annotations

from contextlib import asynccontextmanager
import base64
import hashlib
import hmac
import json
import math
import os
import threading
import time
from typing import Literal, Optional

from fastapi import FastAPI, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .analytics_qs import (
    analyze_quant_session,
    generate_quantstats_tearsheet,
    run_monte_carlo_vectorized,
    run_what_if_decimal,
)
from .behavior_ml import (
    AnalyzeImportedTradesRequest,
    AnalyzeImportedTradesResponse,
    BehaviorAnalyticsResponse,
    BehaviorModelStatusResponse,
    behavior_ml_engine,
)
from .contracts import (
    MarketDataCatalogResponse,
    MarketDataSyncRequest,
    MarketDataSyncResponse,
    MarketExecutionPreview,
    MonteCarloRequest,
    OptunaOptimizeRequest,
    OptunaOptimizeResponse,
    OrderIntentInput,
    RealisticSimRequest,
    RealisticSimResponse,
    ReconcileSessionRequest,
    ReconcileSessionResponse,
    TearSheetRequest,
    VectorSweepRequest,
    VectorSweepResponse,
    WhatIfRequest,
)
from .ledger import compute_replay_stats, preview_market_execution, simulate_orders
from .market_data_parquet import get_parquet_catalog, sync_market_data_parquet
from .ohlcv_polars import load_ohlcv_with_source, load_resampled_ohlcv_polars, normalize_timeframe
from .realistic_sim import run_realistic_bar_simulation
from .vector_optuna import run_optuna_optimization, run_vector_sweep, warmup_vectorbt


@asynccontextmanager
async def _lifespan(_: FastAPI):
    warmup_vectorbt()
    yield


app = FastAPI(
    title="Torex Quant Engine",
    version="2.0.0",
    description="Hybrid Precision Quant & Backtest Engine (Decimal + Polars + DuckDB + VectorBT + Optuna + QuantStats + PyTorch)",
    lifespan=_lifespan,
)


def _resolve_cors_origins() -> list[str]:
    raw = os.getenv(
        "QUANT_CORS_ORIGINS",
        "http://localhost:5173,http://127.0.0.1:5173,http://localhost:3010,http://127.0.0.1:3010",
    )
    origins = [item.strip().rstrip("/") for item in raw.split(",") if item.strip()]
    return origins or ["http://localhost:5173", "http://127.0.0.1:5173"]


def _b64url_decode(segment: str) -> bytes:
    padded = segment + "=" * ((4 - len(segment) % 4) % 4)
    return base64.urlsafe_b64decode(padded.encode("ascii"))


def _verify_hs256_jwt(token: str, secret: str) -> bool:
    parts = token.split(".")
    if len(parts) != 3 or not all(parts):
        return False
    header_b64, payload_b64, sig_b64 = parts
    try:
        header = json.loads(_b64url_decode(header_b64).decode("utf-8"))
        if not isinstance(header, dict) or header.get("alg") != "HS256":
            return False
        signing_input = f"{header_b64}.{payload_b64}".encode("ascii")
        expected_sig = hmac.new(
            secret.encode("utf-8"),
            signing_input,
            hashlib.sha256,
        ).digest()
        actual_sig = _b64url_decode(sig_b64)
        if not hmac.compare_digest(actual_sig, expected_sig):
            return False
        payload = json.loads(_b64url_decode(payload_b64).decode("utf-8"))
        if not isinstance(payload, dict):
            return False
        exp = payload.get("exp")
        if exp is None or float(exp) <= time.time():
            return False
        return True
    except Exception:
        return False


@app.middleware("http")
async def quant_auth_middleware(request: Request, call_next):
    path = request.url.path
    if request.method == "OPTIONS" or path in ("/health", "/api/quant/health"):
        return await call_next(request)

    if path.startswith("/api/quant/") or path.startswith("/api/ml/"):
        internal_key = (os.getenv("QUANT_INTERNAL_KEY") or "").strip()
        jwt_secret = (os.getenv("JWT_SECRET") or "").strip()
        enforce_flag = (os.getenv("QUANT_ENFORCE_AUTH") or "").strip().lower() in (
            "1",
            "true",
            "yes",
        )
        is_prod = (
            os.getenv("NODE_ENV") or os.getenv("ENV") or ""
        ).strip().lower() == "production"

        if bool(internal_key) or enforce_flag or is_prod:
            if not internal_key and not jwt_secret:
                return JSONResponse(
                    status_code=503,
                    content={"detail": "Quant Engine authentication not configured"},
                )

            provided_internal = (request.headers.get("x-internal-key") or "").strip()
            if (
                internal_key
                and provided_internal
                and hmac.compare_digest(provided_internal, internal_key)
            ):
                return await call_next(request)

            auth_header = (request.headers.get("authorization") or "").strip()
            if (
                jwt_secret
                and auth_header.lower().startswith("bearer ")
                and _verify_hs256_jwt(auth_header[7:].strip(), jwt_secret)
            ):
                return await call_next(request)

            return JSONResponse(status_code=401, content={"detail": "Unauthorized"})

    return await call_next(request)


app.add_middleware(
    CORSMiddleware,
    allow_origins=_resolve_cors_origins(),
    allow_credentials=True,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-Internal-Key"],
)


@app.get("/health")
@app.get("/api/quant/health")
def health():
    return {
        "status": "ok",
        "service": "torex-quant-engine",
        "stack": [
            "FastAPI",
            "Decimal",
            "Polars",
            "DuckDB",
            "PyArrow",
            "VectorBT",
            "Optuna",
            "QuantStats",
            "PyTorch-BehaviorML",
            "LightGBM-HybridEnsemble",
        ],
    }


@app.get("/api/quant/ohlcv")
def get_ohlcv(
    symbol: str = Query(default="XAUUSD"),
    timeframe: str = Query(default="15m"),
    from_ts: Optional[int] = Query(default=None, alias="from"),
    to_ts: Optional[int] = Query(default=None, alias="to"),
    limit: int = Query(default=1000, ge=10, le=25000),
    indicators: bool = Query(default=False),
    source: Literal["synthetic", "real", "auto"] = Query(default="auto"),
):
    norm_tf, step_ms = normalize_timeframe(timeframe)
    data_mode = source.upper()
    df, data_provider, is_real = load_ohlcv_with_source(
        symbol=symbol,
        timeframe=norm_tf,
        from_ts=from_ts,
        to_ts=to_ts,
        limit=limit,
        with_indicators=indicators,
        data_mode=data_mode,
        auto_sync_if_missing=(data_mode == "REAL"),
    )
    candles = []
    for row in df.to_dicts():
        clean_row = {}
        for k, v in row.items():
            if isinstance(v, float) and not math.isfinite(v):
                clean_row[k] = None
            else:
                clean_row[k] = v
        candles.append(clean_row)

    earliest = int(candles[0]["timestamp"]) if candles else None
    latest = int(candles[-1]["timestamp"]) if candles else None
    return {
        "symbol": symbol.upper(),
        "timeframe": norm_tf,
        "count": len(candles),
        "earliestTs": earliest,
        "latestTs": latest,
        "nextCursorTo": earliest - step_ms if earliest else None,
        "source": (
            f"Polars + Real Market Parquet ({data_provider})"
            if is_real
            else "Polars + DuckDB Parquet Engine"
        ),
        "dataProvider": data_provider,
        "isRealMarket": is_real,
        "candles": candles,
    }


@app.post("/api/quant/preview-order", response_model=MarketExecutionPreview)
def preview_order(req: OrderIntentInput):
    return preview_market_execution(req)


@app.post("/api/quant/reconcile-session", response_model=ReconcileSessionResponse)
def reconcile_session(req: ReconcileSessionRequest):
    reconciled = simulate_orders(
        req.orders,
        bars=req.bars,
        symbol=req.symbol,
        upto_ts=req.uptoTs,
        rewind=req.rewind,
    )
    stats = compute_replay_stats(reconciled, req.initialBalance)
    quant = analyze_quant_session(reconciled, req.initialBalance, locale=req.locale)
    return ReconcileSessionResponse(
        orders=reconciled,
        stats=stats,
        quantMetrics=quant,
        precisionMode="DECIMAL_FIXED_2",
    )


@app.post("/api/quant/simulate/what-if")
def simulate_what_if(req: WhatIfRequest):
    return run_what_if_decimal(req)


@app.post("/api/quant/simulate/monte-carlo")
def simulate_monte_carlo(req: MonteCarloRequest):
    return run_monte_carlo_vectorized(req)


@app.post("/api/quant/vector-sweep", response_model=VectorSweepResponse)
def vector_sweep(req: VectorSweepRequest):
    return run_vector_sweep(req)


@app.post("/api/quant/optimize", response_model=OptunaOptimizeResponse)
def optimize_strategy(req: OptunaOptimizeRequest):
    return run_optuna_optimization(req)


@app.get("/api/quant/market-data/catalog", response_model=MarketDataCatalogResponse)
def market_data_catalog():
    return get_parquet_catalog()


@app.post("/api/quant/market-data/sync", response_model=MarketDataSyncResponse)
def market_data_sync(req: MarketDataSyncRequest):
    candles_dicts = [c.model_dump() for c in req.candles] if req.candles else None
    return sync_market_data_parquet(
        symbol=req.symbol,
        timeframe=req.timeframe,
        bars_count=req.barsCount,
        source_preference=req.sourcePreference,
        candles=candles_dicts,
        force_refresh=req.forceRefresh,
    )


@app.post("/api/quant/simulate/realistic", response_model=RealisticSimResponse)
def simulate_realistic(req: RealisticSimRequest):
    norm_tf, _ = normalize_timeframe(req.timeframe)
    df, data_source_used, is_real_data = load_ohlcv_with_source(
        req.symbol,
        norm_tf,
        limit=req.barsCount,
        data_mode=req.dataMode,
        auto_sync_if_missing=(req.dataMode == "REAL"),
    )
    sim_res = run_realistic_bar_simulation(
        df=df,
        symbol=req.symbol.upper(),
        strategy_family=req.strategyFamily,
        fast_period=req.fastPeriod,
        slow_period=req.slowPeriod,
        rr_target=req.rrTarget,
        sl_atr_mult=req.slAtrMult,
        rsi_threshold=req.rsiThreshold,
        initial_capital=req.initialCapital,
        risk_pct=req.riskPct,
        spread_pct=req.spreadPct,
        commission_pct=req.commissionPct,
        slippage_bps=req.slippageBps,
        session_filter=req.sessionFilter,
        avoid_friday_late=req.avoidFridayLate,
        locale=req.locale,
    )
    tearsheet = generate_quantstats_tearsheet(
        sim_res["orders"],
        initial_balance=req.initialCapital,
        symbol=req.symbol.upper(),
        locale=req.locale,
    )
    return RealisticSimResponse(
        summary=sim_res["summary"],
        dataSourceUsed=data_source_used,
        isRealMarketData=is_real_data,
        sessionFilter=req.sessionFilter,
        equityCurve=sim_res["equityCurve"],
        orders=sim_res["orders"],
        tearsheet=tearsheet,
    )


@app.post("/api/quant/tearsheet")
def compute_tearsheet(req: TearSheetRequest):
    return generate_quantstats_tearsheet(
        orders=req.orders,
        initial_balance=req.initialBalance,
        symbol=req.symbol,
        locale=req.locale,
    )


@app.get("/api/ml/behavior/status", response_model=BehaviorModelStatusResponse)
def get_behavior_ml_status():
    return behavior_ml_engine.get_status()


@app.get("/api/ml/behavior/analytics", response_model=BehaviorAnalyticsResponse)
def get_behavior_ml_analytics():
    return behavior_ml_engine.get_analytics()


@app.post("/api/ml/behavior/reload", response_model=BehaviorModelStatusResponse)
def reload_behavior_ml_model():
    behavior_ml_engine.ensure_loaded(force_reload=True)
    return behavior_ml_engine.get_status()


@app.post("/api/ml/behavior/analyze-trades", response_model=AnalyzeImportedTradesResponse)
def analyze_imported_trades_behavior(req: AnalyzeImportedTradesRequest):
    return behavior_ml_engine.analyze_trades(req)