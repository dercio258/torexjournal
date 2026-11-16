from __future__ import annotations

import json
from pathlib import Path
import threading
from typing import Any, Literal, Optional

import joblib
import numpy as np
import torch
import torch.nn.functional as F

from .dataset_builder import (
    DEFAULT_CHECKPOINT_PATH,
    DEFAULT_ENSEMBLE_PATH,
    DEFAULT_METRICS_PATH,
    DEFAULT_PARQUET_PATH,
)
from .drift_and_store import (
    classify_trader_profile,
    compute_batch_drift,
    query_feature_store_analytics,
)
from .features import (
    CAT_VOCAB_SIZES,
    CONT_FEATURE_NAMES,
    extract_causal_sequence,
)
from .model import TorexBehaviorNet
from .schemas import (
    BEHAVIOR_CLASSES,
    BEHAVIOR_CLASS_LABELS,
    AnalyzeImportedTradesRequest,
    AnalyzeImportedTradesResponse,
    BatchBehaviorSummary,
    BehaviorAnalyticsResponse,
    BehaviorModelStatusResponse,
    ImportedTradeRecord,
    JournalContextItem,
    RecommendedAlertItem,
    TradeBehaviorPrediction,
)
from .risk_calibration import CALIBRATION_FILE, RiskCalibration, load_risk_calibration
from .tabular_ensemble import predict_with_hybrid_ensemble
from .trainer import MODEL_VERSION

_risk_calibration_cache: tuple[float, Optional[RiskCalibration]] = (-1.0, None)


def _current_risk_calibration() -> Optional[RiskCalibration]:
    """Reloads risk_calibration.json when it changes; None keeps the legacy fixed rules."""
    global _risk_calibration_cache
    try:
        mtime = CALIBRATION_FILE.stat().st_mtime if CALIBRATION_FILE.exists() else 0.0
    except OSError:
        mtime = 0.0
    if mtime != _risk_calibration_cache[0]:
        _risk_calibration_cache = (mtime, load_risk_calibration() if mtime else None)
    return _risk_calibration_cache[1]


DEFAULT_AE_QUANTILES: dict[str, float] = {
    "p50": 0.12,
    "p85": 0.30,
    "p95": 0.55,
    "p99": 0.90,
}


def _map_recon_error_to_anomaly_score(err: float, quantiles: dict[str, float]) -> float:
    p50 = max(1e-4, float(quantiles.get("p50", 0.12)))
    p85 = max(p50 + 1e-4, float(quantiles.get("p85", 0.30)))
    p95 = max(p85 + 1e-4, float(quantiles.get("p95", 0.55)))
    p99 = max(p95 + 1e-4, float(quantiles.get("p99", 0.90)))

    if err <= p50:
        score = 20.0 * (err / p50)
    elif err <= p85:
        score = 20.0 + 35.0 * ((err - p50) / (p85 - p50))
    elif err <= p95:
        score = 55.0 + 20.0 * ((err - p85) / (p95 - p85))
    elif err <= p99:
        score = 75.0 + 17.0 * ((err - p95) / (p99 - p95))
    else:
        excess = min(1.0, (err - p99) / max(p99, 0.25))
        score = 92.0 + 8.0 * excess
    return round(float(max(0.0, min(100.0, score))), 2)


