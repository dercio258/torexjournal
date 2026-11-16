"""
Real Historical Market Data Parquet Lake for Quant Engine (Phase 2).

Fetches, sanitizes (Polars OHLC invariants + deduplication), atomically persists
(zstd Parquet + .meta.json), catalogs, and resamples real market bars from:
  - Direct MT5 / TradingView mirror push (`MT5_TV`)
  - Binance Public REST Klines (`/api/v3/klines`)
  - Yahoo Finance Chart v8 (`GC=F`, `EURUSD=X`, `NQ=F`, etc.)
With graceful offline fallback to `ohlcv_polars` synthetic Parquet when network
providers are unreachable.
"""

from __future__ import annotations

import json
import math
import os
import re
import threading
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

import httpx
import polars as pl

from .ohlcv_polars import (
    DATA_DIR,
    ensure_symbol_parquet,
    load_resampled_ohlcv_polars,
    normalize_timeframe as _normalize_tf_tuple,
)

REAL_DATA_DIR = DATA_DIR / "real"

TF_MS: dict[str, int] = {
    "1m": 60_000,
    "3m": 180_000,
    "5m": 300_000,
    "15m": 900_000,
    "30m": 1_800_000,
    "1h": 3_600_000,
    "2h": 7_200_000,
    "4h": 14_400_000,
    "1d": 86_400_000,
    "1w": 604_800_000,
}

TF_POLARS_EVERY: dict[str, str] = {
    "1m": "1m",
    "3m": "3m",
    "5m": "5m",
    "15m": "15m",
    "30m": "30m",
    "1h": "1h",
    "2h": "2h",
    "4h": "4h",
    "1d": "1d",
    "1w": "1w",
}


def _norm_tf(tf: str) -> str:
    norm, _ = _normalize_tf_tuple(tf)
    return norm if norm in TF_POLARS_EVERY else "15m"

BINANCE_INTERVAL_MAP: dict[str, str] = {
    "1m": "1m",
    "5m": "5m",
    "15m": "15m",
    "30m": "30m",
    "1h": "1h",
    "4h": "4h",
    "1d": "1d",
}

BINANCE_SYMBOL_MAP: dict[str, str] = {
    "BTCUSD": "BTCUSDT",
    "BTCUSDT": "BTCUSDT",
    "ETHUSD": "ETHUSDT",
    "ETHUSDT": "ETHUSDT",
    "SOLUSD": "SOLUSDT",
    "SOLUSDT": "SOLUSDT",
    "XRPUSD": "XRPUSDT",
    "XRPUSDT": "XRPUSDT",
    "BNBUSD": "BNBUSDT",
    "BNBUSDT": "BNBUSDT",
    "PAXGUSD": "PAXGUSDT",
    "PAXGUSDT": "PAXGUSDT",
}

YAHOO_SYMBOL_MAP: dict[str, str] = {
    "XAUUSD": "GC=F",
    "GOLD": "GC=F",
    "XAGUSD": "SI=F",
    "EURUSD": "EURUSD=X",
    "GBPUSD": "GBPUSD=X",
    "USDJPY": "JPY=X",
    "AUDUSD": "AUDUSD=X",
    "USDCAD": "CAD=X",
    "USDCHF": "CHF=X",
    "NAS100": "NQ=F",
    "USTEC": "NQ=F",
    "NQ1": "NQ=F",
    "NDX": "^NDX",
    "US30": "YM=F",
    "DJ30": "YM=F",
    "SPX500": "ES=F",
    "US500": "ES=F",
    "GER40": "^GDAXI",
    "BTCUSD": "BTC-USD",
    "BTCUSDT": "BTC-USD",
    "ETHUSD": "ETH-USD",
    "SOLUSD": "SOL-USD",
}

_LOCK_GUARD = threading.Lock()
_SYMBOL_LOCKS: dict[tuple[str, str], threading.Lock] = {}


def normalize_symbol(symbol: str) -> str:
    cleaned = re.sub(r"[^A-Z0-9]", "", (symbol or "XAUUSD").upper())
    return cleaned or "XAUUSD"


def _get_symbol_lock(symbol: str, timeframe: str) -> threading.Lock:
    key = (normalize_symbol(symbol), _norm_tf(timeframe))
    with _LOCK_GUARD:
        lock = _SYMBOL_LOCKS.get(key)
        if lock is None:
            lock = threading.Lock()
            _SYMBOL_LOCKS[key] = lock
        return lock


