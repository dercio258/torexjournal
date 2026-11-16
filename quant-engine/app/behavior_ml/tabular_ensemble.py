from __future__ import annotations

from pathlib import Path
from typing import Any, Optional

import joblib
import numpy as np
import optuna
from scipy.optimize import minimize_scalar
from sklearn.ensemble import HistGradientBoostingClassifier, IsolationForest
from sklearn.metrics import f1_score, log_loss, roc_auc_score

from .features import CAT_FEATURE_NAMES, CONT_FEATURE_NAMES
from .schemas import BEHAVIOR_CLASSES

try:
    from lightgbm import LGBMClassifier

    HAS_LIGHTGBM = True
except Exception:  # pragma: no cover - fallback when wheel absent
    LGBMClassifier = None
    HAS_LIGHTGBM = False


DEFAULT_IF_QUANTILES: dict[str, float] = {
    "p50": 0.43,
    "p85": 0.50,
    "p95": 0.56,
    "p99": 0.63,
}


class _ConstantProbClassifier:
    """Fallback binary estimator when a tiny dataset contains only one class."""

    def __init__(self, prior: float) -> None:
        self.prior = float(max(1e-4, min(1.0 - 1e-4, prior)))

    def predict_proba(self, x: np.ndarray) -> np.ndarray:
        n = len(x)
        pos = np.full((n, 1), self.prior, dtype=np.float32)
        return np.hstack([1.0 - pos, pos])


def _sigmoid_np(x: np.ndarray) -> np.ndarray:
    clipped = np.clip(x, -30.0, 30.0)
    return 1.0 / (1.0 + np.exp(-clipped))


def build_tabular_window_features(
    cont_windows: np.ndarray,
    cat_windows: np.ndarray,
    mask_windows: np.ndarray,
) -> np.ndarray:
    """Build compact causal tabular features (39 dims) from padded trade windows."""
    if len(cont_windows) == 0:
        return np.zeros((0, len(CONT_FEATURE_NAMES) + len(CAT_FEATURE_NAMES) + 12), dtype=np.float32)

    n, seq_len, _ = cont_windows.shape
    mask_f = mask_windows.astype(np.float32)
    valid_counts = np.maximum(1.0, mask_f.sum(axis=1))

    def _masked_max(col_idx: int) -> np.ndarray:
        vals = np.where(mask_windows, cont_windows[:, :, col_idx], -1e6)
        return np.max(vals, axis=1)

    def _masked_min(col_idx: int) -> np.ndarray:
        vals = np.where(mask_windows, cont_windows[:, :, col_idx], 1e6)
        return np.min(vals, axis=1)

    def _masked_mean(col_idx: int) -> np.ndarray:
        vals = np.where(mask_windows, cont_windows[:, :, col_idx], 0.0)
        return np.sum(vals, axis=1) / valid_counts

    def _masked_std(col_idx: int) -> np.ndarray:
        mean_v = _masked_mean(col_idx)[:, None]
        sq = np.where(mask_windows, (cont_windows[:, :, col_idx] - mean_v) ** 2, 0.0)
        return np.sqrt(np.sum(sq, axis=1) / valid_counts)

    # Diversity counters strictly inside the causal window
    uniq_sessions = np.zeros((n,), dtype=np.float32)
    uniq_strategies = np.zeros((n,), dtype=np.float32)
    for i in range(n):
        valid_cats = cat_windows[i][mask_windows[i]]
        if len(valid_cats) > 0:
            uniq_sessions[i] = float(len(set(valid_cats[:, 0].tolist()))) / 6.0
            uniq_strategies[i] = float(len(set(valid_cats[:, 2].tolist()))) / 6.0

    # Key causal index lookups aligned with CONT_FEATURE_NAMES:
    # 0: volume_ratio_median20, 2: dt_since_prev_close_log, 5: cadence_burst_ratio,
    # 6: prev_trade_pnl_norm, 7: loss_streak_before, 11: prop_daily_dd_utilization, 14: sl_discipline_drop
    win_summary = np.stack(
        [
            valid_counts / max(1.0, float(seq_len)),
            _masked_max(0),
            _masked_mean(0),
            _masked_std(0),
            _masked_min(2),
            _masked_max(5),
            _masked_mean(6),
            _masked_max(7),
            _masked_max(11),
            _masked_mean(14),
            uniq_sessions,
            uniq_strategies,
        ],
        axis=1,
    ).astype(np.float32)

    cur_cont = cont_windows[:, -1, :].astype(np.float32)
    cur_cat = cat_windows[:, -1, :].astype(np.float32)
    return np.hstack([cur_cont, cur_cat, win_summary]).astype(np.float32)


def _fit_temperature_scipy(logits_1d: np.ndarray, y_true_1d: np.ndarray) -> float:
    positives = int(y_true_1d.sum())
    if positives == 0 or positives == len(y_true_1d):
        return 1.0

    def _loss_fn(temp: float) -> float:
        probs = np.clip(_sigmoid_np(logits_1d / max(0.25, temp)), 1e-6, 1.0 - 1e-6)
        return float(log_loss(y_true_1d, probs, labels=[0, 1]))

    res = minimize_scalar(_loss_fn, bounds=(0.5, 3.0), method="bounded")
    if res.success and np.isfinite(res.x):
        return float(res.x)
    return 1.0


