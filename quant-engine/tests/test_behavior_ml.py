from __future__ import annotations

from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
import sys

from fastapi.testclient import TestClient
import numpy as np
import pg8000.dbapi
import polars as pl
import pytest

ROOT_DIR = Path(__file__).resolve().parent.parent
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from app.behavior_ml.dataset_builder import (
    DEFAULT_MANIFEST_PATH,
    DEFAULT_PARQUET_PATH,
    _load_db_env,
    _parse_json_obj,
    build_behavior_dataset,
)
from app.behavior_ml.drift_and_store import build_reference_drift_stats, compute_batch_drift
from app.behavior_ml.features import CONT_FEATURE_NAMES, extract_causal_sequence
from app.behavior_ml.schemas import (
    BEHAVIOR_CLASSES,
    AccountContextInput,
    AnalyzeImportedTradesRequest,
    ImportedTradeRecord,
)
from app.behavior_ml.service import BehaviorMlEngine
from app.behavior_ml.trainer import train_behavior_model
from app.main import app


def _make_baseline_trades(count: int = 12, magic: int = 0) -> list[ImportedTradeRecord]:
    start = datetime(2026, 9, 1, 9, 0, tzinfo=timezone.utc)
    trades: list[ImportedTradeRecord] = []
    for i in range(count):
        open_dt = start + timedelta(hours=i * 4)
        close_dt = open_dt + timedelta(minutes=45)
        pnl = 120.0 if i % 2 == 0 else -70.0
        trades.append(
            ImportedTradeRecord(
                id=f"tr-{i}",
                ticket=f"100{i}",
                symbol="XAUUSD",
                type="BUY",
                volume=0.20,
                openPrice=2650.0,
                closePrice=2655.0 if pnl > 0 else 2646.0,
                sl=2640.0,
                tp=2670.0,
                profit=pnl,
                netPnl=pnl,
                openTime=open_dt.isoformat(),
                closeTime=close_dt.isoformat(),
                magic=magic,
                session="London",
                setup="SMC_OB" if magic == 0 else None,
            )
        )
    return trades


def test_strict_causal_anti_leakage():
    trades_win = _make_baseline_trades(12)
    trades_loss = _make_baseline_trades(12)

    # Flip outcome on step 10 only
    trades_win[10].profit = 500.0
    trades_win[10].netPnl = 500.0
    trades_loss[10].profit = -500.0
    trades_loss[10].netPnl = -500.0

    seq_win = extract_causal_sequence(trades_win, account_type="live", initial_balance=10000.0)
    seq_loss = extract_causal_sequence(trades_loss, account_type="live", initial_balance=10000.0)

    # Step 10 features and categories MUST be 100% blind to step 10's own profit/netPnl
    assert np.allclose(seq_win["cont"][10], seq_loss["cont"][10], atol=1e-6)
    assert np.array_equal(seq_win["cats"][10], seq_loss["cats"][10])

    # Step 11 (opened after step 10 closed) MUST observe the prior closed PnL difference
    assert not np.allclose(seq_win["cont"][11], seq_loss["cont"][11], atol=1e-5)

    engine = BehaviorMlEngine(checkpoint_path=Path("/nonexistent/bootstrap.pt"))
    res_win = engine.analyze_trades(
        AnalyzeImportedTradesRequest(
            accountContext=AccountContextInput(accountType="live", initialBalance=10000.0),
            historicalTrades=trades_win[:10],
            newTrades=[trades_win[10]],
        )
    )
    res_loss = engine.analyze_trades(
        AnalyzeImportedTradesRequest(
            accountContext=AccountContextInput(accountType="live", initialBalance=10000.0),
            historicalTrades=trades_loss[:10],
            newTrades=[trades_loss[10]],
        )
    )
    assert res_win.tradePredictions[0].probabilities == res_loss.tradePredictions[0].probabilities
    assert res_win.tradePredictions[0].anomalyScore == res_loss.tradePredictions[0].anomalyScore