def _parquet_paths(symbol: str, timeframe: str) -> tuple[Path, Path]:
    REAL_DATA_DIR.mkdir(parents=True, exist_ok=True)
    sym = normalize_symbol(symbol)
    tf = _norm_tf(timeframe)
    return REAL_DATA_DIR / f"{sym}_{tf}.parquet", REAL_DATA_DIR / f"{sym}_{tf}.meta.json"


def sanitize_ohlcv_polars(df: pl.DataFrame) -> tuple[pl.DataFrame, dict[str, Any]]:
    """
    Validate finite positive prices, enforce OHLC invariants (high >= max, low <= min),
    sort chronologically, and deduplicate timestamps using Polars.
    """
    if df.is_empty():
        empty = pl.DataFrame(
            schema={
                "timestamp": pl.Int64,
                "open": pl.Float64,
                "high": pl.Float64,
                "low": pl.Float64,
                "close": pl.Float64,
                "volume": pl.Float64,
            }
        )
        return empty, {
            "rawRows": 0,
            "cleanRows": 0,
            "invalidDropped": 0,
            "duplicatesRemoved": 0,
            "anomaliesFixed": 0,
        }

    raw_rows = df.height
    work = df.select(
        [
            pl.col("timestamp").cast(pl.Int64),
            pl.col("open").cast(pl.Float64),
            pl.col("high").cast(pl.Float64),
            pl.col("low").cast(pl.Float64),
            pl.col("close").cast(pl.Float64),
            pl.col("volume").cast(pl.Float64).fill_null(0.0),
        ]
    )

    valid_mask = (
        pl.col("timestamp").is_not_null()
        & (pl.col("timestamp") > 0)
        & pl.col("open").is_finite()
        & pl.col("high").is_finite()
        & pl.col("low").is_finite()
        & pl.col("close").is_finite()
        & (pl.col("open") > 0)
        & (pl.col("high") > 0)
        & (pl.col("low") > 0)
        & (pl.col("close") > 0)
    )
    filtered = work.filter(valid_mask)
    valid_rows = filtered.height
    invalid_dropped = raw_rows - valid_rows

    if filtered.is_empty():
        return filtered, {
            "rawRows": raw_rows,
            "cleanRows": 0,
            "invalidDropped": invalid_dropped,
            "duplicatesRemoved": 0,
            "anomaliesFixed": 0,
        }

    fixed_expr_hi = pl.max_horizontal("open", "high", "low", "close")
    fixed_expr_lo = pl.min_horizontal("open", "high", "low", "close")

    anomalies_df = filtered.select(
        (
            (pl.col("high") < fixed_expr_hi)
            | (pl.col("low") > fixed_expr_lo)
            | (pl.col("volume") < 0)
        ).sum()
    )
    anomalies_fixed = int(anomalies_df.item(0, 0) or 0)

    normalized = filtered.with_columns(
        [
            fixed_expr_hi.alias("high"),
            fixed_expr_lo.alias("low"),
            pl.when(pl.col("volume").is_finite() & (pl.col("volume") >= 0))
            .then(pl.col("volume"))
            .otherwise(0.0)
            .alias("volume"),
        ]
    )

    deduped = (
        normalized.sort("timestamp")
        .unique(subset=["timestamp"], keep="last", maintain_order=True)
    )
    duplicates_removed = valid_rows - deduped.height

    return deduped, {
        "rawRows": raw_rows,
        "cleanRows": deduped.height,
        "invalidDropped": invalid_dropped,
        "duplicatesRemoved": duplicates_removed,
        "anomaliesFixed": anomalies_fixed,
    }


def _resample_polars(df: pl.DataFrame, target_tf: str) -> pl.DataFrame:
    every = TF_POLARS_EVERY[_norm_tf(target_tf)]
    return (
        df.with_columns(pl.from_epoch(pl.col("timestamp"), time_unit="ms").alias("_dt"))
        .sort("_dt")
        .group_by_dynamic("_dt", every=every, closed="left", label="left")
        .agg(
            [
                pl.col("timestamp").first().alias("timestamp"),
                pl.col("open").first().alias("open"),
                pl.col("high").max().alias("high"),
                pl.col("low").min().alias("low"),
                pl.col("close").last().alias("close"),
                pl.col("volume").sum().alias("volume"),
            ]
        )
        .drop("_dt")
        .sort("timestamp")
    )