def _optimize_class_blend_optuna(
    *,
    y_true_1d: np.ndarray,
    p_pytorch_cal: np.ndarray,
    p_gbdt: np.ndarray,
    seed: int,
) -> tuple[float, float]:
    positives = int(y_true_1d.sum())
    if positives == 0 or positives == len(y_true_1d):
        return 0.50, 0.50

    optuna.logging.set_verbosity(optuna.logging.WARNING)
    study = optuna.create_study(
        direction="maximize",
        sampler=optuna.samplers.TPESampler(seed=seed),
    )

    def _objective(trial: optuna.Trial) -> float:
        alpha = trial.suggest_float("alpha", 0.15, 0.85)
        thresh = trial.suggest_float("threshold", 0.35, 0.65)
        p_mix = alpha * p_pytorch_cal + (1.0 - alpha) * p_gbdt
        auc = float(roc_auc_score(y_true_1d, p_mix))
        f1 = float(f1_score(y_true_1d, (p_mix >= thresh).astype(np.int32), zero_division=0))
        return auc + 0.25 * f1

    study.optimize(_objective, n_trials=25, show_progress_bar=False)
    best = study.best_params
    return float(best["alpha"]), float(best["threshold"])


def fit_hybrid_ensemble(
    *,
    train_cont_windows: np.ndarray,
    train_cat_windows: np.ndarray,
    train_mask_windows: np.ndarray,
    train_targets: np.ndarray,
    train_weights: np.ndarray,
    train_clean_mask: np.ndarray,
    val_cont_windows: np.ndarray,
    val_cat_windows: np.ndarray,
    val_mask_windows: np.ndarray,
    val_targets: np.ndarray,
    val_clean_mask: np.ndarray,
    val_pytorch_logits: np.ndarray,
    drift_reference: Optional[dict[str, Any]] = None,
    ensemble_path: Optional[Path] = None,
    seed: int = 42,
) -> dict[str, Any]:
    """Train LightGBM (or HistGBDT fallback) + IsolationForest + SciPy calibration + Optuna blend."""
    x_train = build_tabular_window_features(train_cont_windows, train_cat_windows, train_mask_windows)
    x_val = build_tabular_window_features(val_cont_windows, val_cat_windows, val_mask_windows)

    backend = "lightgbm" if HAS_LIGHTGBM else "hist_gbdt"
    estimators: dict[str, Any] = {}
    temperatures: dict[str, float] = {}
    blend_alphas: dict[str, float] = {}
    optimal_thresholds: dict[str, float] = {}

    n_val = len(x_val)
    num_classes = len(BEHAVIOR_CLASSES)
    p_val_pytorch_cal = np.zeros((n_val, num_classes), dtype=np.float32)
    p_val_gbdt = np.zeros((n_val, num_classes), dtype=np.float32)
    p_val_blended = np.zeros((n_val, num_classes), dtype=np.float32)

    for c_idx, cls_name in enumerate(BEHAVIOR_CLASSES):
        y_tr = train_targets[:, c_idx].astype(np.int32)
        y_va = val_targets[:, c_idx].astype(np.int32)

        pos_tr = int(y_tr.sum())
        neg_tr = int(len(y_tr) - pos_tr)

        if pos_tr == 0 or neg_tr == 0:
            est: Any = _ConstantProbClassifier(float(pos_tr) / max(1, len(y_tr)))
        else:
            pos_factor = min(8.0, max(1.0, neg_tr / max(1, pos_tr)))
            cls_weights = np.where(y_tr == 1, train_weights * pos_factor, train_weights).astype(np.float32)
            if HAS_LIGHTGBM and LGBMClassifier is not None:
                est = LGBMClassifier(
                    n_estimators=140,
                    learning_rate=0.05,
                    num_leaves=15,
                    min_child_samples=max(5, min(15, len(x_train) // 10)),
                    subsample=0.85,
                    colsample_bytree=0.85,
                    random_state=seed + c_idx,
                    verbose=-1,
                    n_jobs=1,
                )
            else:
                est = HistGradientBoostingClassifier(
                    max_iter=140,
                    learning_rate=0.05,
                    max_leaf_nodes=15,
                    min_samples_leaf=max(5, min(15, len(x_train) // 10)),
                    random_state=seed + c_idx,
                )
            est.fit(x_train, y_tr, sample_weight=cls_weights)

        estimators[cls_name] = est
        gbdt_prob_val = est.predict_proba(x_val)[:, 1].astype(np.float32) if n_val > 0 else np.zeros((0,), dtype=np.float32)
        p_val_gbdt[:, c_idx] = gbdt_prob_val

        temp = _fit_temperature_scipy(val_pytorch_logits[:, c_idx], y_va) if n_val > 0 else 1.0
        temperatures[cls_name] = temp
        pt_cal_val = _sigmoid_np(val_pytorch_logits[:, c_idx] / temp).astype(np.float32) if n_val > 0 else np.zeros((0,), dtype=np.float32)
        p_val_pytorch_cal[:, c_idx] = pt_cal_val

        alpha, thresh = (
            _optimize_class_blend_optuna(
                y_true_1d=y_va,
                p_pytorch_cal=pt_cal_val,
                p_gbdt=gbdt_prob_val,
                seed=seed + c_idx,
            )
            if n_val > 0
            else (0.50, 0.50)
        )
        blend_alphas[cls_name] = alpha
        optimal_thresholds[cls_name] = thresh
        p_val_blended[:, c_idx] = (alpha * pt_cal_val + (1.0 - alpha) * gbdt_prob_val).astype(np.float32)

    # Fit IsolationForest strictly on clean baseline windows
    clean_train_x = x_train[train_clean_mask] if np.any(train_clean_mask) else x_train
    iforest = IsolationForest(
        n_estimators=120,
        contamination=0.10,
        random_state=seed,
        n_jobs=1,
    )
    iforest.fit(clean_train_x)

    clean_val_x = x_val[val_clean_mask] if (n_val > 0 and np.any(val_clean_mask)) else x_val
    if len(clean_val_x) > 0:
        clean_if_scores = (-iforest.score_samples(clean_val_x)).astype(np.float32)
        if_quantiles = {
            "p50": float(np.quantile(clean_if_scores, 0.50)),
            "p85": float(np.quantile(clean_if_scores, 0.85)),
            "p95": float(np.quantile(clean_if_scores, 0.95)),
            "p99": float(np.quantile(clean_if_scores, 0.99)),
        }
    else:
        if_quantiles = dict(DEFAULT_IF_QUANTILES)

    artifact = {
        "backend": backend,
        "estimators": estimators,
        "temperatures": temperatures,
        "blendAlphas": blend_alphas,
        "optimalThresholds": optimal_thresholds,
        "iforest": iforest,
        "iforestQuantiles": if_quantiles,
        "driftReference": drift_reference or {},
        "behaviorClasses": list(BEHAVIOR_CLASSES),
        "tabularFeatureDim": int(x_train.shape[1]),
    }

    if ensemble_path is not None:
        ensemble_path.parent.mkdir(parents=True, exist_ok=True)
        joblib.dump(artifact, ensemble_path, compress=3)

    return {
        "artifact": artifact,
        "backend": backend,
        "temperatures": temperatures,
        "blendAlphas": blend_alphas,
        "optimalThresholds": optimal_thresholds,
        "iforestQuantiles": if_quantiles,
        "valPytorchCalProbs": p_val_pytorch_cal,
        "valGbdtProbs": p_val_gbdt,
        "valBlendedProbs": p_val_blended,
    }


def predict_with_hybrid_ensemble(
    *,
    artifact: dict[str, Any],
    pytorch_logits: np.ndarray,
    cont_windows: np.ndarray,
    cat_windows: np.ndarray,
    mask_windows: np.ndarray,
) -> dict[str, Any]:
    """Run LightGBM/HistGBDT + IsolationForest + SciPy-calibrated PyTorch blend."""
    x_tab = build_tabular_window_features(cont_windows, cat_windows, mask_windows)
    n = len(x_tab)
    num_classes = len(BEHAVIOR_CLASSES)

    estimators = artifact["estimators"]
    temperatures = artifact.get("temperatures", {})
    blend_alphas = artifact.get("blendAlphas", {})
    optimal_thresholds = artifact.get("optimalThresholds", {})

    pt_cal = np.zeros((n, num_classes), dtype=np.float32)
    gbdt_probs = np.zeros((n, num_classes), dtype=np.float32)
    blended = np.zeros((n, num_classes), dtype=np.float32)

    for c_idx, cls_name in enumerate(BEHAVIOR_CLASSES):
        temp = float(temperatures.get(cls_name, 1.0))
        alpha = float(blend_alphas.get(cls_name, 0.50))
        p_pt = _sigmoid_np(pytorch_logits[:, c_idx] / max(0.25, temp)).astype(np.float32)
        est = estimators.get(cls_name)
        if est is not None:
            p_gb = est.predict_proba(x_tab)[:, 1].astype(np.float32)
        else:
            p_gb = p_pt
        pt_cal[:, c_idx] = p_pt
        gbdt_probs[:, c_idx] = p_gb
        blended[:, c_idx] = np.clip(alpha * p_pt + (1.0 - alpha) * p_gb, 0.0, 1.0)

    iforest: IsolationForest = artifact["iforest"]
    iforest_raw_scores = (-iforest.score_samples(x_tab)).astype(np.float32)
    return {
        "blended_probs": blended,
        "pytorch_cal_probs": pt_cal,
        "gbdt_probs": gbdt_probs,
        "iforest_raw_scores": iforest_raw_scores,
        "iforest_quantiles": dict(artifact.get("iforestQuantiles") or DEFAULT_IF_QUANTILES),
        "optimal_thresholds": {
            c: float(optimal_thresholds.get(c, 0.50)) for c in BEHAVIOR_CLASSES
        },
        "backend": str(artifact.get("backend") or "lightgbm"),
    }
