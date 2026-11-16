"""Weekly AI lab run: evaluate, tune, discover concepts, recompute trust, write a report.

Dry-run by default (read-only DB session). With apply=True it publishes the tuned
memory-scoring parameters to `ai_tuning_params` (only when they beat the baseline on
the evaluation set) and writes the trust updates.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .answer_quality import answer_quality
from .concept_discovery import discover_concepts
from .db import QUANT_ENGINE_ROOT, connect, fetch_dicts, table_exists
from .embeddings import EmbeddingCache, embed_texts, gemini_key
from .similarity import MemoryScoringParams
from .trust import apply_trust_updates, propose_trust_updates
from .tuning import load_pairs, score_pairs, tune

EVAL_PAIRS = QUANT_ENGINE_ROOT / "data" / "ai_eval" / "pairs.jsonl"
EMBEDDING_CACHE = QUANT_ENGINE_ROOT / "data" / "ai_eval" / "embeddings_cache.json"
REPORTS_DIR = QUANT_ENGINE_ROOT / "artifacts" / "ai_lab"
PARAMS_KEY = "semantic_memory_scoring"

PARAMS_DDL = """
CREATE TABLE IF NOT EXISTS ai_tuning_params (
    key VARCHAR(64) PRIMARY KEY,
    value JSONB NOT NULL,
    source VARCHAR(64) NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
)
"""


def _current_params(conn: Any) -> MemoryScoringParams:
    if not table_exists(conn, "ai_tuning_params"):
        return MemoryScoringParams()
    rows = fetch_dicts(conn, "SELECT value FROM ai_tuning_params WHERE key = %s", (PARAMS_KEY,))
    if not rows:
        return MemoryScoringParams()
    value = rows[0]["value"]
    if isinstance(value, str):
        value = json.loads(value)
    fields = MemoryScoringParams.__dataclass_fields__
    return MemoryScoringParams(**{k: float(v) for k, v in value.items() if k in fields})


def run_lab(
    days: int = 30,
    use_embeddings: bool = True,
    apply: bool = False,
    trials: int = 300,
    precision_floor: float = 0.98,
    out_dir: Path = REPORTS_DIR,
) -> dict[str, Any]:
    started = datetime.now(timezone.utc)
    report: dict[str, Any] = {"generatedAt": started.isoformat(), "windowDays": days, "applied": False}

    pairs = load_pairs(EVAL_PAIRS)
    embeddings = None
    embedding_note = "disabled"
    if use_embeddings:
        if gemini_key():
            try:
                texts = sorted({(p.a, "RETRIEVAL_DOCUMENT") for p in pairs} | {(p.b, "RETRIEVAL_QUERY") for p in pairs})
                embeddings = embed_texts(texts, EmbeddingCache(EMBEDDING_CACHE))
                embedding_note = f"gemini ({len(embeddings)} phrases)"
            except Exception as exc:  # network or quota: fall back to lexical-only
                embedding_note = f"unavailable: {type(exc).__name__}"
        else:
            embedding_note = "no GEMINI_API_KEY"

    with connect(read_only=True) as conn:
        baseline = _current_params(conn)
        scored = score_pairs(pairs, embeddings)
        report["evaluationSet"] = {
            "pairs": len(pairs),
            "same": sum(p.same for p in pairs),
            "different": sum(not p.same for p in pairs),
            "embeddings": embedding_note,
        }
        report["reuseTuning"] = tune(scored, baseline, precision_floor=precision_floor, trials=trials)
        report["answerQuality"] = answer_quality(conn, days)
        report["conceptCandidates"] = discover_concepts(conn, days)
        report["trust"] = propose_trust_updates(conn)

    if apply:
        with connect(read_only=False) as conn:
            cur = conn.cursor()
            cur.execute(PARAMS_DDL)
            published = False
            if report["reuseTuning"]["recommendApply"]:
                cur.execute(
                    """INSERT INTO ai_tuning_params (key, value, source, updated_at)
                       VALUES (%s, %s::jsonb, %s, now())
                       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, source = EXCLUDED.source, updated_at = now()""",
                    (PARAMS_KEY, json.dumps(report["reuseTuning"]["tuned"]["params"]), f"ai_lab:{report['reuseTuning']['mode']}"),
                )
                published = True
            trust_written = apply_trust_updates(conn, report["trust"].get("updates", []))
        report["applied"] = True
        report["appliedChanges"] = {"paramsPublished": published, "trustUpdates": trust_written}

    out_dir.mkdir(parents=True, exist_ok=True)
    stamp = started.strftime("%Y%m%dT%H%M%SZ")
    path = out_dir / f"ai_lab_report_{stamp}.json"
    path.write_text(json.dumps(report, ensure_ascii=False, indent=2, default=str), encoding="utf-8")
    (out_dir / "latest.json").write_text(path.read_text(encoding="utf-8"), encoding="utf-8")
    report["reportPath"] = str(path)
    return report


def summarize(report: dict[str, Any]) -> str:
    t = report["reuseTuning"]
    b, a = t["baseline"]["metrics"], t["tuned"]["metrics"]
    q = report.get("answerQuality", {})
    c = report.get("conceptCandidates", {})
    tr = report.get("trust", {})
    lines = [
        f"AI lab — {report['generatedAt']} — window {report['windowDays']} days",
        f"Eval set: {report['evaluationSet']['pairs']} pairs, embeddings: {report['evaluationSet']['embeddings']}",
        f"Reuse ({t['mode']}): baseline precision {b['precision']:.2%} recall {b['recall']:.2%} → "
        f"tuned precision {a['precision']:.2%} recall {a['recall']:.2%} | apply recommended: {t['recommendApply']}",
    ]
    if q.get("available"):
        lines.append(
            f"Answers: {q['answeredQuestions']} | language match {q['languageMatchPct']}% | fallback {q['fallbackPct']}% | "
            f"analyst {q['analystPct']}% | 0-LLM {q['zeroLlmPct']}% | truncated {q['truncatedReplies']}"
        )
        fb = q.get("feedback", {})
        if fb.get("available"):
            lines.append(f"Feedback: +{fb['thumbsUp']} / -{fb['thumbsDown']} ({fb['coveragePct']}% of answers)")
    if c.get("available"):
        lines.append(
            f"Concepts: {c['llmAnsweredQuestions']} LLM-answered, {c['notCoveredByGlossary']} not in glossary, "
            f"{len(c['candidates'])} candidate group(s)"
        )
    if tr.get("available"):
        lines.append(f"Trust: {tr['activeMemories']} active memories, {len(tr['updates'])} proposed update(s)")
    lines.append(f"Applied: {report['applied']} | report: {report.get('reportPath')}")
    return "\n".join(lines)