def _safe_os_replace(src: Path, dst: Path) -> None:
    """Replaces dst with src atomically, retrying transient Windows file-lock errors."""
    for attempt in range(6):
        try:
            os.replace(src, dst)
            return
        except PermissionError:
            if attempt < 5:
                time.sleep(0.05 * (attempt + 1))
                continue
            src.unlink(missing_ok=True)
            raise
        except Exception:
            src.unlink(missing_ok=True)
            raise


def _write_real_parquet_atomic(
    symbol: str,
    timeframe: str,
    df: pl.DataFrame,
    source: str,
    is_real_market: bool,
    diagnostics: dict[str, Any],
    merge_existing: bool = True,
) -> tuple[pl.DataFrame, dict[str, Any], Path]:
    norm_sym = normalize_symbol(symbol)
    norm_tf = _norm_tf(timeframe)
    pq_path, meta_path = _parquet_paths(norm_sym, norm_tf)
    lock = _get_symbol_lock(norm_sym, norm_tf)

    with lock:
        clean_df, clean_diag = sanitize_ohlcv_polars(df)
        if merge_existing and pq_path.exists():
            try:
                existing = pl.read_parquet(pq_path)
                combined = pl.concat([existing, clean_df], how="vertical_relaxed")
                clean_df, merge_diag = sanitize_ohlcv_polars(combined)
                clean_diag["mergedWithExisting"] = True
                clean_diag["duplicatesRemoved"] += merge_diag["duplicatesRemoved"]
            except Exception:
                pass

        if clean_df.height > 30_000:
            clean_df = clean_df.tail(30_000)

        tmp_pq = pq_path.with_suffix(f".tmp.{os.getpid()}.{uuid.uuid4().hex[:8]}.parquet")
        clean_df.write_parquet(tmp_pq, compression="zstd")
        _safe_os_replace(tmp_pq, pq_path)

        from_ts = int(clean_df["timestamp"].min()) if not clean_df.is_empty() else 0
        to_ts = int(clean_df["timestamp"].max()) if not clean_df.is_empty() else 0
        meta: dict[str, Any] = {
            "symbol": norm_sym,
            "timeframe": norm_tf,
            "source": source,
            "isRealMarket": bool(is_real_market),
            "barsCount": clean_df.height,
            "fromTimestamp": from_ts,
            "toTimestamp": to_ts,
            "fileSizeBytes": pq_path.stat().st_size if pq_path.exists() else 0,
            "updatedAtIso": datetime.now(timezone.utc).isoformat(),
            "filePath": str(pq_path),
            "diagnostics": {**diagnostics, **clean_diag},
        }
        tmp_meta = meta_path.with_suffix(f".tmp.{os.getpid()}.{uuid.uuid4().hex[:8]}.json")
        tmp_meta.write_text(json.dumps(meta, indent=2), encoding="utf-8")
        _safe_os_replace(tmp_meta, meta_path)
        return clean_df, meta, pq_path


def _fetch_binance_klines(symbol: str, timeframe: str, bars_count: int) -> Optional[pl.DataFrame]:
    norm_sym = normalize_symbol(symbol)
    pair = BINANCE_SYMBOL_MAP.get(norm_sym)
    if not pair:
        if norm_sym.endswith("USDT"):
            pair = norm_sym
        else:
            return None

    interval = BINANCE_INTERVAL_MAP.get(_norm_tf(timeframe), "15m")
    target = max(100, min(bars_count, 5000))
    batches: list[list[Any]] = []
    end_time: Optional[int] = None
    max_requests = min(6, math.ceil(target / 1000))

    try:
        with httpx.Client(timeout=6.0) as client:
            for _ in range(max_requests):
                params: dict[str, Any] = {"symbol": pair, "interval": interval, "limit": 1000}
                if end_time is not None:
                    params["endTime"] = end_time
                resp = client.get("https://api.binance.com/api/v3/klines", params=params)
                if resp.status_code != 200:
                    break
                rows = resp.json()
                if not isinstance(rows, list) or not rows:
                    break
                batches.extend(rows)
                oldest_open = int(rows[0][0])
                end_time = oldest_open - 1
                if len(batches) >= target or len(rows) < 1000:
                    break
    except Exception:
        if not batches:
            return None

    if not batches:
        return None

    records = []
    for k in batches:
        try:
            records.append(
                {
                    "timestamp": int(k[0]),
                    "open": float(k[1]),
                    "high": float(k[2]),
                    "low": float(k[3]),
                    "close": float(k[4]),
                    "volume": float(k[5]),
                }
            )
        except (TypeError, ValueError, IndexError):
            continue

    if not records:
        return None

    df = pl.DataFrame(records).sort("timestamp").unique(subset=["timestamp"], keep="last").tail(target)
    return df


