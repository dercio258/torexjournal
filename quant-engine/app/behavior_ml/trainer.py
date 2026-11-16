from __future__ import annotations

from datetime import datetime, timezone
import json
import os
from pathlib import Path
from typing import Any, Optional, Union

import numpy as np
import polars as pl
from sklearn.metrics import average_precision_score, f1_score, precision_score, recall_score, roc_auc_score
import torch
import torch.nn.functional as F
from torch.utils.data import DataLoader, Dataset, Subset

from .dataset_builder import (
    DEFAULT_CHECKPOINT_PATH,
    DEFAULT_ENSEMBLE_PATH,
    DEFAULT_METRICS_PATH,
    DEFAULT_PARQUET_PATH,
    DEFAULT_REPORT_PATH,
)
from .drift_and_store import build_reference_drift_stats
from .features import (
    CAT_FEATURE_NAMES,
    CAT_VOCAB_SIZES,
    CONT_FEATURE_NAMES,
    GOLD_LABEL_SOURCES,
    LABEL_SOURCE_WEAK,
    LABEL_SOURCE_SYNTHETIC,
    label_source_for_row,
)
from .model import TorexBehaviorNet
from .schemas import BEHAVIOR_CLASSES
from .tabular_ensemble import fit_hybrid_ensemble, predict_with_hybrid_ensemble


MODEL_VERSION = "torex-behavior-hybrid-v2.1.0"

# Promotion gate. The overall metric is dominated by synthetic archetypes whose labels come
# from the same weak rules the features encode, so real-account evidence is required as well
# once there is enough of it to be meaningful.
GATE_MIN_OVERALL_ROC_AUC = 0.75
GATE_MIN_REAL_ROC_AUC = 0.70
GATE_MIN_REAL_HOLDOUT_SAMPLES = 30
# Set TOREX_BEHAVIOR_GATE_REQUIRE_GOLD=0 only for synthetic experiments.
GATE_REQUIRE_REAL_GOLD = os.environ.get("TOREX_BEHAVIOR_GATE_REQUIRE_GOLD", "1") != "0"
# Share of each account's validation windows (earliest first) used to fit calibration,
# Optuna blend weights, thresholds and epoch selection. The rest is a clean holdout.
CALIBRATION_FRACTION = 0.5


class TradeSequenceDataset(Dataset):
    """Left-padded causal sliding-window dataset grouped strictly by anonymized account."""

    def __init__(
        self,
        df: pl.DataFrame,
        target_split: str,
        seq_len: int,
        feature_mean: np.ndarray,
        feature_std: np.ndarray,
    ) -> None:
        self.seq_len = int(seq_len)
        self.cont_dim = len(CONT_FEATURE_NAMES)
        self.cat_dim = len(CAT_FEATURE_NAMES)
        self.num_classes = len(BEHAVIOR_CLASSES)

        self.samples_cont: list[np.ndarray] = []
        self.samples_cat: list[np.ndarray] = []
        self.samples_mask: list[np.ndarray] = []
        self.samples_target: list[np.ndarray] = []
        self.samples_weight: list[float] = []
        self.samples_clean: list[bool] = []
        self.samples_source: list[str] = []
        self.samples_account: list[str] = []
        self.samples_label_source: list[str] = []

        if len(df) == 0:
            return

        sorted_df = df.sort(["anon_account_id", "account_seq_idx"])
        for (_,), acc_df in sorted_df.group_by(["anon_account_id"], maintain_order=True):
            cont_raw = acc_df.select(list(CONT_FEATURE_NAMES)).to_numpy().astype(np.float32)
            cont_norm = np.clip((cont_raw - feature_mean) / feature_std, -8.0, 8.0).astype(np.float32)
            cats = acc_df.select(list(CAT_FEATURE_NAMES)).to_numpy().astype(np.int64)
            targets = acc_df.select([f"y_{c}" for c in BEHAVIOR_CLASSES]).to_numpy().astype(np.float32)
            weights = acc_df["sample_weight"].to_numpy().astype(np.float32)
            clean_arr = acc_df["is_clean_step"].to_numpy().astype(bool)
            splits = acc_df["split"].to_list()
            sources = acc_df["source_split"].to_list()
            account_id = str(acc_df["anon_account_id"][0])
            if "label_source" in acc_df.columns:
                label_sources = [str(v) for v in acc_df["label_source"].to_list()]
            else:  # parquet built before label provenance was recorded
                label_sources = [
                    label_source_for_row(float(w), str(src)) for w, src in zip(weights, sources)
                ]

            total_rows = len(acc_df)
            for end_idx in range(total_rows):
                if splits[end_idx] != target_split:
                    continue
                # Train windows cannot see validation rows (already guaranteed by chronological split)
                start_idx = max(0, end_idx - self.seq_len + 1)
                win_len = end_idx - start_idx + 1
                pad_len = self.seq_len - win_len

                win_cont = np.zeros((self.seq_len, self.cont_dim), dtype=np.float32)
                win_cat = np.zeros((self.seq_len, self.cat_dim), dtype=np.int64)
                win_mask = np.zeros((self.seq_len,), dtype=bool)

                win_cont[pad_len:] = cont_norm[start_idx : end_idx + 1]
                win_cat[pad_len:] = cats[start_idx : end_idx + 1]
                win_mask[pad_len:] = True

                self.samples_cont.append(win_cont)
                self.samples_cat.append(win_cat)
                self.samples_mask.append(win_mask)
                self.samples_target.append(targets[end_idx])
                self.samples_weight.append(float(weights[end_idx]))
                self.samples_clean.append(bool(clean_arr[end_idx]))
                self.samples_source.append(str(sources[end_idx]))
                self.samples_account.append(account_id)
                self.samples_label_source.append(label_sources[end_idx])

    def __len__(self) -> int:
        return len(self.samples_cont)

    def __getitem__(self, idx: int) -> tuple[torch.Tensor, ...]:
        return (
            torch.from_numpy(self.samples_cont[idx]),
            torch.from_numpy(self.samples_cat[idx]),
            torch.from_numpy(self.samples_mask[idx]),
            torch.from_numpy(self.samples_target[idx]),
            torch.tensor(self.samples_weight[idx], dtype=torch.float32),
            torch.tensor(1.0 if self.samples_clean[idx] else 0.0, dtype=torch.float32),
        )


