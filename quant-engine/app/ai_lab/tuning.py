"""Tunes the semantic-memory reuse weights and threshold on the labelled pair set.

Goal: reuse as many genuinely identical questions as possible while keeping precision
at or above the floor (default 98%): generating a fresh answer is cheaper than serving
a wrong cached one.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, replace
from pathlib import Path
from typing import Any

import optuna

from .similarity import MemoryScoringParams, cosine_similarity, hybrid_score, lexical_similarity

DEFAULT_TRUST = 0.8  # typical trust of an ACTIVE global memory (quorum of 3, no complaints)


@dataclass(frozen=True)
class EvalPair:
    a: str  # the stored question (memory)
    b: str  # the new question (query)
    same: bool
    locale: str
    kind: str


@dataclass(frozen=True)
class ScoredPair:
    pair: EvalPair
    vec: float | None
    lex: float


def load_pairs(path: Path) -> list[EvalPair]:
    pairs: list[EvalPair] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        row = json.loads(line)
        pairs.append(EvalPair(a=row["a"], b=row["b"], same=bool(row["same"]), locale=row.get("locale", "pt"), kind=row.get("kind", "")))
    return pairs


def score_pairs(pairs: list[EvalPair], embeddings: dict[tuple[str, str], list[float]] | None) -> list[ScoredPair]:
    scored = []
    for p in pairs:
        vec = None
        if embeddings:
            ea = embeddings.get((p.a, "RETRIEVAL_DOCUMENT"))
            eb = embeddings.get((p.b, "RETRIEVAL_QUERY"))
            if ea and eb:
                vec = cosine_similarity(ea, eb)
        scored.append(ScoredPair(pair=p, vec=vec, lex=lexical_similarity(p.a, p.b)))
    return scored


def evaluate(scored: list[ScoredPair], params: MemoryScoringParams, trust: float = DEFAULT_TRUST) -> dict[str, Any]:
    tp = fp = fn = tn = 0
    false_reuse: list[dict[str, Any]] = []
    missed: list[dict[str, Any]] = []
    for s in scored:
        score = hybrid_score(s.vec, s.lex, trust, params)
        reuse = score >= params.threshold_global
        if reuse and s.pair.same:
            tp += 1
        elif reuse and not s.pair.same:
            fp += 1
            false_reuse.append({"a": s.pair.a, "b": s.pair.b, "kind": s.pair.kind, "score": round(score, 4)})
        elif not reuse and s.pair.same:
            fn += 1
            missed.append({"a": s.pair.a, "b": s.pair.b, "kind": s.pair.kind, "score": round(score, 4)})
        else:
            tn += 1
    precision = tp / (tp + fp) if tp + fp else 1.0
    recall = tp / (tp + fn) if tp + fn else 0.0
    return {
        "pairs": len(scored),
        "withVectors": sum(1 for s in scored if s.vec is not None),
        "truePositives": tp,
        "falsePositives": fp,
        "falseNegatives": fn,
        "trueNegatives": tn,
        "precision": round(precision, 4),
        "recall": round(recall, 4),
        "falseReuse": sorted(false_reuse, key=lambda r: -r["score"])[:15],
        "missedReuse": sorted(missed, key=lambda r: -r["score"])[:15],
    }


def tune(
    scored: list[ScoredPair],
    baseline: MemoryScoringParams,
    precision_floor: float = 0.98,
    trials: int = 300,
    seed: int = 7,
) -> dict[str, Any]:
    has_vectors = any(s.vec is not None for s in scored)

    def objective(trial: optuna.Trial) -> float:
        params = replace(
            baseline,
            lexical_gate=trial.suggest_float("lexical_gate", 0.70, 0.95),
            lexical_only_weight=trial.suggest_float("lexical_only_weight", 0.70, 0.95),
            threshold_global=trial.suggest_float("threshold_global", 0.70, 0.97),
        )
        if has_vectors:
            w_vec = trial.suggest_float("w_vec", 0.40, 0.85)
            w_lex = trial.suggest_float("w_lex", 0.05, min(0.45, 0.95 - w_vec))
            params = replace(params, w_vec=w_vec, w_lex=w_lex)
        m = evaluate(scored, params)
        # Precision below the floor is never acceptable; above it, more recall wins,
        # and a small preference for a higher threshold breaks ties towards safety.
        if m["precision"] < precision_floor:
            return m["precision"] - 1.0
        return m["recall"] + 0.001 * params.threshold_global

    optuna.logging.set_verbosity(optuna.logging.WARNING)
    study = optuna.create_study(direction="maximize", sampler=optuna.samplers.TPESampler(seed=seed))
    study.enqueue_trial(
        {
            "lexical_gate": baseline.lexical_gate,
            "lexical_only_weight": baseline.lexical_only_weight,
            "threshold_global": baseline.threshold_global,
            **({"w_vec": baseline.w_vec, "w_lex": baseline.w_lex} if has_vectors else {}),
        }
    )
    study.optimize(objective, n_trials=trials)

    best = study.best_params
    tuned = replace(
        baseline,
        lexical_gate=round(best["lexical_gate"], 4),
        lexical_only_weight=round(best["lexical_only_weight"], 4),
        threshold_global=round(best["threshold_global"], 4),
        **({"w_vec": round(best["w_vec"], 4), "w_lex": round(best["w_lex"], 4)} if has_vectors else {}),
    )
    # Keep the production gap between global and private reuse.
    gap = baseline.threshold_private - baseline.threshold_global
    tuned = replace(tuned, threshold_private=round(min(0.99, tuned.threshold_global + gap), 4))

    before = evaluate(scored, baseline)
    after = evaluate(scored, tuned)
    improves = after["precision"] >= precision_floor and (
        after["recall"] > before["recall"] or before["precision"] < precision_floor
    )
    return {
        "mode": "hybrid" if has_vectors else "lexical_only",
        "precisionFloor": precision_floor,
        "trials": trials,
        "baseline": {"params": baseline.to_dict(), "metrics": before},
        "tuned": {"params": tuned.to_dict(), "metrics": after},
        "recommendApply": bool(improves),
    }
