"""Risk-level calibration for the behaviour model, validated against real trade outcomes.

The model's fixed rule ("any class >= 0.80 or anomaly >= 85 -> CRITICAL") marked 46% of
real trades CRITICAL, and those trades did better on average than LOW ones: informational
patterns (session drift, euphoria) were counted as risk. This module:

1. scores each trade only on the harmful patterns (+ anomaly as a secondary signal),
2. sets the level cut-offs by percentile so CRITICAL stays rare,
3. checks on the stored predictions that the levels order the real outcomes
   (higher level -> higher loss rate, lower average P&L), and
4. writes the cut-offs to a JSON file the prediction service reads at load time.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np

RISK_LEVELS = ("LOW", "MODERATE", "HIGH", "CRITICAL")

# Patterns that describe a loss of discipline. Drift and euphoria are reported as flags,
# but they are not risk by themselves (on real data they came with better-than-average trades).
HARM_CLASSES = ("revenge_trading", "tilt_risk_escalation", "prop_guardrail_breach_risk", "overtrading_fomo")

# Share of trades per level, highest first (CRITICAL top 8%, HIGH next 12%, MODERATE next 25%).
DEFAULT_TARGET_SHARES = {"CRITICAL": 0.08, "HIGH": 0.12, "MODERATE": 0.25}

CALIBRATION_FILE = Path(__file__).resolve().parents[2] / "artifacts" / "behavior_ml" / "risk_calibration.json"


@dataclass(frozen=True)
class RiskFormula:
    name: str
    harm_classes: tuple[str, ...]
    anomaly_weight: float  # anomaly (0-100) contributes anomaly_weight * anomaly / 100

    def score(self, probabilities: dict[str, float], anomaly: float) -> float:
        harm = max((float(probabilities.get(c, 0.0)) for c in self.harm_classes), default=0.0)
        return float(max(harm, self.anomaly_weight * float(anomaly or 0.0) / 100.0))


CANDIDATE_FORMULAS = (
    RiskFormula("harm_only", HARM_CLASSES, 0.0),
    RiskFormula("harm_plus_anomaly_0.6", HARM_CLASSES, 0.6),
    RiskFormula("harm_plus_anomaly_0.85", HARM_CLASSES, 0.85),
    RiskFormula("revenge_tilt_only", ("revenge_trading", "tilt_risk_escalation"), 0.0),
    RiskFormula(
        "legacy_all_classes_0.85",
        (
            "revenge_trading",
            "overtrading_fomo",
            "tilt_risk_escalation",
            "strategy_session_drift",
            "overconfidence_euphoria",
            "prop_guardrail_breach_risk",
        ),
        0.85,
    ),
)


@dataclass
class RiskCalibration:
    formula: RiskFormula
    cutoffs: dict[str, float]  # minimum score for MODERATE, HIGH, CRITICAL
    validation: dict[str, Any] = field(default_factory=dict)

    def level(self, probabilities: dict[str, float], anomaly: float) -> str:
        s = self.formula.score(probabilities, anomaly)
        if s >= self.cutoffs["CRITICAL"]:
            return "CRITICAL"
        if s >= self.cutoffs["HIGH"]:
            return "HIGH"
        if s >= self.cutoffs["MODERATE"]:
            return "MODERATE"
        return "LOW"

    def to_json(self, sample_size: int, target_shares: dict[str, float]) -> dict[str, Any]:
        return {
            "version": 1,
            "computedAt": datetime.now(timezone.utc).isoformat(),
            "formula": {
                "name": self.formula.name,
                "harmClasses": list(self.formula.harm_classes),
                "anomalyWeight": self.formula.anomaly_weight,
            },
            "cutoffs": {k: round(v, 6) for k, v in self.cutoffs.items()},
            "targetShares": target_shares,
            "sampleSize": sample_size,
            "validation": self.validation,
        }

    @staticmethod
    def from_json(data: dict[str, Any]) -> "RiskCalibration":
        f = data["formula"]
        formula = RiskFormula(str(f["name"]), tuple(f["harmClasses"]), float(f["anomalyWeight"]))
        cutoffs = {k: float(data["cutoffs"][k]) for k in ("MODERATE", "HIGH", "CRITICAL")}
        if not (cutoffs["MODERATE"] <= cutoffs["HIGH"] <= cutoffs["CRITICAL"]):
            raise ValueError("risk cut-offs must be ordered MODERATE <= HIGH <= CRITICAL")
        return RiskCalibration(formula=formula, cutoffs=cutoffs, validation=data.get("validation", {}))


def load_risk_calibration(path: Path = CALIBRATION_FILE) -> RiskCalibration | None:
    if not path.exists():
        return None
    try:
        return RiskCalibration.from_json(json.loads(path.read_text(encoding="utf-8")))
    except Exception:
        return None


def percentile_cutoffs(scores: np.ndarray, target_shares: dict[str, float]) -> dict[str, float]:
    crit = 1.0 - target_shares["CRITICAL"]
    high = crit - target_shares["HIGH"]
    mod = high - target_shares["MODERATE"]
    q = np.quantile(scores, [mod, high, crit])
    # A level never starts below a meaningful probability, even if most trades score low.
    return {"MODERATE": float(max(q[0], 0.35)), "HIGH": float(max(q[1], 0.55)), "CRITICAL": float(max(q[2], 0.75))}


def outcome_by_level(levels: list[str], pnls: np.ndarray) -> dict[str, dict[str, float]]:
    out: dict[str, dict[str, float]] = {}
    for lvl in RISK_LEVELS:
        mask = np.array([l == lvl for l in levels])
        n = int(mask.sum())
        out[lvl] = {
            "n": n,
            "share": round(n / max(1, len(levels)), 4),
            "avgPnl": round(float(pnls[mask].mean()), 2) if n else 0.0,
            "lossRate": round(float((pnls[mask] < 0).mean()), 4) if n else 0.0,
        }
    return out


def monotonicity(stats: dict[str, dict[str, float]], min_n: int = 5) -> float:
    """Spearman-like agreement between level order and loss rate, over levels with enough trades."""
    pts = [(i, stats[l]["lossRate"]) for i, l in enumerate(RISK_LEVELS) if stats[l]["n"] >= min_n]
    if len(pts) < 2:
        return 0.0
    ranks = np.array([p[0] for p in pts], dtype=float)
    loss = np.array([p[1] for p in pts], dtype=float)
    if loss.std() == 0:
        return 0.0
    return float(np.corrcoef(ranks, np.argsort(np.argsort(loss)).astype(float))[0, 1])


def calibrate(
    rows: list[dict[str, Any]],
    target_shares: dict[str, float] | None = None,
) -> dict[str, Any]:
    """rows: [{"probabilities": {...}, "anomalyScore": float, "netPnl": float, "riskLevel": str?}]

    `riskLevel` is the level stored in production; when present it is the baseline to beat.
    """
    target_shares = target_shares or DEFAULT_TARGET_SHARES
    pnls = np.array([float(r["netPnl"] or 0.0) for r in rows])
    candidates = []
    for formula in CANDIDATE_FORMULAS:
        scores = np.array([formula.score(r["probabilities"] or {}, r["anomalyScore"] or 0.0) for r in rows])
        cal = RiskCalibration(formula=formula, cutoffs=percentile_cutoffs(scores, target_shares))
        levels = [cal.level(r["probabilities"] or {}, r["anomalyScore"] or 0.0) for r in rows]
        stats = outcome_by_level(levels, pnls)
        crit_vs_low = stats["CRITICAL"]["lossRate"] - stats["LOW"]["lossRate"] if stats["CRITICAL"]["n"] else 0.0
        cal.validation = {
            "byLevel": stats,
            "monotonicity": round(monotonicity(stats), 4),
            "criticalMinusLowLossRate": round(crit_vs_low, 4),
        }
        candidates.append(cal)

    # A formula must keep at least 3 levels with real trades in them: two points always look
    # perfectly ordered and a near-binary split loses the graded signal the UI shows.
    def populated_levels(c: RiskCalibration) -> int:
        return sum(1 for s in c.validation["byLevel"].values() if s["n"] >= 5)

    eligible = [
        c for c in candidates if not c.formula.name.startswith("legacy") and populated_levels(c) >= 3
    ] or [c for c in candidates if not c.formula.name.startswith("legacy")]
    best = max(
        eligible,
        key=lambda c: (c.validation["monotonicity"], c.validation["criticalMinusLowLossRate"]),
    )

    production: dict[str, Any] | None = None
    if all(r.get("riskLevel") in RISK_LEVELS for r in rows):
        stats = outcome_by_level([r["riskLevel"] for r in rows], pnls)
        production = {
            "byLevel": stats,
            "monotonicity": round(monotonicity(stats), 4),
            "criticalMinusLowLossRate": round(stats["CRITICAL"]["lossRate"] - stats["LOW"]["lossRate"], 4)
            if stats["CRITICAL"]["n"]
            else 0.0,
        }
    baseline_mono = production["monotonicity"] if production else 0.0
    return {
        "sampleSize": len(rows),
        "best": best,
        "candidates": candidates,
        "production": production,
        # Publish only when the new levels order real outcomes better than production does.
        "recommendApply": bool(
            best.validation["monotonicity"] > max(0.0, baseline_mono)
            and best.validation["criticalMinusLowLossRate"] > 0
        ),
    }