def _compute_multilabel_metrics(
    y_true: np.ndarray,
    y_prob: np.ndarray,
    threshold: Union[float, dict[str, float]] = 0.50,
) -> dict[str, Any]:
    per_class: dict[str, dict[str, Any]] = {}
    aucs: list[float] = []
    f1s: list[float] = []

    for i, cls_name in enumerate(BEHAVIOR_CLASSES):
        thr = float(threshold.get(cls_name, 0.50)) if isinstance(threshold, dict) else float(threshold)
        yt = y_true[:, i].astype(np.int32)
        yp_prob = y_prob[:, i]
        yp_bin = (yp_prob >= thr).astype(np.int32)
        positives = int(yt.sum())
        negatives = int(len(yt) - positives)
        if positives > 0 and negatives > 0:
            auc = float(roc_auc_score(yt, yp_prob))
            pr_auc = float(average_precision_score(yt, yp_prob))
            aucs.append(auc)
        else:
            auc = None
            pr_auc = None

        f1 = float(f1_score(yt, yp_bin, zero_division=0))
        prec = float(precision_score(yt, yp_bin, zero_division=0))
        rec = float(recall_score(yt, yp_bin, zero_division=0))
        if positives > 0:
            f1s.append(f1)

        per_class[cls_name] = {
            "positives": positives,
            "threshold": round(thr, 3),
            "rocAuc": round(auc, 4) if auc is not None else None,
            "prAuc": round(pr_auc, 4) if pr_auc is not None else None,
            "f1": round(f1, 4),
            "precision": round(prec, 4),
            "recall": round(rec, 4),
        }

    return {
        "samples": int(len(y_true)),
        "macroRocAuc": round(float(np.mean(aucs)), 4) if aucs else 0.0,
        "macroF1": round(float(np.mean(f1s)), 4) if f1s else 0.0,
        "classesWithAuc": len(aucs),
        "perClass": per_class,
    }


_EMPTY_METRICS: dict[str, Any] = {
    "samples": 0,
    "macroRocAuc": 0.0,
    "macroF1": 0.0,
    "classesWithAuc": 0,
    "perClass": {},
}


def _masked_metrics(
    y_true: np.ndarray,
    y_prob: np.ndarray,
    mask: np.ndarray,
    threshold: Union[float, dict[str, float]] = 0.50,
) -> dict[str, Any]:
    if not mask.any():
        return dict(_EMPTY_METRICS)
    return _compute_multilabel_metrics(y_true[mask], y_prob[mask], threshold=threshold)