def _yahoo_range_for_tf(tf: str, bars_count: int) -> tuple[str, str, bool]:
    # Yahoo supports 1m, 5m, 15m, 30m, 1h, 1d natively; resample 1h -> 4h locally in Polars.
    if tf == "1m":
        return "1m", "7d", False
    if tf in ("5m", "15m", "30m"):
        return tf, "60d", False
    if tf == "1h":
        return "1h", "730d", False
    if tf == "4h":
        return "1h", "730d", True
    return "1d", "10y" if bars_count > 1200 else "5y", False


def _fetch_yahoo_candles(symbol: str, timeframe: str, bars_count: int) -> Optional[pl.DataFrame]:
    norm_sym = normalize_symbol(symbol)
    ticker = YAHOO_SYMBOL_MAP.get(norm_sym)
    if not ticker:
        return None

    norm_tf = _norm_tf(timeframe)
    y_interval, y_range, needs_4h_resample = _yahoo_range_for_tf(norm_tf, bars_count)
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{ticker}"

    try:
        with httpx.Client(
            timeout=8.0,
            headers={"User-Agent": "Mozilla/5.0 (compatible; TorexQuantEngine/2.0)"},
        ) as client:
            resp = client.get(
                url,
                params={"interval": y_interval, "range": y_range, "includePrePost": "false"},
            )
            if resp.status_code != 200:
                return None
            payload = resp.json()
    except Exception:
        return None

    result = (payload.get("chart") or {}).get("result")
    if not isinstance(result, list) or not result:
        return None

    entry = result[0]
    timestamps = entry.get("timestamp") or []
    quotes = ((entry.get("indicators") or {}).get("quote") or [{}])[0]
    opens = quotes.get("open") or []
    highs = quotes.get("high") or []
    lows = quotes.get("low") or []
    closes = quotes.get("close") or []
    volumes = quotes.get("volume") or []

    rows = []
    for i, ts_sec in enumerate(timestamps):
        if ts_sec is None:
            continue
        try:
            o = opens[i]
            h = highs[i]
            l = lows[i]
            c = closes[i]
            if o is None or h is None or l is None or c is None:
                continue
            v = volumes[i] if i < len(volumes) and volumes[i] is not None else 0.0
            rows.append(
                {
                    "timestamp": int(ts_sec) * 1000,
                    "open": float(o),
                    "high": float(h),
                    "low": float(l),
                    "close": float(c),
                    "volume": float(v),
                }
            )
        except (TypeError, ValueError, IndexError):
            continue

    if not rows:
        return None

    df = pl.DataFrame(rows)
    df, _ = sanitize_ohlcv_polars(df)
    if needs_4h_resample and not df.is_empty():
        df = _resample_polars(df, "4h")
    if df.height > bars_count:
        df = df.tail(bars_count)
    return df


def _load_meta(meta_path: Path) -> Optional[dict[str, Any]]:
    if not meta_path.exists():
        return None
    try:
        return json.loads(meta_path.read_text(encoding="utf-8"))
    except Exception:
        return None


def load_real_parquet_ohlcv(
    symbol: str,
    timeframe: str = "15m",
    from_ts: Optional[int] = None,
    to_ts: Optional[int] = None,
    limit: int = 5000,
) -> Optional[tuple[pl.DataFrame, dict[str, Any]]]:
    """
    Load real market OHLCV bars from `data/parquet/real/` if present.
    Falls back to resampling a finer real timeframe (e.g., 15m -> 1h) when available.
    """
    norm_sym = normalize_symbol(symbol)
    norm_tf = _norm_tf(timeframe)
    pq_path, meta_path = _parquet_paths(norm_sym, norm_tf)

    source_meta: Optional[dict[str, Any]] = None
    df: Optional[pl.DataFrame] = None

    if pq_path.exists():
        meta = _load_meta(meta_path)
        if meta and meta.get("isRealMarket"):
            try:
                df = pl.read_parquet(pq_path)
                source_meta = meta
            except Exception:
                df = None

    if df is None:
        target_ms = TF_MS.get(norm_tf, 900_000)
        candidate_tfs = ["1m", "5m", "15m", "30m", "1h", "4h"]
        for base_tf in reversed(candidate_tfs):
            if TF_MS[base_tf] >= target_ms:
                continue
            b_pq, b_meta_path = _parquet_paths(norm_sym, base_tf)
            if not b_pq.exists():
                continue
            b_meta = _load_meta(b_meta_path)
            if not b_meta or not b_meta.get("isRealMarket"):
                continue
            try:
                raw_df = pl.read_parquet(b_pq)
                df = _resample_polars(raw_df, norm_tf)
                source_meta = {
                    **b_meta,
                    "timeframe": norm_tf,
                    "source": f"{b_meta.get('source', 'real')}-resampled-{base_tf}",
                    "barsCount": df.height,
                }
                break
            except Exception:
                continue

    if df is None or source_meta is None or df.is_empty():
        return None

    filtered = df
    if from_ts is not None:
        filtered = filtered.filter(pl.col("timestamp") >= int(from_ts))
    if to_ts is not None:
        filtered = filtered.filter(pl.col("timestamp") <= int(to_ts))
    if limit > 0 and filtered.height > limit:
        filtered = filtered.tail(limit)

    return filtered, source_meta