def test_trained_pytorch_detects_revenge_tilt_and_ea_drift(tmp_path: Path):
    parquet_path = tmp_path / "features.parquet"
    manifest_path = tmp_path / "manifest.json"
    ckpt_path = tmp_path / "torex_behavior_net.pt"
    metrics_path = tmp_path / "metrics.json"
    report_path = tmp_path / "report.md"

    df, manifest = build_behavior_dataset(
        include_real_db=False,
        synthetic_accounts=25,
        seed=7,
        parquet_path=parquet_path,
        manifest_path=manifest_path,
    )
    assert manifest["totalRows"] > 500
    assert parquet_path.exists()

    metrics = train_behavior_model(
        parquet_path=parquet_path,
        checkpoint_path=ckpt_path,
        metrics_path=metrics_path,
        report_path=report_path,
        epochs=14,
        seq_len=20,
        seed=7,
    )
    assert ckpt_path.exists()
    assert metrics["validationOverall"]["macroRocAuc"] >= 0.78

    # Phase 1 honest evaluation: metrics come from a holdout disjoint from calibration
    assert metrics["holdoutIsCalibration"] is False
    assert metrics["calibrationSamples"] > 0 and metrics["holdoutSamples"] > 0
    assert metrics["calibrationSamples"] + metrics["holdoutSamples"] == metrics["valSamples"]
    assert metrics["validationOverall"]["samples"] == metrics["holdoutSamples"]
    assert 0.0 <= metrics["holdoutWeakRulePositiveShare"] <= 1.0
    assert "SYNTHETIC_ARCHETYPE" in metrics["labelProvenance"]["holdout"]
    # No real DB rows in this dataset, so the gate must say the real-account check was skipped
    assert metrics["validationRealDb"]["samples"] == 0
    assert any("real-account check skipped" in r for r in metrics["promotionGateReasons"])
    assert "holdout" in report_path.read_text(encoding="utf-8")
    assert "labelProvenance" in manifest and "hashBucketDiagnostics" in manifest

    engine = BehaviorMlEngine(checkpoint_path=ckpt_path)

    # 1. Compare disciplined trade vs revenge/tilt trade on same historical base
    base = _make_baseline_trades(15)
    # Put 3 consecutive losses right before the target trade
    for idx in (12, 13, 14):
        base[idx].profit = -140.0
        base[idx].netPnl = -140.0

    last_close = datetime.fromisoformat(str(base[-1].closeTime))

    clean_trade = ImportedTradeRecord(
        id="tr-clean",
        ticket="2001",
        symbol="XAUUSD",
        type="BUY",
        volume=0.20,
        openPrice=2650.0,
        closePrice=2660.0,
        sl=2640.0,
        tp=2670.0,
        profit=100.0,
        openTime=(last_close + timedelta(hours=3)).isoformat(),
        closeTime=(last_close + timedelta(hours=4)).isoformat(),
        magic=0,
        session="London",
        setup="SMC_OB",
    )
    revenge_trade = ImportedTradeRecord(
        id="tr-revenge",
        ticket="2002",
        symbol="BTCUSD",
        type="SELL",
        volume=0.60,  # 3x median
        openPrice=91000.0,
        closePrice=90500.0,
        sl=None,  # dropped SL
        tp=None,
        profit=-350.0,
        openTime=(last_close + timedelta(minutes=2)).isoformat(),
        closeTime=(last_close + timedelta(minutes=8)).isoformat(),
        magic=0,
        session="Off-Session",
        setup=None,
    )

    clean_res = engine.analyze_trades(
        AnalyzeImportedTradesRequest(
            accountContext=AccountContextInput(accountType="live", initialBalance=10000.0),
            historicalTrades=base,
            newTrades=[clean_trade],
            locale="pt",
        )
    )
    rev_res = engine.analyze_trades(
        AnalyzeImportedTradesRequest(
            accountContext=AccountContextInput(accountType="live", initialBalance=10000.0),
            historicalTrades=base,
            newTrades=[revenge_trade],
            locale="pt",
        )
    )

    c_pred = clean_res.tradePredictions[0]
    r_pred = rev_res.tradePredictions[0]
    assert rev_res.modelStatus == "TRAINED_PYTORCH"
    assert r_pred.probabilities["revenge_trading"] > c_pred.probabilities["revenge_trading"] + 0.25
    assert r_pred.probabilities["tilt_risk_escalation"] > c_pred.probabilities["tilt_risk_escalation"] + 0.20
    assert r_pred.anomalyScore > c_pred.anomalyScore
    assert len(r_pred.reasons) >= 1

    # 2. Verify EA-dominated account detects manual override & session drift
    ea_base = _make_baseline_trades(14, magic=88001)
    ea_last_close = datetime.fromisoformat(str(ea_base[-1].closeTime))
    manual_override = ImportedTradeRecord(
        id="tr-manual-ea",
        ticket="3001",
        symbol="BTCUSD",
        type="BUY",
        volume=0.45,
        openPrice=91000.0,
        closePrice=90800.0,
        sl=None,
        profit=-120.0,
        openTime=(ea_last_close + timedelta(minutes=5)).isoformat(),
        closeTime=(ea_last_close + timedelta(minutes=15)).isoformat(),
        magic=0,
        session="Off-Session",
    )
    ea_res = engine.analyze_trades(
        AnalyzeImportedTradesRequest(
            accountContext=AccountContextInput(accountType="live", initialBalance=10000.0),
            historicalTrades=ea_base,
            newTrades=[manual_override],
            locale="en",
        )
    )
    ea_pred = ea_res.tradePredictions[0]
    assert ea_pred.executionMode == "MANUAL_ON_EA_ACCOUNT"
    assert ea_pred.effectiveSession == "Off-Session"
    assert ea_res.batchSummary.manualEaOverrideCount == 1
    assert ea_res.batchSummary.ensembleMode == "HYBRID_PYTORCH_LIGHTGBM"
    assert ea_res.batchSummary.traderProfile == "EA_HYBRID_OPERATOR"
    assert any("EA" in r for r in ea_pred.reasons)