def _format_reasons(
    meta: dict[str, Any],
    probs: dict[str, float],
    anomaly_score: float,
    locale: Literal["pt", "en"],
) -> list[str]:
    reasons: list[str] = []
    vol_ratio = meta["volume_ratio"]
    dt_min = max(1, int(round(meta["dt_prev_sec"] / 60.0)))
    loss_streak = meta["loss_streak_before"]
    win_streak = meta["win_streak_before"]
    trades_1h = meta["trades_last_1h"]

    if probs.get("revenge_trading", 0.0) >= 0.45 or (loss_streak >= 1 and meta["dt_prev_sec"] <= 900):
        if locale == "en":
            reasons.append(
                f"Re-entered {dt_min}m after a loss streak ({loss_streak}) with {vol_ratio:.2f}x median volume."
            )
        else:
            reasons.append(
                f"Reentrada rápida ({dt_min} min) após sequência de {loss_streak} perda(s) com lote {vol_ratio:.2f}x da mediana."
            )

    if probs.get("tilt_risk_escalation", 0.0) >= 0.45 or meta["sl_drop"] >= 0.5:
        if meta["sl_drop"] >= 0.5:
            reasons.append(
                "Stop Loss omitted despite account's normal SL discipline."
                if locale == "en"
                else "Stop Loss omitido mesmo em conta com histórico regular de proteção."
            )
        elif vol_ratio >= 1.5:
            reasons.append(
                f"Position size escalated to {vol_ratio:.2f}x of recent median."
                if locale == "en"
                else f"Escalada de lote para {vol_ratio:.2f}x da mediana recente."
            )

    if probs.get("overtrading_fomo", 0.0) >= 0.45 or trades_1h >= 3:
        reasons.append(
            f"High order burst: {trades_1h} prior entries inside the last 60 minutes."
            if locale == "en"
            else f"Rajada de cadência: {trades_1h} operações abertas nos últimos 60 minutos."
        )

    if probs.get("overconfidence_euphoria", 0.0) >= 0.45 or (win_streak >= 3 and vol_ratio >= 1.4):
        reasons.append(
            f"Size increased to {vol_ratio:.2f}x following a {win_streak}-win streak."
            if locale == "en"
            else f"Aumento de lote ({vol_ratio:.2f}x) após sequência de {win_streak} vitórias."
        )

    if meta["execution_mode"] == "MANUAL_ON_EA_ACCOUNT":
        reasons.append(
            "Manual entry detected on an EA-dominated account."
            if locale == "en"
            else "Interferência manual detectada numa conta operada majoritariamente por EA."
        )
    elif probs.get("strategy_session_drift", 0.0) >= 0.45 and (
        meta["unfamiliar_session"] or meta["unfamiliar_symbol"] or meta["rare_or_untagged_strategy"]
    ):
        reasons.append(
            f"Execution drifted into unusual session/asset ({meta['effective_session']} · {meta['symbol_token']})."
            if locale == "en"
            else f"Fuga do padrão operacional ({meta['effective_session']} · {meta['symbol_token']})."
        )

    if probs.get("prop_guardrail_breach_risk", 0.0) >= 0.45 or meta["prop_dd_util"] >= 0.60:
        pct = int(round(meta["prop_dd_util"] * 100))
        reasons.append(
            f"Trading aggressively near Prop Firm guardrail ({pct}% limit used)."
            if locale == "en"
            else f"Risco elevado próximo ao limite da Prop Firm ({pct}% do limite consumido)."
        )

    if not reasons and anomaly_score >= 70.0:
        reasons.append(
            f"Sequence deviates from account baseline (hybrid anomaly score {anomaly_score:.0f}/100)."
            if locale == "en"
            else f"Sequência foge da assinatura histórica da conta (anomalia híbrida {anomaly_score:.0f}/100)."
        )

    return reasons[:4]


