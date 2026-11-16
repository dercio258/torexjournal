from __future__ import annotations

import os
import threading
import time
import uuid
from pathlib import Path
from typing import Optional

import numpy as np
import polars as pl

# Fixed deterministic UTC origin: 2026-01-01T00:00:00Z
ANCHOR_MS = 1_767_225_600_000
MINUTE_MS = 60_000
TOTAL_CALENDAR_MINUTES = 525_600  # Full 2026 calendar year (365 days)

DATA_DIR = Path(__file__).resolve().parent.parent / "data" / "parquet"
_PARQUET_GUARD = threading.Lock()
_PARQUET_LOCKS: dict[str, threading.Lock] = {}
_PARQUET_MAX_TS: dict[str, int] = {}


def _replace_file_windows_safe(
    tmp_path: Path,
    target_path: Path,
    keep_existing_on_lock: bool = True,
) -> None:
    """Atomically swaps a staged Parquet file with Windows reader-lock retry backoff."""
    for attempt in range(6):
        try:
            os.replace(tmp_path, target_path)
            return
        except PermissionError:
            if attempt < 5:
                time.sleep(0.05 * (attempt + 1))
                continue
            if keep_existing_on_lock and target_path.exists():
                tmp_path.unlink(missing_ok=True)
                return
            tmp_path.unlink(missing_ok=True)
            raise