def test_human_feedback_override_and_drift_detection():
    base = _make_baseline_trades(14)
    # Force weak-supervision trigger on final trade (high volume + short gap + loss streak)
    for idx in (10, 11, 12):
        base[idx].profit = -160.0
        base[idx].netPnl = -160.0
    last_close = datetime.fromisoformat(str(base[12].closeTime))
    base[13].openTime = (last_close + timedelta(minutes=2)).isoformat()
    base[13].closeTime = (last_close + timedelta(minutes=12)).isoformat()
    base[13].volume = 0.80  # 4x median
    base[13].sl = None

    seq_unlabelled = extract_causal_sequence(base, account_type="live", initial_balance=10000.0, compute_labels=True)
    assert seq_unlabelled["targets"][13].sum() >= 1.0
    assert seq_unlabelled["weights"][13] == pytest.approx(1.0)

    # Now apply Human-in-the-Loop FALSE_POSITIVE override with no active flags
    base_fb = [t.model_copy(deep=True) for t in base]
    base_fb[13].feedbackVerdict = "FALSE_POSITIVE"
    base_fb[13].feedbackFlags = []

    seq_feedback = extract_causal_sequence(base_fb, account_type="live", initial_balance=10000.0, compute_labels=True)
    # CRITICAL: X_t features must stay 100% invariant (zero label leakage into features)
    assert np.allclose(seq_unlabelled["cont"][13], seq_feedback["cont"][13], atol=1e-6)
    assert np.array_equal(seq_unlabelled["cats"][13], seq_feedback["cats"][13])
    # Labels zeroed and weighted 5.0x
    assert seq_feedback["targets"][13].sum() == pytest.approx(0.0)
    assert seq_feedback["weights"][13] == pytest.approx(5.0)

    # Confirm override with specific corrected flag
    base_fb[13].feedbackVerdict = "CONFIRM"
    base_fb[13].feedbackFlags = ["strategy_session_drift"]
    seq_confirm = extract_causal_sequence(base_fb, account_type="live", initial_balance=10000.0, compute_labels=True)
    strat_idx = BEHAVIOR_CLASSES.index("strategy_session_drift")
    assert seq_confirm["targets"][13, strat_idx] == pytest.approx(1.0)
    assert seq_confirm["weights"][13] == pytest.approx(5.0)

    # SciPy PSI/KS drift detector
    rng = np.random.default_rng(123)
    train_ref = rng.normal(loc=1.0, scale=0.25, size=(120, len(CONT_FEATURE_NAMES))).astype(np.float32)
    ref_stats = build_reference_drift_stats(train_ref)

    in_dist = rng.normal(loc=1.0, scale=0.25, size=(24, len(CONT_FEATURE_NAMES))).astype(np.float32)
    no_drift = compute_batch_drift(in_dist, ref_stats)
    assert no_drift["driftDetected"] is False

    shifted = rng.normal(loc=6.5, scale=0.35, size=(24, len(CONT_FEATURE_NAMES))).astype(np.float32)
    with_drift = compute_batch_drift(shifted, ref_stats)
    assert with_drift["driftDetected"] is True
    assert with_drift["maxPsi"] >= 0.25
    assert len(with_drift["driftedFeatures"]) >= 1