def sync_market_data_parquet(
    symbol: str,
    timeframe: str = "15m",
    bars_count: int = 3000,
    source_preference: str = "AUTO",
    candles: Optional[list[dict[str, Any]]] = None,
    force_refresh: bool = False,
) -> dict[str, Any]:
    """
    Synchronize real market candles into the Polars Parquet Data Lake.
    Priority:
      1) Direct pushed `MT5_TV` candles when present
      2) Fresh cached real Parquet (< 30m old) when not `force_refresh`
      3) Live Binance Klines / Yahoo Finance Chart v8 based on symbol & preference
      4) Existing real Parquet cache if network fails
      5) Offline synthetic fallback (`isRealMarket=False`) so callers never crash
    """
    norm_sym = normalize_symbol(symbol)
    norm_tf = _norm_tf(timeframe)
    pq_path, meta_path = _parquet_paths(norm_sym, norm_tf)

    if candles:
        raw_df = pl.DataFrame(candles)
        clean_df, meta, path = _write_real_parquet_atomic(
            norm_sym,
            norm_tf,
            raw_df,
            source="mt5-tv-real-parquet",
            is_real_market=True,
            diagnostics={"provider": "MT5_TV", "pushedBars": len(candles)},
            merge_existing=True,
        )
        return {
            "status": "ok",
            "symbol": norm_sym,
            "timeframe": norm_tf,
            "source": meta["source"],
            "isRealMarket": True,
            "barsCount": clean_df.height,
            "fromTimestamp": meta["fromTimestamp"],
            "toTimestamp": meta["toTimestamp"],
            "filePath": str(path),
            "diagnostics": meta["diagnostics"],
            "message": f"Ingested {clean_df.height} sanitized MT5/TV bars into Parquet Lake.",
        }

    existing_meta = _load_meta(meta_path)
    if (
        pq_path.exists()
        and existing_meta
        and existing_meta.get("isRealMarket")
        and int(existing_meta.get("barsCount", 0)) >= min(bars_count, 250)
    ):
        try:
            updated_ts = datetime.fromisoformat(existing_meta["updatedAtIso"]).timestamp()
            max_age_sec = 120.0 if force_refresh else 1800.0
            if (time.time() - updated_ts) < max_age_sec:
                return {
                    "status": "ok",
                    "symbol": norm_sym,
                    "timeframe": norm_tf,
                    "source": existing_meta["source"],
                    "isRealMarket": True,
                    "barsCount": int(existing_meta["barsCount"]),
                    "fromTimestamp": int(existing_meta["fromTimestamp"]),
                    "toTimestamp": int(existing_meta["toTimestamp"]),
                    "filePath": str(pq_path),
                    "diagnostics": {**existing_meta.get("diagnostics", {}), "cacheHit": True},
                    "message": f"Using fresh cached Parquet ({existing_meta['barsCount']} real bars from {existing_meta['source']}).",
                }
        except Exception:
            pass

    fetched_df: Optional[pl.DataFrame] = None
    provider_label = ""
    pref = (source_preference or "AUTO").upper()

    if pref in ("AUTO", "BINANCE"):
        fetched_df = _fetch_binance_klines(norm_sym, norm_tf, bars_count)
        if fetched_df is not None and fetched_df.height >= 50:
            provider_label = f"binance-spot-klines:{BINANCE_SYMBOL_MAP.get(norm_sym, norm_sym)}"

    if (fetched_df is None or fetched_df.height < 50) and pref in ("AUTO", "YAHOO"):
        fetched_df = _fetch_yahoo_candles(norm_sym, norm_tf, bars_count)
        if fetched_df is not None and fetched_df.height >= 50:
            provider_label = f"yahoo-chart-v8:{YAHOO_SYMBOL_MAP.get(norm_sym, norm_sym)}"

    if fetched_df is not None and fetched_df.height >= 50:
        clean_df, meta, path = _write_real_parquet_atomic(
            norm_sym,
            norm_tf,
            fetched_df,
            source=provider_label,
            is_real_market=True,
            diagnostics={"provider": provider_label, "requestedBars": bars_count},
            merge_existing=not force_refresh,
        )
        return {
            "status": "ok",
            "symbol": norm_sym,
            "timeframe": norm_tf,
            "source": meta["source"],
            "isRealMarket": True,
            "barsCount": clean_df.height,
            "fromTimestamp": meta["fromTimestamp"],
            "toTimestamp": meta["toTimestamp"],
            "filePath": str(path),
            "diagnostics": meta["diagnostics"],
            "message": f"Synchronized {clean_df.height} real bars from {provider_label}.",
        }

    # Existing real cache beats synthetic fallback when offline
    if pq_path.exists() and existing_meta and existing_meta.get("isRealMarket"):
        return {
            "status": "ok",
            "symbol": norm_sym,
            "timeframe": norm_tf,
            "source": f"{existing_meta['source']} (offline-cache)",
            "isRealMarket": True,
            "barsCount": int(existing_meta["barsCount"]),
            "fromTimestamp": int(existing_meta["fromTimestamp"]),
            "toTimestamp": int(existing_meta["toTimestamp"]),
            "filePath": str(pq_path),
            "diagnostics": {**existing_meta.get("diagnostics", {}), "offlineCacheFallback": True},
            "message": "Network feed unavailable; serving cached real Parquet data.",
        }

    # Final fallback: deterministic synthetic Parquet
    syn_df = load_resampled_ohlcv_polars(norm_sym, norm_tf, limit=bars_count)
    syn_path = ensure_symbol_parquet(norm_sym)
    from_ts = int(syn_df["timestamp"].min()) if not syn_df.is_empty() else 0
    to_ts = int(syn_df["timestamp"].max()) if not syn_df.is_empty() else 0
    return {
        "status": "fallback",
        "symbol": norm_sym,
        "timeframe": norm_tf,
        "source": "synthetic-fallback",
        "isRealMarket": False,
        "barsCount": syn_df.height,
        "fromTimestamp": from_ts,
        "toTimestamp": to_ts,
        "filePath": str(syn_path),
        "diagnostics": {"offlineSyntheticFallback": True, "providerPreference": pref},
        "message": f"Real provider unavailable for {norm_sym}; falling back to deterministic synthetic Parquet.",
    }


