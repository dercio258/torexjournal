"""Weekly Torex AI lab.

    python scripts/run_ai_lab.py                    # dry-run: read-only, writes only the JSON report
    python scripts/run_ai_lab.py --no-embeddings    # lexical-only, no calls to Gemini
    python scripts/run_ai_lab.py --apply            # publish tuned params (if better) + trust updates

Schedule it weekly (cron / Windows Task Scheduler) once the dry-run report looks right.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.ai_lab.runner import run_lab, summarize  # noqa: E402


def main() -> int:
    # Windows consoles default to cp1252; the summary has non-ASCII characters.
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    parser = argparse.ArgumentParser(description="Torex AI evaluation and tuning lab")
    parser.add_argument("--days", type=int, default=30, help="window of conversations to analyse")
    parser.add_argument("--no-embeddings", action="store_true", help="lexical-only evaluation, no Gemini calls")
    parser.add_argument("--apply", action="store_true", help="write tuned params and trust updates to the DB")
    parser.add_argument("--trials", type=int, default=300)
    parser.add_argument("--precision-floor", type=float, default=0.98)
    args = parser.parse_args()

    report = run_lab(
        days=args.days,
        use_embeddings=not args.no_embeddings,
        apply=args.apply,
        trials=args.trials,
        precision_floor=args.precision_floor,
    )
    print(summarize(report))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