def _calibration_holdout_indices(
    accounts: list[str],
    calibration_fraction: float = CALIBRATION_FRACTION,
) -> tuple[np.ndarray, np.ndarray]:
    """Split validation windows per account in time order: earliest -> calibration, latest -> holdout.

    Windows of one account are emitted in chronological order by TradeSequenceDataset, so the
    holdout always lies strictly after the data used to tune blend weights and thresholds.
    """
    by_account: dict[str, list[int]] = {}
    for idx, acc in enumerate(accounts):
        by_account.setdefault(acc, []).append(idx)

    calib: list[int] = []
    holdout: list[int] = []
    for idxs in by_account.values():
        if len(idxs) < 2:
            holdout.extend(idxs)
            continue
        cut = min(len(idxs) - 1, max(1, int(round(len(idxs) * calibration_fraction))))
        calib.extend(idxs[:cut])
        holdout.extend(idxs[cut:])
    return np.asarray(sorted(calib), dtype=np.int64), np.asarray(sorted(holdout), dtype=np.int64)


def _provenance_counts(sources: list[str], label_sources: list[str]) -> dict[str, dict[str, int]]:
    out: dict[str, dict[str, int]] = {}
    for src, lsrc in zip(sources, label_sources):
        bucket = out.setdefault(src, {})
        bucket[lsrc] = bucket.get(lsrc, 0) + 1
    return out


def _evaluate_loader(
    model: TorexBehaviorNet,
    loader: DataLoader,
    device: torch.device,
) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    model.eval()
    all_targets: list[np.ndarray] = []
    all_probs: list[np.ndarray] = []
    all_logits: list[np.ndarray] = []
    all_recon_errs: list[np.ndarray] = []
    all_clean: list[np.ndarray] = []

    with torch.inference_mode():
        for cont_x, cat_x, mask_x, y_t, _, is_clean in loader:
            cont_x = cont_x.to(device)
            cat_x = cat_x.to(device)
            mask_x = mask_x.to(device)
            logits, recon_cont, _ = model(cont_x, cat_x, mask_x)

            last_logits = logits[:, -1, :]
            probs = torch.sigmoid(last_logits).cpu().numpy()
            recon_err = F.smooth_l1_loss(
                recon_cont[:, -1, :],
                cont_x[:, -1, :],
                reduction="none",
            ).mean(dim=-1).cpu().numpy()

            all_targets.append(y_t.numpy())
            all_probs.append(probs)
            all_logits.append(last_logits.cpu().numpy())
            all_recon_errs.append(recon_err)
            all_clean.append(is_clean.numpy() > 0.5)

    if not all_targets:
        empty_y = np.zeros((0, len(BEHAVIOR_CLASSES)), dtype=np.float32)
        return empty_y, empty_y, np.zeros((0,), dtype=np.float32), np.zeros((0,), dtype=bool), empty_y

    return (
        np.concatenate(all_targets, axis=0),
        np.concatenate(all_probs, axis=0),
        np.concatenate(all_recon_errs, axis=0),
        np.concatenate(all_clean, axis=0),
        np.concatenate(all_logits, axis=0),
    )


