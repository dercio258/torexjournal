from __future__ import annotations

import argparse
from pathlib import Path
import sys

ROOT_DIR = Path(__file__).resolve().parent.parent
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from app.behavior_ml.dataset_builder import (
    DEFAULT_CHECKPOINT_PATH,
    DEFAULT_ENSEMBLE_PATH,
    DEFAULT_MANIFEST_PATH,
    DEFAULT_METRICS_PATH,
    DEFAULT_PARQUET_PATH,
    DEFAULT_REPORT_PATH,
    build_behavior_dataset,
)
from app.behavior_ml.trainer import train_behavior_model


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Build imported-trades behavioral Parquet dataset and train Hybrid PyTorch+LightGBM+Optuna Ensemble."
    )
    parser.add_argument("--epochs", type=int, default=28, help="Number of PyTorch training epochs.")
    parser.add_argument("--seq-len", type=int, default=20, help="Causal sequence window length (trades).")
    parser.add_argument(
        "--synthetic-accounts",
        type=int,
        default=60,
        help="Synthetic cold-start archetype accounts to mix alongside real DB trades.",
    )
    parser.add_argument(
        "--no-db",
        action="store_true",
        help="Skip PostgreSQL extraction and build using synthetic archetype sequences only.",
    )
    parser.add_argument(
        "--backfill-db",
        action="store_true",
        help="After training, score and persist behavioralMl onto real PostgreSQL CLOSED trades.",
    )
    args = parser.parse_args()

    print("[Torex Behavior ML] Step 1/3: Extracting imported trades & building causal Parquet dataset...")
    _, manifest = build_behavior_dataset(
        include_real_db=not args.no_db,
        synthetic_accounts=args.synthetic_accounts,
        parquet_path=DEFAULT_PARQUET_PATH,
        manifest_path=DEFAULT_MANIFEST_PATH,
    )
    print(
        f" - Dataset rows={manifest['totalRows']} | real_db={manifest['realDbRows']} "
        f"| synthetic={manifest['syntheticRows']} | train={manifest['trainRows']} | val={manifest['valRows']}"
    )
    print(f" - DB stats: {manifest['dbStats']}")
    print(f" - Positives by behavior: {manifest['positiveCounts']}")
    print(f" - Parquet saved: {DEFAULT_PARQUET_PATH}")

    print("\n[Torex Behavior ML] Step 2-3/3: Training PyTorch + LightGBM + IsolationForest + Optuna Hybrid Ensemble...")
    metrics = train_behavior_model(
        parquet_path=DEFAULT_PARQUET_PATH,
        checkpoint_path=DEFAULT_CHECKPOINT_PATH,
        ensemble_path=DEFAULT_ENSEMBLE_PATH,
        metrics_path=DEFAULT_METRICS_PATH,
        report_path=DEFAULT_REPORT_PATH,
        epochs=args.epochs,
        seq_len=args.seq_len,
    )
    pt = metrics["validationPytorchOnly"]
    gb = metrics["validationGbdtOnly"]
    hy = metrics["validationHybridEnsemble"]

    print(f" - Best PyTorch epoch={metrics['bestEpoch']}/{metrics['epochs']} | Backend={metrics['ensembleBackend']}")
    print(f" - PyTorch Only    | ROC-AUC={pt['macroRocAuc']:.4f} | F1={pt['macroF1']:.4f}")
    print(f" - Tabular GBDT    | ROC-AUC={gb['macroRocAuc']:.4f} | F1={gb['macroF1']:.4f}")
    print(f" - Hybrid Ensemble | ROC-AUC={hy['macroRocAuc']:.4f} | F1={hy['macroF1']:.4f}")
    if metrics.get("validationRealDb") and metrics["validationRealDb"]["samples"] > 0:
        print(
            f" - Real DB Val ({metrics['validationRealDb']['samples']} samples): "
            f"ROC-AUC={metrics['validationRealDb']['macroRocAuc']:.4f} "
            f"| F1={metrics['validationRealDb']['macroF1']:.4f}"
        )

    print("\nPer-class Hybrid validation summary:")
    for cls_name, cls_m in hy["perClass"].items():
        auc_txt = f"{cls_m['rocAuc']:.4f}" if cls_m["rocAuc"] is not None else "N/A"
        alpha = metrics.get("optunaBlendAlphas", {}).get(cls_name, 0.5)
        thresh = cls_m.get("threshold", 0.5)
        print(
            f"   {cls_name:28s} | pos={cls_m['positives']:3d} | a={alpha:.2f} thr={thresh:.2f} "
            f"| AUC={auc_txt:6s} | F1={cls_m['f1']:.4f} | P={cls_m['precision']:.4f} | R={cls_m['recall']:.4f}"
        )

    print(f"\n - PyTorch Checkpoint: {DEFAULT_CHECKPOINT_PATH}")
    print(f" - Hybrid Ensemble:    {DEFAULT_ENSEMBLE_PATH}")
    print(f" - Report:             {DEFAULT_REPORT_PATH}")

    if args.backfill_db and not args.no_db:
        from backfill_postgres_behavior_ml import backfill_postgres_behavior_ml

        print("\n[Torex Behavior ML] Step 4/4: Backfilling real PostgreSQL CLOSED trades...")
        bf_summary = backfill_postgres_behavior_ml()
        print(
            f" - Backfill updated={bf_summary['tradesUpdated']} trades across "
            f"{bf_summary['accountsScored']} accounts | flagged={bf_summary['flaggedTrades']} "
            f"| breakdown={bf_summary['riskBreakdown']}"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
