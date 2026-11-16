"""Calibrates the behaviour model's risk levels on stored predictions vs real trade outcomes.

    python scripts/calibrate_behavior_risk.py          # dry-run: prints the comparison, writes nothing
    python scripts/calibrate_behavior_risk.py --apply  # writes artifacts/behavior_ml/risk_calibration.json

The prediction service picks the file up on its next model load; existing trades keep
their stored level until the backfill runs again.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.ai_lab.db import connect, fetch_dicts  # noqa: E402
from app.behavior_ml.risk_calibration import (  # noqa: E402
    CALIBRATION_FILE,
    DEFAULT_TARGET_SHARES,
    calibrate,
)


def load_rows() -> list[dict]:
    with connect(read_only=True) as conn:
        rows = fetch_dicts(
            conn,
            """
            SELECT "qualityFlags"->'behavioralMl'->'probabilities' AS probabilities,
                   ("qualityFlags"->'behavioralMl'->>'anomalyScore')::float AS "anomalyScore",
                   "qualityFlags"->'behavioralMl'->>'riskLevel' AS "riskLevel",
                   "netPnl"::float AS "netPnl"
              FROM trades
             WHERE "qualityFlags" ? 'behavioralMl'
               AND "netPnl" IS NOT NULL
            """,
        )
    for r in rows:
        if isinstance(r["probabilities"], str):
            r["probabilities"] = json.loads(r["probabilities"])
    return rows


def fmt(stats: dict) -> str:
    return "  ".join(
        f"{lvl}: n={s['n']:>3} ({s['share']:.0%}) avg {s['avgPnl']:>+8.2f} loss {s['lossRate']:.0%}"
        for lvl, s in stats.items()
    )


def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()

    rows = load_rows()
    if len(rows) < 50:
        print(f"Only {len(rows)} trades with predictions: not enough to calibrate.")
        return 1
    result = calibrate(rows)
    print(f"Trades: {result['sampleSize']}")
    if result["production"]:
        p = result["production"]
        print(f"PRODUCTION  mono {p['monotonicity']:+.2f}  crit-low loss {p['criticalMinusLowLossRate']:+.0%}\n  {fmt(p['byLevel'])}")
    for c in result["candidates"]:
        v = c.validation
        print(f"{c.formula.name:<26} mono {v['monotonicity']:+.2f}  crit-low loss {v['criticalMinusLowLossRate']:+.0%}  cutoffs {json.dumps({k: round(x, 3) for k, x in c.cutoffs.items()})}\n  {fmt(v['byLevel'])}")
    best = result["best"]
    print(f"\nBest: {best.formula.name} | apply recommended: {result['recommendApply']}")

    if args.apply:
        if not result["recommendApply"]:
            print("Not applied: the new levels do not order real outcomes better than production.")
            return 2
        CALIBRATION_FILE.parent.mkdir(parents=True, exist_ok=True)
        CALIBRATION_FILE.write_text(
            json.dumps(best.to_json(result["sampleSize"], DEFAULT_TARGET_SHARES), indent=2),
            encoding="utf-8",
        )
        print(f"Written {CALIBRATION_FILE}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