def test_fastapi_behavior_ml_endpoints():
    client = TestClient(app)

    status_res = client.get("/api/ml/behavior/status")
    assert status_res.status_code == 200
    status_body = status_res.json()
    assert status_body["status"] == "ok"
    assert status_body["continuousFeatureCount"] == len(CONT_FEATURE_NAMES)
    assert status_body["behaviorClasses"] == list(BEHAVIOR_CLASSES)

    analytics_res = client.get("/api/ml/behavior/analytics")
    assert analytics_res.status_code == 200
    analytics_body = analytics_res.json()
    assert analytics_body["status"] in {"ok", "dataset_missing"}

    reload_res = client.post("/api/ml/behavior/reload")
    assert reload_res.status_code == 200
    reload_body = reload_res.json()
    assert reload_body["status"] == "ok"
    assert isinstance(reload_body["ensembleExists"], bool)

    trades = _make_baseline_trades(10)
    analyze_res = client.post(
        "/api/ml/behavior/analyze-trades",
        json={
            "accountContext": {
                "accountId": "acc-test-1",
                "accountType": "challenge",
                "initialBalance": 10000.0,
                "dailyLossLimit": 400.0,
            },
            "historicalTrades": [t.model_dump() for t in trades[:7]],
            "newTrades": [t.model_dump() for t in trades[7:]],
            "locale": "pt",
        },
    )
    assert analyze_res.status_code == 200
    body = analyze_res.json()
    assert body["batchSummary"]["totalEvaluated"] == 3
    assert "traderProfile" in body["batchSummary"]
    assert body["batchSummary"]["ensembleMode"] in {"HYBRID_PYTORCH_LIGHTGBM", "PYTORCH_ONLY"}
    assert len(body["tradePredictions"]) == 3
    for pred in body["tradePredictions"]:
        assert set(pred["probabilities"].keys()) == set(BEHAVIOR_CLASSES)
        assert 0.0 <= pred["anomalyScore"] <= 100.0


def test_postgres_backfill_integrity_and_artifact_pii_safety():
    assert DEFAULT_MANIFEST_PATH.exists(), f"Missing manifest at {DEFAULT_MANIFEST_PATH}"
    assert DEFAULT_PARQUET_PATH.exists(), f"Missing parquet dataset at {DEFAULT_PARQUET_PATH}"

    manifest = json.loads(DEFAULT_MANIFEST_PATH.read_text(encoding="utf-8"))
    assert manifest["piiSanitized"] is True
    assert manifest["totalRows"] >= 500

    schema = pl.read_parquet_schema(DEFAULT_PARQUET_PATH)
    forbidden_cols = {"email", "password", "name", "phone", "userId", "user_id", "login", "mt5_id"}
    assert forbidden_cols.isdisjoint(set(schema.keys())), (
        f"Unexpected sensitive columns in Parquet: {forbidden_cols.intersection(set(schema.keys()))}"
    )

    cfg = _load_db_env()
    conn = pg8000.dbapi.connect(
        host=cfg["host"],
        port=cfg["port"],
        user=cfg["user"],
        password=cfg["password"],
        database=cfg["database"],
        timeout=10,
    )
    try:
        cur = conn.cursor()
        cur.execute("SET statement_timeout = '15s'")
        cur.execute(
            """
            SELECT t.id::text, t."qualityFlags"
            FROM trades t
            JOIN accounts a ON a.id::text = t.account_id
            WHERE COALESCE(a.is_archived, false) = false
              AND t.status = 'CLOSED'
              AND t.open_time IS NOT NULL
            """
        )
        rows = cur.fetchall()
    finally:
        conn.close()

    assert len(rows) > 0
    valid_risks = {"LOW", "MODERATE", "HIGH", "CRITICAL"}
    for trade_id, qf_raw in rows:
        qf = _parse_json_obj(qf_raw)
        ml = qf.get("behavioralMl")
        assert isinstance(ml, dict), f"Missing behavioralMl for CLOSED trade {trade_id}"
        assert ml.get("riskLevel") in valid_risks, f"Invalid riskLevel for {trade_id}: {ml.get('riskLevel')}"
        score = float(ml.get("anomalyScore"))
        assert 0.0 <= score <= 100.0, f"Out-of-range anomalyScore for {trade_id}: {score}"
        assert str(ml.get("modelVersion", "")).startswith("torex-behavior-"), (
            f"Unexpected modelVersion for {trade_id}: {ml.get('modelVersion')}"
        )
        probs = ml.get("probabilities")
        assert isinstance(probs, dict) and set(probs.keys()) == set(BEHAVIOR_CLASSES), (
            f"Incomplete class probabilities for {trade_id}"
        )