def get_parquet_catalog() -> dict[str, Any]:
    """List persisted real Parquet datasets and summary stats."""
    REAL_DATA_DIR.mkdir(parents=True, exist_ok=True)
    datasets: list[dict[str, Any]] = []
    for meta_file in sorted(REAL_DATA_DIR.glob("*.meta.json")):
        meta = _load_meta(meta_file)
        if not meta:
            continue
        pq_path = Path(meta.get("filePath", ""))
        if not pq_path.exists():
            continue
        datasets.append(
            {
                "symbol": str(meta.get("symbol", "")),
                "timeframe": str(meta.get("timeframe", "")),
                "source": str(meta.get("source", "")),
                "isRealMarket": bool(meta.get("isRealMarket", False)),
                "barsCount": int(meta.get("barsCount", 0)),
                "fromTimestamp": int(meta.get("fromTimestamp", 0)),
                "toTimestamp": int(meta.get("toTimestamp", 0)),
                "fileSizeBytes": pq_path.stat().st_size,
                "updatedAtIso": str(meta.get("updatedAtIso", "")),
                "filePath": str(pq_path),
            }
        )

    datasets.sort(key=lambda d: (d["symbol"], d["timeframe"]))
    real_count = sum(1 for d in datasets if d["isRealMarket"])
    total_bars = sum(d["barsCount"] for d in datasets)
    return {
        "datasets": datasets,
        "totalDatasets": len(datasets),
        "realDatasetsCount": real_count,
        "totalBars": total_bars,
    }
