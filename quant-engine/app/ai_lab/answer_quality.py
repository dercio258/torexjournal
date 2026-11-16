"""Answer-quality metrics over the real conversations (read-only).

Measures what can be checked without an LLM judge: reply language vs question language,
fallbacks and their causes, truncation, routing layer mix, explicit and implicit feedback.
"""

from __future__ import annotations

import re
import unicodedata
from collections import Counter
from typing import Any

from .db import fetch_dicts, table_exists

_PT = set(
    "o os um uma de do da dos das em no na nos nas que qual quais quanto quantos como porque porquê por para com sem meu "
    "minha meus minhas eu tu você voce não nao sim é e são sao estou está esta tenho tem foi ser fazer onde quando mais "
    "menos melhor pior hoje ontem semana mês mes obrigado obrigada olá ola oi bom dia perdas perda ganhos lucro conta "
    "operações operacoes estratégia estrategia posso devo tudo isso".split()
)
_EN = set(
    "the an of in on at to for with without is are was were what which how why when where who my me i you your do does "
    "did can should could would have has not no yes and or it this that much many more less best worst today yesterday "
    "week month thanks thank hello hi hey losses loss profit account trades strategy all show give tell am be".split()
)


def detect_locale(text: str, fallback: str = "pt") -> str:
    """Same heuristic as backend ai-language-detect.ts."""
    lower = str(text or "").lower()
    tokens = re.findall(r"[a-zà-ÿ']+", lower)
    pt = sum(1 for t in tokens if t != "a" and t in _PT)
    en = sum(1 for t in tokens if t != "a" and t in _EN)
    if re.search(r"[ãõçáéíóúâêôà]", lower):
        pt += 2
    if re.search(r"\b(i'm|don't|what's|it's|can't)\b", lower):
        en += 2
    if pt == en:
        return fallback
    if max(pt, en) < 2 and abs(pt - en) < 2:
        return fallback
    return "pt" if pt > en else "en"


def _strip_markdown(text: str) -> str:
    text = re.sub(r"`[^`]*`", " ", text)
    text = re.sub(r"[*_#>|\-]+", " ", text)
    return unicodedata.normalize("NFC", text)


def answer_quality(conn: Any, days: int) -> dict[str, Any]:
    if not table_exists(conn, "ai_chat_messages"):
        return {"available": False}
    rows = fetch_dicts(
        conn,
        """
        SELECT m.session_id, m.role, m.content, m.intent, m.provider, m.metadata, m.created_at
          FROM ai_chat_messages m
         WHERE m.created_at >= now() - (%s * interval '1 day')
         ORDER BY m.session_id, m.created_at
        """,
        (days,),
    )
    pairs: list[tuple[dict[str, Any], dict[str, Any]]] = []
    last_user: dict[str, dict[str, Any]] = {}
    for r in rows:
        if r["role"] == "user":
            last_user[r["session_id"]] = r
        elif r["role"] == "assistant" and r["session_id"] in last_user:
            pairs.append((last_user.pop(r["session_id"]), r))

    providers: Counter[str] = Counter()
    failure_reasons: Counter[str] = Counter()
    language_checked = language_wrong = truncated = 0
    wrong_language_examples: list[dict[str, str]] = []
    for user, assistant in pairs:
        meta = assistant.get("metadata") or {}
        providers[str(assistant.get("provider") or "unknown")] += 1
        if meta.get("failureReason"):
            failure_reasons[str(meta["failureReason"])] += 1
        if meta.get("analystTruncated"):
            truncated += 1
        q_locale = detect_locale(user["content"], fallback="")
        if not q_locale:
            continue
        reply_text = _strip_markdown(str(assistant["content"] or ""))[:600]
        r_locale = detect_locale(reply_text, fallback="")
        if not r_locale:
            continue
        language_checked += 1
        if q_locale != r_locale:
            language_wrong += 1
            if len(wrong_language_examples) < 5:
                wrong_language_examples.append(
                    {"question": q_locale, "reply": r_locale, "provider": str(assistant.get("provider") or "")}
                )

    total = len(pairs)
    fallback_n = sum(n for p, n in providers.items() if p in ("system_guard", "support_fallback"))
    analyst_n = sum(n for p, n in providers.items() if re.match(r"^(llm|gemini|qwen)", p, re.I))
    zero_llm = sum(
        n
        for p, n in providers.items()
        if p in ("layer0_shield", "concept_glossary", "semantic_memory", "cache_hit", "profile_memory", "zero_data_guard")
        or p.startswith("deterministic")
    )

    feedback: dict[str, Any] = {"available": False}
    if table_exists(conn, "ai_message_feedback"):
        fb = fetch_dicts(
            conn,
            """SELECT rating, reason_code, COUNT(*)::int AS n FROM ai_message_feedback
                WHERE created_at >= now() - (%s * interval '1 day') GROUP BY rating, reason_code""",
            (days,),
        )
        up = sum(r["n"] for r in fb if r["rating"] == 1)
        down = sum(r["n"] for r in fb if r["rating"] == -1)
        feedback = {
            "available": True,
            "thumbsUp": up,
            "thumbsDown": down,
            "coveragePct": round(100 * (up + down) / total, 1) if total else 0.0,
            "negativeReasons": {str(r["reason_code"] or "OTHER"): r["n"] for r in fb if r["rating"] == -1},
        }
    implicit: dict[str, Any] = {"available": False}
    if table_exists(conn, "ai_feedback_events"):
        ev = fetch_dicts(
            conn,
            """SELECT signal, COUNT(*)::int AS n FROM ai_feedback_events
                WHERE created_at >= now() - (%s * interval '1 day') GROUP BY signal""",
            (days,),
        )
        implicit = {"available": True, "signals": {r["signal"]: r["n"] for r in ev}}

    pct = lambda n: round(100 * n / total, 1) if total else 0.0  # noqa: E731
    return {
        "available": True,
        "windowDays": days,
        "answeredQuestions": total,
        "languageMatchPct": round(100 * (1 - language_wrong / language_checked), 1) if language_checked else None,
        "languageChecked": language_checked,
        "wrongLanguageExamples": wrong_language_examples,
        "fallbackPct": pct(fallback_n),
        "analystPct": pct(analyst_n),
        "zeroLlmPct": pct(zero_llm),
        "truncatedReplies": truncated,
        "failureReasons": dict(failure_reasons),
        "providers": dict(providers.most_common()),
        "feedback": feedback,
        "implicitFeedback": implicit,
    }