def _render_training_report(metrics: dict[str, Any]) -> str:
    pt = metrics["validationPytorchOnly"]
    gb = metrics["validationGbdtOnly"]
    hy = metrics["validationHybridEnsemble"]
    alphas = metrics.get("optunaBlendAlphas", {})
    threshs = metrics.get("optimalThresholds", {})

    lines = [
        "# Relatório de Treino — Torex Hybrid Behavioral ML (PyTorch + LightGBM + IsolationForest + Optuna)",
        "",
        f"- **Gerado em (UTC):** `{metrics['trainedAtUtc']}`",
        f"- **Versão do Modelo:** `{metrics['modelVersion']}`",
        f"- **Backend Tabular:** `{metrics.get('ensembleBackend', 'lightgbm')}`",
        f"- **Épocas PyTorch:** `{metrics['epochs']}` (melhor época: `{metrics['bestEpoch']}`)",
        f"- **Janela Sequencial (`seq_len`):** `{metrics['seqLen']}` trades",
        f"- **Gate de Promoção (holdout `macroRocAuc >= {GATE_MIN_OVERALL_ROC_AUC}` e contas reais "
        f"`>= {GATE_MIN_REAL_ROC_AUC}` com `>= {GATE_MIN_REAL_HOLDOUT_SAMPLES}` janelas"
        f"{', incluindo etiquetas confirmadas pelo trader' if GATE_REQUIRE_REAL_GOLD else ''}):** "
        f"`{'PASS' if metrics.get('promotionGatePassed') else 'HOLD'}`",
        f"- **Linhas Totais Dataset:** `{metrics['datasetSummary']['totalRows']}` "
        f"(DB real: `{metrics['datasetSummary']['realDbRows']}`, "
        f"Arquétipos sintéticos: `{metrics['datasetSummary']['syntheticRows']}`)",
        f"- **Split Temporal:** Treino `{metrics['trainSamples']}` janelas | Validação `{metrics['valSamples']}` janelas "
        f"(calibração `{metrics.get('calibrationSamples', 0)}` | holdout `{metrics.get('holdoutSamples', 0)}`)",
        "",
    ]
    for reason in metrics.get("promotionGateReasons", []):
        lines.append(f"> Gate: {reason}")
    if metrics.get("promotionGateReasons"):
        lines.append("")
    lines.extend([
        "> Todas as métricas abaixo são medidas no **holdout** (janelas mais recentes de cada conta), "
        "que não foi usado para escolher a época, a temperatura, os pesos Optuna nem os thresholds.",
        "",
        "## Comparação de Modelos no Holdout Temporal",
        "",
        "| Modelo / Arquitetura | Macro ROC-AUC | Macro F1 |",
        "| :--- | ---: | ---: |",
        f"| PyTorch Neural (`TorexBehaviorNet`) | `{pt['macroRocAuc']:.4f}` | `{pt['macroF1']:.4f}` |",
        f"| Tabular GBDT (`{metrics.get('ensembleBackend', 'lightgbm')}`) | `{gb['macroRocAuc']:.4f}` | `{gb['macroF1']:.4f}` |",
        f"| **Ensemble Híbrido Empilhado (Optuna + SciPy Calibrated)** | **`{hy['macroRocAuc']:.4f}`** | **`{hy['macroF1']:.4f}`** |",
        "",
        "## Métricas por Classe — Ensemble Híbrido",
        "",
        "| Comportamento | Positivos (Holdout) | Peso PyTorch (`alpha`) | Threshold Ótimo | ROC-AUC | PR-AUC | F1 | Precision | Recall |",
        "| :--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ])
    for cls_name, info in hy["perClass"].items():
        auc_s = f"{info['rocAuc']:.4f}" if info["rocAuc"] is not None else "N/A"
        pr_s = f"{info['prAuc']:.4f}" if info["prAuc"] is not None else "N/A"
        a_val = alphas.get(cls_name, 0.50)
        t_val = threshs.get(cls_name, 0.50)
        lines.append(
            f"| `{cls_name}` | {info['positives']} | {a_val:.2f} | {t_val:.2f} | {auc_s} | {pr_s} | "
            f"{info['f1']:.4f} | {info['precision']:.4f} | {info['recall']:.4f} |"
        )

    subsets = [
        ("Contas reais (PostgreSQL)", metrics.get("validationRealDb")),
        ("Arquétipos sintéticos", metrics.get("validationSynthetic")),
        ("Labels gold (journal + feedback)", metrics.get("validationGoldLabels")),
        ("Contas reais com labels gold", metrics.get("validationRealDbGoldLabels")),
        ("Calibração (in-sample, otimista)", metrics.get("calibrationInSampleHybrid")),
    ]
    lines.extend(
        [
            "",
            "## Avaliação por Origem dos Dados e dos Labels (Ensemble Híbrido)",
            "",
            "| Subconjunto | Janelas | Classes c/ AUC | Macro ROC-AUC | Macro F1 |",
            "| :--- | ---: | ---: | ---: | ---: |",
        ]
    )
    for label, sub in subsets:
        if not sub:
            continue
        lines.append(
            f"| {label} | {sub['samples']} | {sub.get('classesWithAuc', '-')} | "
            f"{sub['macroRocAuc']:.4f} | {sub['macroF1']:.4f} |"
        )
    weak_share = metrics.get("holdoutWeakRulePositiveShare")
    if weak_share is not None:
        lines.extend(
            [
                "",
                f"- **Positivos do holdout com label de regra fraca:** `{weak_share * 100:.1f}%`. "
                "Estes labels são funções determinísticas das próprias features, por isso um ROC-AUC alto "
                "nesse subconjunto mede sobretudo a reprodução das regras, não comportamento real.",
            ]
        )
    prov = (metrics.get("labelProvenance") or {}).get("holdout") or {}
    if prov:
        lines.extend(
            [
                "",
                "| Origem (holdout) | Regra fraca | Script sintético | Journal | Feedback |",
                "| :--- | ---: | ---: | ---: | ---: |",
            ]
        )
        for src, counts in sorted(prov.items()):
            lines.append(
                f"| `{src}` | {counts.get('WEAK_RULE', 0)} | {counts.get(LABEL_SOURCE_SYNTHETIC, 0)} | "
                f"{counts.get('JOURNAL', 0)} | {counts.get('FEEDBACK', 0)} |"
            )

    q = metrics["aeQuantiles"]
    ifq = metrics.get("iforestQuantiles", {})
    lines.extend(
        [
            "",
            "## Calibração de Anomalia Híbrida (Passos Normais na Validação)",
            "",
            f"- **PyTorch Autoencoder (`60%`):** `p50={q['p50']:.5f}` | `p85={q['p85']:.5f}` | `p95={q['p95']:.5f}` | `p99={q['p99']:.5f}`",
        ]
    )
    if ifq:
        lines.append(
            f"- **IsolationForest (`40%`):** `p50={ifq['p50']:.5f}` | `p85={ifq['p85']:.5f}` | `p95={ifq['p95']:.5f}` | `p99={ifq['p99']:.5f}`"
        )
    lines.append("")
    return "\n".join(lines)


def train_behavior_model(
    *,
    parquet_path: Path = DEFAULT_PARQUET_PATH,
    checkpoint_path: Path = DEFAULT_CHECKPOINT_PATH,
    ensemble_path: Optional[Path] = None,
    metrics_path: Path = DEFAULT_METRICS_PATH,
    report_path: Path = DEFAULT_REPORT_PATH,
    epochs: int = 28,
    seq_len: int = 20,
    batch_size: int = 64,
    lr: float = 2e-3,
    seed: int = 42,
) -> dict[str, Any]:
    torch.manual_seed(seed)
    np.random.seed(seed)

    resolved_ensemble_path = (
        Path(ensemble_path)
        if ensemble_path is not None
        else (
            DEFAULT_ENSEMBLE_PATH
            if Path(checkpoint_path) == DEFAULT_CHECKPOINT_PATH
            else Path(checkpoint_path).parent / "torex_tabular_ensemble.joblib"
        )
    )

    df = pl.read_parquet(parquet_path)
    train_df = df.filter(pl.col("split") == "train")
    if len(train_df) == 0:
        raise ValueError("Training split is empty; cannot normalize or train TorexBehaviorNet.")

    # Fit normalization & drift baseline strictly on raw training split
    train_cont = train_df.select(list(CONT_FEATURE_NAMES)).to_numpy().astype(np.float32)
    feature_mean = np.mean(train_cont, axis=0).astype(np.float32)
    feature_std = np.maximum(np.std(train_cont, axis=0), 1e-2).astype(np.float32)
    drift_reference = build_reference_drift_stats(train_cont)

    train_ds = TradeSequenceDataset(df, "train", seq_len, feature_mean, feature_std)
    val_ds = TradeSequenceDataset(df, "val", seq_len, feature_mean, feature_std)
    if len(val_ds) == 0:
        val_ds = train_ds

    # Calibration / holdout split of the validation windows. Everything tuned on validation data
    # (best epoch, temperature, Optuna blend alpha, thresholds) only sees the calibration part;
    # reported metrics and the promotion gate use the untouched, later holdout part.
    calib_idx, holdout_idx = _calibration_holdout_indices(val_ds.samples_account)
    holdout_is_calibration = len(calib_idx) == 0 or len(holdout_idx) == 0
    if holdout_is_calibration:
        calib_idx = np.arange(len(val_ds), dtype=np.int64)
        holdout_idx = calib_idx

    # Compute clamped class pos_weights from train targets
    y_train_all = np.stack(train_ds.samples_target, axis=0)
    pos_counts = y_train_all.sum(axis=0)
    neg_counts = len(y_train_all) - pos_counts
    pos_weight_arr = np.clip(neg_counts / np.maximum(1.0, pos_counts), 1.0, 8.0).astype(np.float32)

    device = torch.device("cpu")
    model = TorexBehaviorNet(
        cont_dim=len(CONT_FEATURE_NAMES),
        vocab_sizes=CAT_VOCAB_SIZES,
        d_model=96,
        num_classes=len(BEHAVIOR_CLASSES),
        bottleneck_dim=12,
        dropout=0.15,
    ).to(device)

    pos_weight_t = torch.from_numpy(pos_weight_arr).to(device)
    optimizer = torch.optim.AdamW(model.parameters(), lr=lr, weight_decay=1e-4)
    scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=max(1, epochs))

    train_loader = DataLoader(train_ds, batch_size=batch_size, shuffle=True, drop_last=False)
    calib_loader = DataLoader(
        Subset(val_ds, calib_idx.tolist()), batch_size=batch_size, shuffle=False, drop_last=False
    )
    val_loader = DataLoader(val_ds, batch_size=batch_size, shuffle=False, drop_last=False)

    best_score = -1.0
    best_epoch = 1
    best_state: Optional[dict[str, torch.Tensor]] = None
    history: list[dict[str, Any]] = []

    for epoch in range(1, epochs + 1):
        model.train()
        total_loss = 0.0
        total_items = 0

        for cont_x, cat_x, mask_x, y_t, w_t, is_clean in train_loader:
            cont_x = cont_x.to(device)
            cat_x = cat_x.to(device)
            mask_x = mask_x.to(device)
            y_t = y_t.to(device)
            w_t = w_t.to(device)
            is_clean = is_clean.to(device)

            optimizer.zero_grad(set_to_none=True)
            logits, recon_cont, _ = model(cont_x, cat_x, mask_x)

            bce_per_sample = F.binary_cross_entropy_with_logits(
                logits[:, -1, :],
                y_t,
                pos_weight=pos_weight_t,
                reduction="none",
            ).mean(dim=-1)
            cls_loss = (bce_per_sample * w_t).mean()

            recon_per_sample = F.smooth_l1_loss(
                recon_cont[:, -1, :],
                cont_x[:, -1, :],
                reduction="none",
            ).mean(dim=-1)
            clean_denom = torch.clamp(is_clean.sum(), min=1.0)
            ae_loss = (recon_per_sample * is_clean).sum() / clean_denom

            loss = cls_loss + 0.35 * ae_loss
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), max_norm=2.0)
            optimizer.step()

            bs = cont_x.size(0)
            total_loss += float(loss.item()) * bs
            total_items += bs

        scheduler.step()

        # Epoch selection on the calibration part only (never the holdout)
        y_cal_true, y_cal_prob, _, _, _ = _evaluate_loader(model, calib_loader, device)
        cal_metrics = _compute_multilabel_metrics(y_cal_true, y_cal_prob)
        score = cal_metrics["macroRocAuc"] + 0.15 * cal_metrics["macroF1"]
        history.append(
            {
                "epoch": epoch,
                "trainLoss": round(total_loss / max(1, total_items), 5),
                "calibMacroRocAuc": cal_metrics["macroRocAuc"],
                "calibMacroF1": cal_metrics["macroF1"],
            }
        )
        if score >= best_score:
            best_score = score
            best_epoch = epoch
            best_state = {k: v.detach().cpu().clone() for k, v in model.state_dict().items()}

    if best_state is not None:
        model.load_state_dict(best_state)

    y_val_true, y_val_prob, val_recon_errs, val_clean_mask, val_logits = _evaluate_loader(
        model, val_loader, device
    )

    val_cont_win = np.stack(val_ds.samples_cont, axis=0)
    val_cat_win = np.stack(val_ds.samples_cat, axis=0)
    val_mask_win = np.stack(val_ds.samples_mask, axis=0)
    val_clean_arr = np.asarray(val_ds.samples_clean, dtype=bool)
    val_sources = np.asarray(val_ds.samples_source)
    val_label_sources = np.asarray(val_ds.samples_label_source)

    # Stage 2: LightGBM / HistGBDT + IsolationForest + SciPy temperature + Optuna blend,
    # tuned on the calibration part of validation only.
    train_cont_win = np.stack(train_ds.samples_cont, axis=0)
    train_cat_win = np.stack(train_ds.samples_cat, axis=0)
    train_mask_win = np.stack(train_ds.samples_mask, axis=0)
    train_weights_arr = np.asarray(train_ds.samples_weight, dtype=np.float32)
    train_clean_arr = np.asarray(train_ds.samples_clean, dtype=bool)

    ensemble_fit = fit_hybrid_ensemble(
        train_cont_windows=train_cont_win,
        train_cat_windows=train_cat_win,
        train_mask_windows=train_mask_win,
        train_targets=y_train_all,
        train_weights=train_weights_arr,
        train_clean_mask=train_clean_arr,
        val_cont_windows=val_cont_win[calib_idx],
        val_cat_windows=val_cat_win[calib_idx],
        val_mask_windows=val_mask_win[calib_idx],
        val_targets=y_val_true[calib_idx],
        val_clean_mask=val_clean_arr[calib_idx],
        val_pytorch_logits=val_logits[calib_idx],
        drift_reference=drift_reference,
        ensemble_path=None,  # Persist only after promotion gate check below
        seed=seed,
    )
    thresholds = ensemble_fit["optimalThresholds"]

    # Holdout evaluation with the frozen artifact, exactly as the inference service runs it
    holdout_pred = predict_with_hybrid_ensemble(
        artifact=ensemble_fit["artifact"],
        pytorch_logits=val_logits[holdout_idx],
        cont_windows=val_cont_win[holdout_idx],
        cat_windows=val_cat_win[holdout_idx],
        mask_windows=val_mask_win[holdout_idx],
    )
    y_hold = y_val_true[holdout_idx]
    hold_blended = holdout_pred["blended_probs"]
    hold_sources = val_sources[holdout_idx]
    hold_label_sources = val_label_sources[holdout_idx]
    hold_is_real = hold_sources == "REAL_DB"
    hold_is_gold = np.isin(hold_label_sources, list(GOLD_LABEL_SOURCES))

    pt_val_metrics = _compute_multilabel_metrics(y_hold, y_val_prob[holdout_idx])
    gbdt_val_metrics = _compute_multilabel_metrics(y_hold, holdout_pred["gbdt_probs"])
    hybrid_val_metrics = _compute_multilabel_metrics(y_hold, hold_blended, threshold=thresholds)
    # In-sample numbers on the calibration part, kept only to show the optimism gap
    calib_hybrid_metrics = _compute_multilabel_metrics(
        y_val_true[calib_idx], ensemble_fit["valBlendedProbs"], threshold=thresholds
    )

    real_val_metrics = _masked_metrics(y_hold, hold_blended, hold_is_real, thresholds)
    synthetic_val_metrics = _masked_metrics(y_hold, hold_blended, ~hold_is_real, thresholds)
    gold_val_metrics = _masked_metrics(y_hold, hold_blended, hold_is_gold, thresholds)
    real_gold_val_metrics = _masked_metrics(y_hold, hold_blended, hold_is_real & hold_is_gold, thresholds)

    # Share of holdout positives whose label comes from deterministic weak rules over X_t.
    # A high share means the scores mostly measure how well the model re-learns those rules.
    hold_positive_rows = y_hold.sum(axis=1) > 0
    weak_positive_share = (
        float(np.mean(hold_label_sources[hold_positive_rows] == LABEL_SOURCE_WEAK))
        if hold_positive_rows.any()
        else 0.0
    )

    calib_clean = val_clean_arr[calib_idx]
    calib_errs = val_recon_errs[calib_idx]
    clean_errs = calib_errs[calib_clean] if calib_clean.any() else calib_errs
    if len(clean_errs) == 0:
        clean_errs = np.asarray([0.05, 0.15, 0.30, 0.50], dtype=np.float32)

    ae_quantiles = {
        "p50": float(np.quantile(clean_errs, 0.50)),
        "p85": float(np.quantile(clean_errs, 0.85)),
        "p95": float(np.quantile(clean_errs, 0.95)),
        "p99": float(np.quantile(clean_errs, 0.99)),
    }

    gate_reasons: list[str] = []
    overall_ok = float(hybrid_val_metrics["macroRocAuc"]) >= GATE_MIN_OVERALL_ROC_AUC
    if not overall_ok:
        gate_reasons.append(
            f"holdout macroRocAuc {hybrid_val_metrics['macroRocAuc']:.4f} < {GATE_MIN_OVERALL_ROC_AUC}"
        )
    real_n = int(real_val_metrics["samples"])
    real_evaluable = real_n >= GATE_MIN_REAL_HOLDOUT_SAMPLES and real_val_metrics["classesWithAuc"] > 0
    real_ok = True
    if real_evaluable:
        real_ok = float(real_val_metrics["macroRocAuc"]) >= GATE_MIN_REAL_ROC_AUC
        if not real_ok:
            gate_reasons.append(
                f"real-account holdout macroRocAuc {real_val_metrics['macroRocAuc']:.4f} < {GATE_MIN_REAL_ROC_AUC}"
            )
    else:
        gate_reasons.append(
            f"real-account check skipped: {real_n} real holdout windows "
            f"(< {GATE_MIN_REAL_HOLDOUT_SAMPLES} or no class with both labels)"
        )
    if holdout_is_calibration:
        gate_reasons.append("validation too small to split: holdout equals calibration (optimistic)")

    # Promotion needs evidence on real accounts with confirmed labels (trader feedback or
    # journal), not only weak-rule labels the model can re-learn. Until the review queue
    # yields 30 such holdout windows, a new model is reported but never replaces the current one.
    real_gold_n = int(real_gold_val_metrics["samples"])
    real_gold_ok = True
    if GATE_REQUIRE_REAL_GOLD:
        real_gold_evaluable = (
            real_gold_n >= GATE_MIN_REAL_HOLDOUT_SAMPLES and real_gold_val_metrics["classesWithAuc"] > 0
        )
        if not real_gold_evaluable:
            real_gold_ok = False
            gate_reasons.append(
                f"confirmed-label check failed: {real_gold_n} real holdout windows with trader-confirmed labels "
                f"(< {GATE_MIN_REAL_HOLDOUT_SAMPLES}); review more alerts in /trades before promoting"
            )
        elif float(real_gold_val_metrics["macroRocAuc"]) < GATE_MIN_REAL_ROC_AUC:
            real_gold_ok = False
            gate_reasons.append(
                f"confirmed-label holdout macroRocAuc {real_gold_val_metrics['macroRocAuc']:.4f} < {GATE_MIN_REAL_ROC_AUC}"
            )

    trained_at = datetime.now(timezone.utc).isoformat()
    gate_passed = overall_ok and real_ok and real_gold_ok
    should_persist = gate_passed or (not Path(checkpoint_path).exists())

    if should_persist:
        import joblib

        checkpoint_path.parent.mkdir(parents=True, exist_ok=True)
        checkpoint_payload = {
            "modelVersion": MODEL_VERSION,
            "trainedAtUtc": trained_at,
            "seqLen": int(seq_len),
            "modelConfig": model.get_config(),
            "stateDict": model.state_dict(),
            "featureMean": feature_mean.tolist(),
            "featureStd": feature_std.tolist(),
            "aeQuantiles": ae_quantiles,
            "behaviorClasses": list(BEHAVIOR_CLASSES),
            "contFeatureNames": list(CONT_FEATURE_NAMES),
            "catFeatureNames": list(CAT_FEATURE_NAMES),
        }
        torch.save(checkpoint_payload, checkpoint_path)

        resolved_ensemble_path.parent.mkdir(parents=True, exist_ok=True)
        joblib.dump(ensemble_fit["artifact"], resolved_ensemble_path, compress=3)

    metrics = {
        "modelVersion": MODEL_VERSION,
        "trainedAtUtc": trained_at,
        "ensembleBackend": ensemble_fit["backend"],
        "promotionGatePassed": gate_passed,
        "promotionGateReasons": gate_reasons,
        "artifactsPersisted": bool(should_persist),
        "epochs": epochs,
        "bestEpoch": best_epoch,
        "seqLen": seq_len,
        "trainSamples": len(train_ds),
        "valSamples": len(val_ds),
        "calibrationSamples": int(len(calib_idx)),
        "holdoutSamples": int(len(holdout_idx)),
        "holdoutIsCalibration": bool(holdout_is_calibration),
        "datasetSummary": {
            "totalRows": int(len(df)),
            "realDbRows": int(df.filter(pl.col("source_split") == "REAL_DB").height),
            "syntheticRows": int(df.filter(pl.col("source_split") == "SYNTHETIC_ARCHETYPE").height),
        },
        "labelProvenance": {
            "train": _provenance_counts(train_ds.samples_source, train_ds.samples_label_source),
            "holdout": _provenance_counts(hold_sources.tolist(), hold_label_sources.tolist()),
        },
        "holdoutWeakRulePositiveShare": round(weak_positive_share, 4),
        # All validation* metrics below are measured on the holdout part
        "validationOverall": hybrid_val_metrics,
        "validationPytorchOnly": pt_val_metrics,
        "validationGbdtOnly": gbdt_val_metrics,
        "validationHybridEnsemble": hybrid_val_metrics,
        "validationRealDb": real_val_metrics,
        "validationSynthetic": synthetic_val_metrics,
        "validationGoldLabels": gold_val_metrics,
        "validationRealDbGoldLabels": real_gold_val_metrics,
        "calibrationInSampleHybrid": calib_hybrid_metrics,
        "optunaBlendAlphas": {k: round(float(v), 4) for k, v in ensemble_fit["blendAlphas"].items()},
        "optimalThresholds": {k: round(float(v), 4) for k, v in thresholds.items()},
        "scipyTemperatures": {k: round(float(v), 4) for k, v in ensemble_fit["temperatures"].items()},
        "aeQuantiles": ae_quantiles,
        "iforestQuantiles": ensemble_fit["iforestQuantiles"],
        "history": history[-5:],
    }

    metrics_path.parent.mkdir(parents=True, exist_ok=True)
    metrics_path.write_text(json.dumps(metrics, indent=2, ensure_ascii=False), encoding="utf-8")
    report_path.write_text(_render_training_report(metrics), encoding="utf-8")
    return metrics
