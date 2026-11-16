"""Finds recurring questions the glossary does not cover yet (read-only).

Takes user questions that were answered by the LLM (not by the glossary, a platform guide
or memory), strips personal data, groups them with TF-IDF character n-grams + HDBSCAN,
and lists each frequent group as a glossary candidate for human review.
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any

import numpy as np
from sklearn.cluster import HDBSCAN
from sklearn.feature_extraction.text import TfidfVectorizer

from .db import WORKSPACE_ROOT, fetch_dicts, table_exists
from .similarity import normalize_text

GLOSSARY_TS = WORKSPACE_ROOT / "backend-nest" / "src" / "ai" / "ai-trading-glossary.ts"

_PII_PATTERNS = [
    (re.compile(r"\b[\w.%+-]+@[\w.-]+\.[a-z]{2,}\b", re.I), " "),
    (re.compile(r"\+?\d[\d\s().-]{7,}\d"), " "),
    (re.compile(r"\b(?:me\s+chamo|meu\s+nome\s+[eé]|my\s+name\s+is|sou\s+[oa])\s+\S+", re.I), " "),
    (re.compile(r"\b(?:tenho|i\s*'?m|i\s+am)\s+\d{1,2}\s*(?:anos|years?\s+old)\b", re.I), " "),
    (re.compile(r"\b\d{5,}\b"), " "),
]
_LLM_PROVIDER = re.compile(r"^(llm|gemini|qwen)", re.I)


def sanitize_question(text: str) -> str:
    out = str(text or "")
    for rx, repl in _PII_PATTERNS:
        out = rx.sub(repl, out)
    return re.sub(r"\s+", " ", out).strip()[:200]


def load_glossary_aliases(path: Path = GLOSSARY_TS) -> set[str]:
    if not path.exists():
        return set()
    source = path.read_text(encoding="utf-8")
    aliases: set[str] = set()
    for block in re.findall(r"aliases:\s*\[([^\]]*)\]", source):
        aliases.update(normalize_text(a) for a in re.findall(r"'([^']+)'", block))
    for block in re.findall(r"^\s*\w+:\s*\[([^\]]*)\],?$", source, re.M):
        aliases.update(normalize_text(a) for a in re.findall(r"'([^']+)'", block))
    return {a for a in aliases if a}


def _covered(question: str, aliases: set[str]) -> bool:
    padded = f" {normalize_text(question)} "
    return any(f" {a} " in padded for a in aliases if len(a) >= 3)


def discover_concepts(conn: Any, days: int, min_cluster_size: int = 3) -> dict[str, Any]:
    if not table_exists(conn, "ai_chat_messages"):
        return {"available": False}
    rows = fetch_dicts(
        conn,
        """
        SELECT u.content AS question, a.provider
          FROM ai_chat_messages u
          JOIN LATERAL (
                SELECT provider FROM ai_chat_messages a
                 WHERE a.session_id = u.session_id AND a.role = 'assistant' AND a.created_at >= u.created_at
                 ORDER BY a.created_at ASC LIMIT 1
          ) a ON TRUE
         WHERE u.role = 'user' AND u.created_at >= now() - (%s * interval '1 day')
        """,
        (days,),
    )
    aliases = load_glossary_aliases()
    questions = [
        sanitize_question(r["question"])
        for r in rows
        if _LLM_PROVIDER.match(str(r.get("provider") or ""))
    ]
    questions = [q for q in questions if len(q) >= 8]
    uncovered = [q for q in questions if not _covered(q, aliases)]

    result: dict[str, Any] = {
        "available": True,
        "windowDays": days,
        "llmAnsweredQuestions": len(questions),
        "notCoveredByGlossary": len(uncovered),
        "glossaryAliases": len(aliases),
        "candidates": [],
    }
    if len(uncovered) < max(min_cluster_size, 2):
        result["note"] = "Too few uncovered questions to cluster yet."
        return result

    vectorizer = TfidfVectorizer(analyzer="char_wb", ngram_range=(3, 5), min_df=1, sublinear_tf=True)
    matrix = vectorizer.fit_transform([normalize_text(q) for q in uncovered]).toarray()
    labels = HDBSCAN(min_cluster_size=min_cluster_size, metric="cosine", copy=True).fit_predict(matrix)

    candidates = []
    for label in sorted(set(labels) - {-1}):
        idx = np.where(labels == label)[0]
        centroid = matrix[idx].mean(axis=0)
        closest = idx[int(np.argmax(matrix[idx] @ centroid))]
        candidates.append(
            {
                "size": int(len(idx)),
                "representative": uncovered[closest],
                "examples": [uncovered[i] for i in idx[:4]],
            }
        )
    result["candidates"] = sorted(candidates, key=lambda c: -c["size"])
    result["unclustered"] = int((labels == -1).sum())
    return result