class BehaviorMlEngine:
    """Thread-safe Hybrid PyTorch + LightGBM/IsolationForest inference engine."""

    def __init__(
        self,
        checkpoint_path: Path = DEFAULT_CHECKPOINT_PATH,
        ensemble_path: Optional[Path] = None,
    ) -> None:
        self.checkpoint_path = Path(checkpoint_path)
        self.ensemble_path = (
            Path(ensemble_path)
            if ensemble_path is not None
            else (
                DEFAULT_ENSEMBLE_PATH
                if self.checkpoint_path == DEFAULT_CHECKPOINT_PATH
                else self.checkpoint_path.parent / "torex_tabular_ensemble.joblib"
            )
        )
        self._lock = threading.Lock()
        self._loaded = False
        self._model: Optional[TorexBehaviorNet] = None
        self._ensemble: Optional[dict[str, Any]] = None
        self._model_version = MODEL_VERSION
        self._model_status: Literal["TRAINED_PYTORCH", "BOOTSTRAP_PYTORCH"] = "BOOTSTRAP_PYTORCH"
        self._seq_len = 20
        self._feature_mean = np.zeros((len(CONT_FEATURE_NAMES),), dtype=np.float32)
        self._feature_std = np.ones((len(CONT_FEATURE_NAMES),), dtype=np.float32)
        self._ae_quantiles = dict(DEFAULT_AE_QUANTILES)

    def ensure_loaded(self, force_reload: bool = False) -> None:
        with self._lock:
            if self._loaded and not force_reload:
                return
            self._ensemble = None
            if self.checkpoint_path.exists():
                payload = torch.load(self.checkpoint_path, map_location="cpu", weights_only=False)
                cfg = payload.get("modelConfig") or {}
                model = TorexBehaviorNet(**cfg)
                model.load_state_dict(payload["stateDict"])
                model.eval()
                self._model = model
                self._model_version = str(payload.get("modelVersion") or MODEL_VERSION)
                self._model_status = "TRAINED_PYTORCH"
                self._seq_len = int(payload.get("seqLen") or 20)
                self._feature_mean = np.asarray(payload["featureMean"], dtype=np.float32)
                self._feature_std = np.maximum(
                    np.asarray(payload["featureStd"], dtype=np.float32),
                    1e-3,
                )
                self._ae_quantiles = dict(payload.get("aeQuantiles") or DEFAULT_AE_QUANTILES)

                if self.ensemble_path.exists():
                    try:
                        loaded_ens = joblib.load(self.ensemble_path)
                        if isinstance(loaded_ens, dict) and "estimators" in loaded_ens:
                            self._ensemble = loaded_ens
                    except Exception:
                        self._ensemble = None
            else:
                torch.manual_seed(42)
                model = TorexBehaviorNet(
                    cont_dim=len(CONT_FEATURE_NAMES),
                    vocab_sizes=CAT_VOCAB_SIZES,
                )
                model.eval()
                self._model = model
                self._model_version = f"{MODEL_VERSION}-bootstrap"
                self._model_status = "BOOTSTRAP_PYTORCH"
                self._seq_len = 20
                self._feature_mean = np.zeros((len(CONT_FEATURE_NAMES),), dtype=np.float32)
                self._feature_std = np.ones((len(CONT_FEATURE_NAMES),), dtype=np.float32)
                self._ae_quantiles = dict(DEFAULT_AE_QUANTILES)
            self._loaded = True

    def get_status(self) -> BehaviorModelStatusResponse:
        self.ensure_loaded()
        metrics_data: Optional[dict[str, Any]] = None
        if DEFAULT_METRICS_PATH.exists():
            try:
                metrics_data = json.loads(DEFAULT_METRICS_PATH.read_text(encoding="utf-8"))
            except Exception:
                metrics_data = None

        coupled_libs = ["PyTorch (GRU + Causal Attention + AE)"]
        backend = "pytorch_only"
        if self._ensemble is not None:
            backend = f"hybrid_pytorch_{self._ensemble.get('backend', 'lightgbm')}"
            coupled_libs.extend(
                [
                    "LightGBM (Tabular GBDT)",
                    "scikit-learn (IsolationForest)",
                    "Optuna (Per-Class Blend & Threshold Optimization)",
                    "SciPy (Temperature Calibration & KS/PSI Drift)",
                    "DuckDB (Parquet Feature Store Analytics)",
                ]
            )

        return BehaviorModelStatusResponse(
            status="ok",
            modelVersion=self._model_version,
            modelStatus=self._model_status,
            checkpointExists=self.checkpoint_path.exists(),
            checkpointPath=str(self.checkpoint_path),
            datasetExists=DEFAULT_PARQUET_PATH.exists(),
            ensembleExists=self._ensemble is not None,
            ensembleBackend=backend,
            coupledLibraries=coupled_libs,
            behaviorClasses=list(BEHAVIOR_CLASSES),
            continuousFeatureCount=len(CONT_FEATURE_NAMES),
            categoricalVocabSizes=dict(CAT_VOCAB_SIZES),
            trainingMetrics=metrics_data,
        )

    def get_analytics(self) -> BehaviorAnalyticsResponse:
        return query_feature_store_analytics(DEFAULT_PARQUET_PATH, DEFAULT_METRICS_PATH)

    def analyze_trades(self, req: AnalyzeImportedTradesRequest) -> AnalyzeImportedTradesResponse:
        self.ensure_loaded()
        assert self._model is not None

        # Merge historical + new trades deduplicating by id (newTrades wins on collision)
        by_id: dict[str, ImportedTradeRecord] = {}
        for t in req.historicalTrades:
            by_id[str(t.id)] = t
        new_ids: set[str] = set()
        for t in req.newTrades:
            tid = str(t.id)
            by_id[tid] = t
            new_ids.add(tid)

        if not new_ids and by_id:
            target_ids = set(by_id.keys())
        else:
            target_ids = new_ids

        all_trades = list(by_id.values())
        if not all_trades or not target_ids:
            return AnalyzeImportedTradesResponse(
                modelVersion=self._model_version,
                modelStatus=self._model_status,
                batchSummary=BatchBehaviorSummary(
                    totalEvaluated=0,
                    flaggedTradesCount=0,
                    behaviorHealthScore=100.0,
                    maxAnomalyScore=0.0,
                ),
                tradePredictions=[],
                recommendedAlerts=[],
            )

        journal_map: dict[str, JournalContextItem] = {
            str(j.date)[:10]: j for j in req.journalContext if j.date
        }
        seq = extract_causal_sequence(
            trades=all_trades,
            account_type=req.accountContext.accountType,
            initial_balance=req.accountContext.initialBalance,
            balance=req.accountContext.balance,
            daily_loss_limit=req.accountContext.dailyLossLimit,
            max_drawdown=req.accountContext.maxDrawdown,
            journal_by_date=journal_map,
            compute_labels=False,
        )

        cont_raw = seq["cont"]
        cont_norm = np.clip((cont_raw - self._feature_mean) / self._feature_std, -8.0, 8.0).astype(np.float32)
        cats = seq["cats"]
        meta_list = seq["meta"]

        target_indices = [idx for idx, m in enumerate(meta_list) if m["trade_id"] in target_ids]
        if not target_indices:
            target_indices = list(range(len(meta_list)))

        batch_cont = []
        batch_cat = []
        batch_mask = []
        for end_idx in target_indices:
            start_idx = max(0, end_idx - self._seq_len + 1)
            win_len = end_idx - start_idx + 1
            pad_len = self._seq_len - win_len

            win_cont = np.zeros((self._seq_len, cont_norm.shape[1]), dtype=np.float32)
            win_cat = np.zeros((self._seq_len, cats.shape[1]), dtype=np.int64)
            win_mask = np.zeros((self._seq_len,), dtype=bool)

            win_cont[pad_len:] = cont_norm[start_idx : end_idx + 1]
            win_cat[pad_len:] = cats[start_idx : end_idx + 1]
            win_mask[pad_len:] = True

            batch_cont.append(win_cont)
            batch_cat.append(win_cat)
            batch_mask.append(win_mask)

        cont_win_np = np.stack(batch_cont, axis=0)
        cat_win_np = np.stack(batch_cat, axis=0)
        mask_win_np = np.stack(batch_mask, axis=0)

        cont_t = torch.from_numpy(cont_win_np)
        cat_t = torch.from_numpy(cat_win_np)
        mask_t = torch.from_numpy(mask_win_np)

        with torch.inference_mode():
            logits, recon_cont, _ = self._model(cont_t, cat_t, mask_t)
            last_logits_np = logits[:, -1, :].cpu().numpy()
            probs_pytorch = torch.sigmoid(logits[:, -1, :]).cpu().numpy()
            recon_errs = (
                F.smooth_l1_loss(recon_cont[:, -1, :], cont_t[:, -1, :], reduction="none")
                .mean(dim=-1)
                .cpu()
                .numpy()
            )

        if self._ensemble is not None:
            ens_out = predict_with_hybrid_ensemble(
                artifact=self._ensemble,
                pytorch_logits=last_logits_np,
                cont_windows=cont_win_np,
                cat_windows=cat_win_np,
                mask_windows=mask_win_np,
            )
            probs_all = ens_out["blended_probs"]
            if_raw_scores = ens_out["iforest_raw_scores"]
            if_quantiles = ens_out["iforest_quantiles"]
            optimal_thresholds = ens_out["optimal_thresholds"]
            ensemble_mode: Literal["HYBRID_PYTORCH_LIGHTGBM", "PYTORCH_ONLY"] = "HYBRID_PYTORCH_LIGHTGBM"
            ref_drift = self._ensemble.get("driftReference")
        else:
            probs_all = probs_pytorch
            if_raw_scores = None
            if_quantiles = {}
            optimal_thresholds = {c: 0.50 for c in BEHAVIOR_CLASSES}
            ensemble_mode = "PYTORCH_ONLY"
            ref_drift = None

        # Read once per request (the file check is a stat call; trades can be thousands).
        risk_calibration = _current_risk_calibration()
        predictions: list[TradeBehaviorPrediction] = []
        evaluated_metas: list[dict[str, Any]] = []
        pattern_best: dict[str, tuple[float, TradeBehaviorPrediction, dict[str, Any]]] = {}
        risk_scores: list[float] = []
        pattern_counts: dict[str, int] = {}
        session_drift_cnt = 0
        strategy_drift_cnt = 0
        manual_ea_cnt = 0

        for pos, seq_idx in enumerate(target_indices):
            meta = meta_list[seq_idx]
            evaluated_metas.append(meta)
            prob_vec = probs_all[pos]
            probs_dict = {
                cls_name: round(float(prob_vec[c_i]), 4)
                for c_i, cls_name in enumerate(BEHAVIOR_CLASSES)
            }
            ae_score = _map_recon_error_to_anomaly_score(float(recon_errs[pos]), self._ae_quantiles)
            if if_raw_scores is not None:
                if_score = _map_recon_error_to_anomaly_score(float(if_raw_scores[pos]), if_quantiles)
                anomaly_score = round(0.60 * ae_score + 0.40 * if_score, 2)
            else:
                anomaly_score = ae_score

            max_prob = max(probs_dict.values())
            active_flags = [
                cls_name
                for cls_name, p in probs_dict.items()
                if p >= float(optimal_thresholds.get(cls_name, 0.50))
            ]

            risk_level: Literal["LOW", "MODERATE", "HIGH", "CRITICAL"]
            if risk_calibration is not None:
                # Calibrated on real outcomes (scripts/calibrate_behavior_risk.py): only harmful
                # patterns + anomaly count, with percentile cut-offs so CRITICAL stays rare.
                risk_level = risk_calibration.level(probs_dict, anomaly_score)  # type: ignore[assignment]
            elif max_prob >= 0.80 or anomaly_score >= 85.0:
                risk_level = "CRITICAL"
            elif max_prob >= 0.65 or anomaly_score >= 72.0:
                risk_level = "HIGH"
            elif max_prob >= 0.45 or anomaly_score >= 55.0:
                risk_level = "MODERATE"
            else:
                risk_level = "LOW"

            reasons = _format_reasons(meta, probs_dict, anomaly_score, req.locale)
            pred = TradeBehaviorPrediction(
                tradeId=meta["trade_id"],
                ticket=meta["ticket"],
                anomalyScore=anomaly_score,
                riskLevel=risk_level,
                probabilities=probs_dict,
                activeFlags=active_flags,
                effectiveSession=meta["effective_session"],
                effectiveStrategy=meta["effective_strategy"],
                executionMode=meta["execution_mode"],
                reasons=reasons,
            )
            predictions.append(pred)

            risk_scores.append(
                risk_calibration.formula.score(probs_dict, anomaly_score) * 100.0
                if risk_calibration is not None
                else max(max_prob * 100.0, anomaly_score * 0.85)
            )
            if meta["unfamiliar_session"]:
                session_drift_cnt += 1
            if meta["rare_or_untagged_strategy"] or "strategy_session_drift" in active_flags:
                strategy_drift_cnt += 1
            if meta["execution_mode"] == "MANUAL_ON_EA_ACCOUNT":
                manual_ea_cnt += 1

            for flag in active_flags:
                pattern_counts[flag] = pattern_counts.get(flag, 0) + 1
                p_val = probs_dict[flag]
                if flag not in pattern_best or p_val > pattern_best[flag][0]:
                    pattern_best[flag] = (p_val, pred, meta)

        flagged_cnt = sum(1 for p in predictions if p.activeFlags or p.anomalyScore >= 75.0)
        max_anomaly = max((p.anomalyScore for p in predictions), default=0.0)
        mean_risk = float(np.mean(risk_scores)) if risk_scores else 0.0
        max_risk = max(risk_scores, default=0.0)
        health_score = round(max(0.0, min(100.0, 100.0 - (0.65 * mean_risk + 0.35 * max_risk))), 1)
        dominant_pattern = max(pattern_counts, key=lambda k: pattern_counts[k]) if pattern_counts else None

        drift_info = compute_batch_drift(cont_raw[target_indices], ref_drift)
        trader_profile = classify_trader_profile(evaluated_metas, predictions)

        recommended_alerts = self._build_alerts(
            pattern_best=pattern_best,
            predictions=predictions,
            locale=req.locale,
        )

        return AnalyzeImportedTradesResponse(
            modelVersion=self._model_version,
            modelStatus=self._model_status,
            batchSummary=BatchBehaviorSummary(
                totalEvaluated=len(predictions),
                flaggedTradesCount=flagged_cnt,
                behaviorHealthScore=health_score,
                maxAnomalyScore=round(max_anomaly, 2),
                dominantPattern=dominant_pattern,
                sessionDriftCount=session_drift_cnt,
                strategyDriftCount=strategy_drift_cnt,
                manualEaOverrideCount=manual_ea_cnt,
                traderProfile=trader_profile,
                ensembleMode=ensemble_mode,
                driftDetected=bool(drift_info["driftDetected"]),
                maxFeaturePsi=float(drift_info["maxPsi"]),
                driftedFeatures=list(drift_info["driftedFeatures"]),
            ),
            tradePredictions=predictions,
            recommendedAlerts=recommended_alerts,
        )

    def _build_alerts(
        self,
        *,
        pattern_best: dict[str, tuple[float, TradeBehaviorPrediction, dict[str, Any]]],
        predictions: list[TradeBehaviorPrediction],
        locale: Literal["pt", "en"],
    ) -> list[RecommendedAlertItem]:
        alerts: list[RecommendedAlertItem] = []

        alert_type_map: dict[str, Literal["PSYCHOLOGY", "RISK", "DISCIPLINE", "COACHING"]] = {
            "revenge_trading": "PSYCHOLOGY",
            "overtrading_fomo": "PSYCHOLOGY",
            "tilt_risk_escalation": "RISK",
            "overconfidence_euphoria": "PSYCHOLOGY",
            "strategy_session_drift": "DISCIPLINE",
            "prop_guardrail_breach_risk": "RISK",
        }

        for pattern_code, (prob, pred, meta) in sorted(
            pattern_best.items(),
            key=lambda kv: kv[1][0],
            reverse=True,
        ):
            if prob < 0.65 and pred.anomalyScore < 75.0:
                continue
            severity: Literal["INFO", "WARNING", "CRITICAL"] = (
                "CRITICAL" if (prob >= 0.80 or pred.anomalyScore >= 85.0) else "WARNING"
            )
            label = BEHAVIOR_CLASS_LABELS[pattern_code][locale]
            reason_summary = " ".join(pred.reasons[:2]) if pred.reasons else ""
            if locale == "en":
                title = f"Hybrid ML Alert: {label}"
                desc = (
                    f"Detected in imported trades (confidence {int(round(prob * 100))}%, "
                    f"anomaly {pred.anomalyScore:.0f}/100). {reason_summary}"
                ).strip()
            else:
                title = f"Alerta ML Híbrido: {label}"
                desc = (
                    f"Padrão detetado nos trades importados (confiança {int(round(prob * 100))}%, "
                    f"anomalia {pred.anomalyScore:.0f}/100). {reason_summary}"
                ).strip()

            alerts.append(
                RecommendedAlertItem(
                    patternCode=pattern_code,
                    alertType=alert_type_map.get(pattern_code, "COACHING"),
                    severity=severity,
                    title=title,
                    description=desc,
                    tradeId=pred.tradeId,
                    metadata={
                        "confidence": round(prob, 4),
                        "anomalyScore": pred.anomalyScore,
                        "effectiveSession": pred.effectiveSession,
                        "effectiveStrategy": pred.effectiveStrategy,
                        "executionMode": pred.executionMode,
                        "volumeRatio": round(float(meta["volume_ratio"]), 2),
                    },
                )
            )

        if not alerts:
            top_anom = max(predictions, key=lambda p: p.anomalyScore, default=None)
            if top_anom and top_anom.anomalyScore >= 75.0:
                alerts.append(
                    RecommendedAlertItem(
                        patternCode="behavioral_anomaly",
                        alertType="COACHING",
                        severity="CRITICAL" if top_anom.anomalyScore >= 85.0 else "WARNING",
                        title=(
                            "Anomalia Comportamental Detetada (Hybrid ML)"
                            if locale == "pt"
                            else "Behavioral Anomaly Detected (Hybrid ML)"
                        ),
                        description=(
                            f"Operação fora do padrão operacional normal da conta "
                            f"(anomalia {top_anom.anomalyScore:.0f}/100). "
                            + " ".join(top_anom.reasons[:2])
                            if locale == "pt"
                            else f"Execution deviates from account baseline "
                            f"(anomaly {top_anom.anomalyScore:.0f}/100). "
                            + " ".join(top_anom.reasons[:2])
                        ).strip(),
                        tradeId=top_anom.tradeId,
                        metadata={
                            "anomalyScore": top_anom.anomalyScore,
                            "effectiveSession": top_anom.effectiveSession,
                            "effectiveStrategy": top_anom.effectiveStrategy,
                            "executionMode": top_anom.executionMode,
                        },
                    )
                )
        return alerts[:4]


behavior_ml_engine = BehaviorMlEngine()
