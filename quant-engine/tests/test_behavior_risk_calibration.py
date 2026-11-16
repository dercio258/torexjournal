"""Risk-level calibration: harmful patterns only, rare CRITICAL, validated on outcomes."""

from __future__ import annotations

import json

import numpy as np
import pytest

from app.behavior_ml import risk_calibration as rc
from app.behavior_ml.risk_calibration import RiskCalibration, RiskFormula, calibrate, percentile_cutoffs


def _row(harm: float, drift: float, anomaly: float, pnl: float, level: str | None = None) -> dict:
    return {
        "probabilities": {
            "revenge_trading": harm,
            "tilt_risk_escalation": harm * 0.9,
            "overtrading_fomo": 0.1,
            "prop_guardrail_breach_risk": 0.05,
            "strategy_session_drift": drift,
            "overconfidence_euphoria": drift,
        },
        "anomalyScore": anomaly,
        "netPnl": pnl,
        **({"riskLevel": level} if level else {}),
    }


def _synthetic(n: int = 300, seed: int = 3) -> list[dict]:
    rng = np.random.default_rng(seed)
    rows = []
    for _ in range(n):
        harm = float(rng.beta(1.2, 4))
        drift = float(rng.uniform(0, 1))
        pnl = float(rng.normal(150 - 600 * harm, 120))  # more harm -> worse outcome
        # production marked anything with a high informational score as CRITICAL
        level = "CRITICAL" if max(harm, drift) >= 0.8 else ("LOW" if max(harm, drift) < 0.45 else "MODERATE")
        rows.append(_row(harm, drift, float(rng.uniform(20, 80)), pnl, level))
    return rows


def test_informational_patterns_do_not_raise_risk() -> None:
    f = RiskFormula("harm", rc.HARM_CLASSES, 0.0)
    assert f.score(_row(0.1, 0.99, 0, 0)["probabilities"], 0) == pytest.approx(0.1)


def test_percentile_cutoffs_keep_critical_rare_and_have_floors() -> None:
    scores = np.linspace(0, 1, 1001)
    c = percentile_cutoffs(scores, rc.DEFAULT_TARGET_SHARES)
    assert c["CRITICAL"] == pytest.approx(0.92, abs=1e-3)
    assert c["MODERATE"] <= c["HIGH"] <= c["CRITICAL"]
    low = percentile_cutoffs(np.zeros(100), rc.DEFAULT_TARGET_SHARES)
    assert low == {"MODERATE": 0.35, "HIGH": 0.55, "CRITICAL": 0.75}


def test_calibration_orders_outcomes_better_than_production() -> None:
    result = calibrate(_synthetic())
    best = result["best"]
    stats = best.validation["byLevel"]
    assert stats["CRITICAL"]["share"] <= 0.12
    assert stats["CRITICAL"]["lossRate"] > stats["LOW"]["lossRate"]
    assert best.validation["monotonicity"] > result["production"]["monotonicity"]
    assert result["recommendApply"] is True
    assert not best.formula.name.startswith("legacy")


def test_calibration_round_trips_through_json(tmp_path) -> None:
    result = calibrate(_synthetic())
    path = tmp_path / "risk_calibration.json"
    path.write_text(json.dumps(result["best"].to_json(300, rc.DEFAULT_TARGET_SHARES)), encoding="utf-8")
    loaded = rc.load_risk_calibration(path)
    assert loaded is not None
    probe = _row(0.97, 0.1, 30, 0)
    assert loaded.level(probe["probabilities"], 30) == result["best"].level(probe["probabilities"], 30)


def test_invalid_calibration_file_is_ignored(tmp_path) -> None:
    path = tmp_path / "bad.json"
    path.write_text(json.dumps({"formula": {"name": "x", "harmClasses": [], "anomalyWeight": 0},
                                "cutoffs": {"MODERATE": 0.9, "HIGH": 0.5, "CRITICAL": 0.7}}), encoding="utf-8")
    assert rc.load_risk_calibration(path) is None
    assert rc.load_risk_calibration(tmp_path / "missing.json") is None


def test_levels_follow_cutoffs() -> None:
    cal = RiskCalibration(RiskFormula("harm", rc.HARM_CLASSES, 0.6), {"MODERATE": 0.4, "HIGH": 0.6, "CRITICAL": 0.9})
    assert cal.level(_row(0.95, 0, 0, 0)["probabilities"], 0) == "CRITICAL"
    assert cal.level(_row(0.65, 0, 0, 0)["probabilities"], 0) == "HIGH"
    assert cal.level(_row(0.1, 0, 70, 0)["probabilities"], 70) == "MODERATE"  # 0.6 * 0.70 = 0.42
    assert cal.level(_row(0.1, 0.99, 10, 0)["probabilities"], 10) == "LOW"
