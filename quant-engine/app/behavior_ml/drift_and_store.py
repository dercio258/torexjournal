from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Optional

import duckdb
import numpy as np
from scipy.stats import ks_2samp

from .features import CONT_FEATURE_NAMES
from .schemas import BehaviorAnalyticsResponse


# Monitor key non-cyclic behavioral telemetry features (exclude sin/cos clock cols 18..21)
DRIFT_FEATURE_COUNT = 18


def build_reference_drift_stats(train_cont_raw: np.ndarray, max_ref_sample: int = 256) -> dict[str, Any]:
    """Compute reference bin distributions & subsample on raw training features for PSI/KS checks."""
    if len(train_cont_raw) == 0:
        return {}

    ref: dict[str, Any] = {}
    n = len(train_cont_raw)
    step = max(1, n // max_ref_sample)
    sample_idx = np.arange(0, n, step, dtype=np.int64)[:max_ref_sample]

    for col_idx in range(min(DRIFT_FEATURE_COUNT, len(CONT_FEATURE_NAMES))):
        feat_name = CONT_FEATURE_NAMES[col_idx]
        vals = train_cont_raw[:, col_idx].astype(np.float64)
        vals = vals[np.isfinite(vals)]
        if len(vals) < 10:
            continue

        quantiles = np.quantile(vals, np.linspace(0.0, 1.0, 6))
        unique_edges = np.unique(quantiles)
        if len(unique_edges) < 3:
            lo, hi = float(np.min(vals)), float(np.max(vals))
            if hi - lo < 1e-6:
                continue
            unique_edges = np.linspace(lo, hi, 6)

        edges = np.concatenate(([-np.inf], unique_edges[1:-1], [np.inf]))
        counts, _ = np.histogram(vals, bins=edges)
        n_bins = len(counts)
        expected_pct = (counts + 0.5) / (max(1.0, float(counts.sum())) + 0.5 * n_bins)

        ref[feat_name] = {
            "colIdx": col_idx,
            "edges": [float(e) if np.isfinite(e) else ("-inf" if e < 0 else "inf") for e in edges],
            "expectedPct": expected_pct.tolist(),
            "subsample": vals[sample_idx[sample_idx < len(vals)]].astype(np.float32).tolist(),
        }
    return ref


def _decode_edges(raw_edges: list[Any]) -> np.ndarray:
    parsed: list[float] = []
    for item in raw_edges:
        if item == "-inf":
            parsed.append(-np.inf)
        elif item == "inf":
            parsed.append(np.inf)
        else:
            parsed.append(float(item))
    return np.asarray(parsed, dtype=np.float64)


def compute_batch_drift(
    batch_cont_raw: np.ndarray,
    ref_stats: Optional[dict[str, Any]],
    min_samples: int = 8,
) -> dict[str, Any]:
    """Compute SciPy two-sample KS & Population Stability Index (PSI) on an imported trade batch."""
    if not ref_stats or len(batch_cont_raw) < min_samples:
        return {
            "driftDetected": False,
            "maxPsi": 0.0,
            "driftedFeatures": [],
        }

    max_psi = 0.0
    drifted: list[str] = []

    for feat_name, spec in ref_stats.items():
        col_idx = int(spec["colIdx"])
        if col_idx >= batch_cont_raw.shape[1]:
            continue
        cur_vals = batch_cont_raw[:, col_idx].astype(np.float64)
        cur_vals = cur_vals[np.isfinite(cur_vals)]
        if len(cur_vals) < min_samples:
            continue

        edges = _decode_edges(spec["edges"])
        expected_pct = np.asarray(spec["expectedPct"], dtype=np.float64)
        counts, _ = np.histogram(cur_vals, bins=edges)
        n_bins = len(counts)
        actual_pct = (counts + 0.5) / (max(1.0, float(counts.sum())) + 0.5 * n_bins)

        psi = float(np.sum((actual_pct - expected_pct) * np.log(actual_pct / expected_pct)))
        if psi > max_psi:
            max_psi = psi

        ref_sub = np.asarray(spec.get("subsample") or [], dtype=np.float64)
        if len(ref_sub) >= min_samples:
            ks_res = ks_2samp(ref_sub, cur_vals)
            ks_pval = float(ks_res.pvalue)
            is_drifted = psi >= 0.25 and ks_pval < 0.005
        else:
            is_drifted = psi >= 0.35

        if is_drifted:
            drifted.append(feat_name)

    return {
        "driftDetected": len(drifted) > 0,
        "maxPsi": round(float(max_psi), 3),
        "driftedFeatures": drifted[:6],
    }


def classify_trader_profile(
    meta_list: list[dict[str, Any]],
    predictions: list[Any],
) -> str:
    """Assign an interpretable behavioral trader profile across evaluated imported trades."""
    if not predictions or not meta_list:
        return "DISCIPLINED_EXECUTOR"

    n = len(meta_list)
    ea_overrides = sum(1 for m in meta_list if m.get("execution_mode") == "MANUAL_ON_EA_ACCOUNT")
    ea_count = sum(1 for m in meta_list if m.get("execution_mode") == "EA_BOT")
    if ea_overrides > 0 or (ea_count / max(1, n) >= 0.40 and ea_overrides >= 1):
        return "EA_HYBRID_OPERATOR"

    max_prop_util = max((float(m.get("prop_dd_util", 0.0)) for m in meta_list), default=0.0)
    prop_flagged = any("prop_guardrail_breach_risk" in p.activeFlags for p in predictions)
    if prop_flagged or max_prop_util >= 0.55:
        return "PROP_PRESSURE_TRADER"

    rev_tilt_flagged = any(
        "revenge_trading" in p.activeFlags or "tilt_risk_escalation" in p.activeFlags
        for p in predictions
    )
    if rev_tilt_flagged:
        return "IMPULSIVE_REVENGER"

    mean_1h = float(np.mean([float(m.get("trades_last_1h", 0)) for m in meta_list]))
    over_flagged = any("overtrading_fomo" in p.activeFlags for p in predictions)
    if over_flagged or mean_1h >= 3.0:
        return "HIGH_CADENCE_OVERTRADER"

    return "DISCIPLINED_EXECUTOR"


def query_feature_store_analytics(
    parquet_path: Path,
    metrics_path: Path,
) -> BehaviorAnalyticsResponse:
    """Query the Parquet feature store via DuckDB SQL for behavioral cohort insights."""
    model_comparison: Optional[dict[str, Any]] = None
    if metrics_path.exists():
        try:
            raw_metrics = json.loads(metrics_path.read_text(encoding="utf-8"))
            model_comparison = {
                "modelVersion": raw_metrics.get("modelVersion"),
                "ensembleBackend": raw_metrics.get("ensembleBackend"),
                "validationPytorchOnly": raw_metrics.get("validationPytorchOnly"),
                "validationGbdtOnly": raw_metrics.get("validationGbdtOnly"),
                "validationHybridEnsemble": raw_metrics.get("validationHybridEnsemble"),
                "validationRealDb": raw_metrics.get("validationRealDb"),
                "optunaBlendAlphas": raw_metrics.get("optunaBlendAlphas"),
                "optimalThresholds": raw_metrics.get("optimalThresholds"),
            }
        except Exception:
            model_comparison = None

    if not parquet_path.exists():
        return BehaviorAnalyticsResponse(
            status="dataset_missing",
            datasetExists=False,
            modelComparison=model_comparison,
        )

    con = duckdb.connect(":memory:")
    try:
        path_sql = str(parquet_path).replace("'", "''")
        totals = con.execute(
            f"""
            SELECT
                COUNT(*)::BIGINT AS total_rows,
                COUNT(*) FILTER (WHERE source_split = 'REAL_DB')::BIGINT AS real_rows,
                COUNT(*) FILTER (WHERE source_split = 'SYNTHETIC_ARCHETYPE')::BIGINT AS syn_rows
            FROM read_parquet('{path_sql}')
            """
        ).fetchone()

        session_rows = con.execute(
            f"""
            SELECT
                effective_session AS session,
                COUNT(*)::BIGINT AS trades,
                ROUND(AVG(volume_ratio_median20), 3) AS avgVolumeRatio,
                ROUND(AVG(cadence_burst_ratio), 3) AS avgCadenceBurst,
                ROUND(AVG(y_revenge_trading), 4) AS revengeRate,
                ROUND(AVG(y_overtrading_fomo), 4) AS overtradingRate,
                ROUND(AVG(CASE WHEN is_clean_step THEN 1.0 ELSE 0.0 END), 4) AS cleanRate
            FROM read_parquet('{path_sql}')
            GROUP BY effective_session
            ORDER BY trades DESC
            """
        ).fetchall()

        mode_rows = con.execute(
            f"""
            SELECT
                execution_mode AS executionMode,
                COUNT(*)::BIGINT AS trades,
                ROUND(AVG(CASE WHEN is_clean_step THEN 1.0 ELSE 0.0 END), 4) AS cleanRate,
                ROUND(AVG(y_strategy_session_drift), 4) AS driftRate,
                ROUND(AVG(y_tilt_risk_escalation), 4) AS tiltRate
            FROM read_parquet('{path_sql}')
            GROUP BY execution_mode
            ORDER BY trades DESC
            """
        ).fetchall()

        strat_rows = con.execute(
            f"""
            SELECT
                effective_strategy AS strategy,
                COUNT(*)::BIGINT AS trades,
                ROUND(AVG(CASE WHEN is_clean_step THEN 1.0 ELSE 0.0 END), 4) AS cleanRate,
                ROUND(AVG(y_tilt_risk_escalation), 4) AS tiltRate,
                ROUND(AVG(y_revenge_trading), 4) AS revengeRate
            FROM read_parquet('{path_sql}')
            GROUP BY effective_strategy
            ORDER BY trades DESC
            LIMIT 10
            """
        ).fetchall()
    finally:
        con.close()

    by_session = [
        {
            "session": r[0],
            "trades": int(r[1]),
            "avgVolumeRatio": float(r[2] or 0.0),
            "avgCadenceBurst": float(r[3] or 0.0),
            "revengeRate": float(r[4] or 0.0),
            "overtradingRate": float(r[5] or 0.0),
            "cleanRate": float(r[6] or 0.0),
        }
        for r in session_rows
    ]
    by_mode = [
        {
            "executionMode": r[0],
            "trades": int(r[1]),
            "cleanRate": float(r[2] or 0.0),
            "driftRate": float(r[3] or 0.0),
            "tiltRate": float(r[4] or 0.0),
        }
        for r in mode_rows
    ]
    by_strat = [
        {
            "strategy": r[0],
            "trades": int(r[1]),
            "cleanRate": float(r[2] or 0.0),
            "tiltRate": float(r[3] or 0.0),
            "revengeRate": float(r[4] or 0.0),
        }
        for r in strat_rows
    ]

    return BehaviorAnalyticsResponse(
        status="ok",
        datasetExists=True,
        totalRows=int(totals[0] or 0) if totals else 0,
        realDbRows=int(totals[1] or 0) if totals else 0,
        syntheticRows=int(totals[2] or 0) if totals else 0,
        bySession=by_session,
        byExecutionMode=by_mode,
        byStrategyTop=by_strat,
        modelComparison=model_comparison,
    )