TF_MS_MAP: dict[str, int] = {
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


def normalize_timeframe(tf: str) -> tuple[str, int]:
    clean = (tf or "15m").strip().lower()
    aliases = {
        "1": "1m",
        "5": "5m",
        "15": "15m",
        "30": "30m",
        "60": "1h",
        "240": "4h",
        "1440": "1d",
        "d": "1d",
        "w": "1w",
    }
    norm = aliases.get(clean, clean)
    return norm, TF_MS_MAP.get(norm, 900_000)


def _symbol_profile(raw_symbol: str) -> tuple[str, float, float, int, int]:
    """Returns (clean_symbol, base_price, bar_vol, decimals, deterministic_seed)."""
    clean = (raw_symbol or "XAUUSD").split(":")[-1].upper()
    seed = 2166136261
    for ch in clean:
        seed ^= ord(ch)
        seed = (seed * 16777619) & 0xFFFFFFFF

    if "XAU" in clean or "GOLD" in clean:
        return clean, 2720.0, 0.00055, 2, seed
    if "XAG" in clean:
        return clean, 31.8, 0.00075, 3, seed
    if "BTC" in clean:
        return clean, 91200.0, 0.00110, 2, seed
    if "ETH" in clean:
        return clean, 3280.0, 0.00120, 2, seed
    if "NAS" in clean or "US100" in clean:
        return clean, 20500.0, 0.00060, 2, seed
    if "US30" in clean:
        return clean, 43600.0, 0.00050, 1, seed
    if "EUR" in clean and "USD" in clean:
        return clean, 1.0860, 0.00022, 5, seed
    if "GBP" in clean and "USD" in clean:
        return clean, 1.2980, 0.00025, 5, seed
    if "JPY" in clean:
        return clean, 153.50, 0.00028, 3, seed
    return clean, 150.0, 0.00050, 2, seed


def _generate_year_1m_dataframe(raw_symbol: str, max_minutes: int = TOTAL_CALENDAR_MINUTES) -> pl.DataFrame:
    clean, base_price, bar_vol, decimals, seed = _symbol_profile(raw_symbol)
    rng = np.random.default_rng(seed)

    n = max_minutes
    idx = np.arange(n, dtype=np.int64)
    timestamps = ANCHOR_MS + idx * MINUTE_MS
    hour_of_day = ((timestamps // 3_600_000) % 24).astype(np.float64)

    session_mult = (
        0.65
        + 0.45 * np.exp(-0.5 * ((hour_of_day - 9.0) / 2.2) ** 2)
        + 0.65 * np.exp(-0.5 * ((hour_of_day - 14.5) / 2.5) ** 2)
    )

    wave = (
        0.032 * np.sin(idx / 2400.0 + (seed % 7))
        + 0.018 * np.cos(idx / 620.0)
        + 0.008 * np.sin(idx / 115.0)
    )
    shocks = rng.normal(0.0, 1.0, size=n) * (bar_vol * session_mult)

    cum_shocks = np.cumsum(shocks)
    kernel = 20_160
    cs = np.concatenate(([0.0], cum_shocks))
    ma = np.empty_like(cum_shocks)
    head = min(kernel, n)
    ma[:head] = cum_shocks[:head] / (np.arange(head) + 1)
    if n > kernel:
        ma[kernel:] = (cs[kernel + 1 :] - cs[1 : n - kernel + 1]) / kernel
    bounded_walk = (cum_shocks - ma) * 0.45

    log_closes = np.log(base_price) + wave + bounded_walk
    closes = np.exp(log_closes)
    opens = np.empty_like(closes)
    opens[0] = base_price
    opens[1:] = closes[:-1]

    wick_up = np.abs(rng.normal(0.0, 0.55, size=n)) * bar_vol * session_mult * opens
    wick_dn = np.abs(rng.normal(0.0, 0.55, size=n)) * bar_vol * session_mult * opens
    highs = np.maximum(opens, closes) + wick_up
    lows = np.maximum(10 ** (-decimals), np.minimum(opens, closes) - wick_dn)

    vols = np.round(
        (45.0 + 180.0 * session_mult * (0.4 + rng.random(n)))
        * (1.0 + np.abs(closes - opens) / np.maximum(opens * bar_vol, 1e-9))
    ).astype(np.float64)

    return pl.DataFrame(
        {
            "timestamp": timestamps,
            "open": np.round(opens, decimals),
            "high": np.round(highs, decimals),
            "low": np.round(lows, decimals),
            "close": np.round(closes, decimals),
            "volume": vols,
        }
    )


def ensure_symbol_parquet(raw_symbol: str, up_to_ts: Optional[int] = None) -> Path:
    clean, *_ = _symbol_profile(raw_symbol)
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    parquet_path = DATA_DIR / f"{clean}_1m.parquet"

    needed_minutes = TOTAL_CALENDAR_MINUTES
    if up_to_ts is not None and up_to_ts > ANCHOR_MS:
        span_mins = int((up_to_ts - ANCHOR_MS) // MINUTE_MS) + 20_000
        if span_mins > needed_minutes:
            needed_minutes = min(span_mins, 1_051_200)

    with _PARQUET_GUARD:
        lock = _PARQUET_LOCKS.setdefault(clean, threading.Lock())

    with lock:
        cached_max = _PARQUET_MAX_TS.get(clean)
        if parquet_path.exists() and cached_max is not None and (up_to_ts is None or cached_max >= up_to_ts):
            return parquet_path

        if parquet_path.exists():
            try:
                max_val = pl.read_parquet(parquet_path, columns=["timestamp"])["timestamp"].max()
                if max_val is not None:
                    max_int = int(max_val)
                    _PARQUET_MAX_TS[clean] = max_int
                    if up_to_ts is None or max_int >= up_to_ts:
                        return parquet_path
            except Exception:
                pass

        df = _generate_year_1m_dataframe(clean, max_minutes=needed_minutes)
        tmp_path = parquet_path.with_suffix(f".tmp.{os.getpid()}.{uuid.uuid4().hex[:8]}.parquet")
        df.write_parquet(tmp_path, compression="zstd")
        _replace_file_windows_safe(tmp_path, parquet_path, keep_existing_on_lock=parquet_path.exists())
        if not df.is_empty():
            _PARQUET_MAX_TS[clean] = int(df["timestamp"].max())
        return parquet_path


def load_resampled_ohlcv_polars(
    symbol: str,
    timeframe: str = "15m",
    from_ts: Optional[int] = None,
    to_ts: Optional[int] = None,
    limit: int = 1000,
    with_indicators: bool = False,
) -> pl.DataFrame:
    """Loads deterministic 1m Parquet via Polars lazy scan and resamples into target timeframe."""
    norm_tf, tf_ms = normalize_timeframe(timeframe)
    safe_limit = max(1, min(int(limit), 25_000))

    effective_to = int(to_ts) if to_ts is not None else ANCHOR_MS + 320 * 86_400_000
    bucket_end = (effective_to // tf_ms) * tf_ms
    if from_ts is not None:
        bucket_start = (int(from_ts) // tf_ms) * tf_ms
    else:
        bucket_start = max(ANCHOR_MS, bucket_end - (safe_limit - 1) * tf_ms)

    parquet_path = ensure_symbol_parquet(symbol, up_to_ts=bucket_end + tf_ms)

    lf = pl.scan_parquet(parquet_path).filter(
        (pl.col("timestamp") >= bucket_start) & (pl.col("timestamp") < bucket_end + tf_ms)
    )

    if norm_tf == "1m":
        df = lf.sort("timestamp").collect()
    else:
        df = (
            lf.with_columns(((pl.col("timestamp") // tf_ms) * tf_ms).alias("bucket_ts"))
            .sort("timestamp")
            .group_by("bucket_ts", maintain_order=True)
            .agg(
                [
                    pl.col("open").first().alias("open"),
                    pl.col("high").max().alias("high"),
                    pl.col("low").min().alias("low"),
                    pl.col("close").last().alias("close"),
                    pl.col("volume").sum().alias("volume"),
                ]
            )
            .rename({"bucket_ts": "timestamp"})
            .sort("timestamp")
            .collect()
        )

    if len(df) > safe_limit:
        df = df.tail(safe_limit)

    if with_indicators and len(df) > 0:
        df = append_polars_indicators(df)

    return df


def append_polars_indicators(
    df: pl.DataFrame, fast: int = 12, slow: int = 34, rsi_period: int = 14, atr_period: int = 14
) -> pl.DataFrame:
    """Computes technical indicators directly via Polars columnar expressions."""
    prev_close = pl.col("close").shift(1).fill_null(pl.col("open"))
    tr = pl.max_horizontal(
        pl.col("high") - pl.col("low"),
        (pl.col("high") - prev_close).abs(),
        (pl.col("low") - prev_close).abs(),
    )
    delta = pl.col("close").diff().fill_null(0.0)
    gain = pl.when(delta > 0).then(delta).otherwise(0.0)
    loss = pl.when(delta < 0).then(-delta).otherwise(0.0)

    out = (
        df.with_columns(
            [
                pl.col("close").ewm_mean(span=fast, adjust=False).alias("ema_fast"),
                pl.col("close").ewm_mean(span=slow, adjust=False).alias("ema_slow"),
                pl.col("close").rolling_mean(window_size=20, min_samples=1).alias("sma_20"),
                pl.col("close").rolling_std(window_size=20, min_samples=1).fill_null(0.0).alias("std_20"),
                pl.col("high").rolling_max(window_size=fast, min_samples=1).alias("donchian_high"),
                pl.col("low").rolling_min(window_size=fast, min_samples=1).alias("donchian_low"),
                tr.rolling_mean(window_size=atr_period, min_samples=1).alias("atr"),
                gain.ewm_mean(alpha=1.0 / rsi_period, adjust=False).alias("_avg_gain"),
                loss.ewm_mean(alpha=1.0 / rsi_period, adjust=False).alias("_avg_loss"),
            ]
        )
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
        .drop(["_avg_gain", "_avg_loss", "std_20"])
    )

    return out


def load_ohlcv_with_source(
    symbol: str,
    timeframe: str = "15m",
    from_ts: Optional[int] = None,
    to_ts: Optional[int] = None,
    limit: int = 1000,
    with_indicators: bool = False,
    data_mode: str = "AUTO",
    auto_sync_if_missing: bool = False,
    min_bars_for_real: int = 200,
) -> tuple[pl.DataFrame, str, bool]:
    """
    Resolve OHLCV bars from real Parquet Data Lake (`AUTO` / `REAL`) or fallback
    to deterministic synthetic Polars Parquet (`SYNTHETIC`), returning `(df, source, is_real)`.
    """
    mode = (data_mode or "AUTO").upper()
    if mode not in ("SYNTHETIC", "REAL", "AUTO"):
        mode = "AUTO"

    if mode != "SYNTHETIC":
        from .market_data_parquet import load_real_parquet_ohlcv, sync_market_data_parquet

        fetch_limit = (limit + 220) if (with_indicators and limit > 0) else limit
        loaded = load_real_parquet_ohlcv(
            symbol,
            timeframe=timeframe,
            from_ts=from_ts,
            to_ts=to_ts,
            limit=fetch_limit,
        )

        threshold = min(limit, min_bars_for_real)
        has_enough = loaded is not None and (
            loaded[0].height >= threshold
            or (loaded[0].height >= 20 and "resampled-" in str(loaded[1].get("source", "")))
        )
        if (not has_enough) and auto_sync_if_missing:
            sync_market_data_parquet(
                symbol,
                timeframe=timeframe,
                bars_count=max(limit, 1500),
                source_preference="AUTO",
                force_refresh=False,
            )
            loaded = load_real_parquet_ohlcv(
                symbol,
                timeframe=timeframe,
                from_ts=from_ts,
                to_ts=to_ts,
                limit=fetch_limit,
            )

        if loaded is not None and loaded[0].height >= min(limit, 10):
            df, meta = loaded
            if with_indicators:
                df = append_polars_indicators(df)
            if limit > 0 and df.height > limit:
                df = df.tail(limit)
            return df, str(meta.get("source", "real-parquet")), True

    df_syn = load_resampled_ohlcv_polars(
        symbol=symbol,
        timeframe=timeframe,
        from_ts=from_ts,
        to_ts=to_ts,
        limit=limit,
        with_indicators=with_indicators,
    )
    return df_syn, "synthetic-parquet", False
