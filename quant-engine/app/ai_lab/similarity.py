"""Python port of the semantic-memory scoring used by the NestJS backend.

Mirrors `AiSemanticMemoryService` (normalizeText, computeTrigramSimilarity,
computeLexicalSimilarity, computeCosineSimilarity and the hybrid score in lookupMemory)
so thresholds and weights tuned here behave the same in production.
"""

from __future__ import annotations

import math
import re
import unicodedata
from dataclasses import dataclass, asdict

STOPWORDS_PT_EN = frozenset(
    "a o as os de do da dos das em no na nos nas para por com como que qual quais onde meu minha meus "
    "minhas seu sua the and for how what where when why with from my your is are do does can to in on of "
    "via ou or".split()
)

_NON_WORD = re.compile(r"[^\w<>\s]", re.UNICODE)
_SPACES = re.compile(r"\s+")


def normalize_text(raw: str) -> str:
    text = unicodedata.normalize("NFD", str(raw or ""))
    text = "".join(ch for ch in text if unicodedata.category(ch) != "Mn").lower()
    text = _NON_WORD.sub(" ", text).replace("_", " ")
    return _SPACES.sub(" ", text).strip()


def _trigrams(text: str) -> set[str]:
    padded = f"  {text} "
    return {padded[i : i + 3] for i in range(len(padded) - 2)}


def trigram_similarity(a_raw: str, b_raw: str) -> float:
    a, b = normalize_text(a_raw), normalize_text(b_raw)
    if not a or not b:
        return 0.0
    if a == b:
        return 1.0
    sa, sb = _trigrams(a), _trigrams(b)
    if not sa or not sb:
        return 0.0
    return 2 * len(sa & sb) / (len(sa) + len(sb))


def lexical_similarity(a_raw: str, b_raw: str) -> float:
    a, b = normalize_text(a_raw), normalize_text(b_raw)
    if not a or not b:
        return 0.0
    if a == b:
        return 1.0
    trigram = trigram_similarity(a, b)
    tokens_a = list(dict.fromkeys(t for t in a.split(" ") if len(t) >= 2 and t not in STOPWORDS_PT_EN))
    tokens_b = list(dict.fromkeys(t for t in b.split(" ") if len(t) >= 2 and t not in STOPWORDS_PT_EN))
    if not tokens_a or not tokens_b:
        return trigram
    set_b = set(tokens_b)
    overlap = 0.0
    for ta in tokens_a:
        if ta in set_b:
            overlap += 1
            continue
        best = max(trigram_similarity(ta, tb) for tb in tokens_b)
        if best >= 0.68:
            overlap += best
    jaccard_like = overlap / max(len(tokens_a), len(tokens_b))
    base = 0.55 * trigram + 0.45 * jaccard_like
    if jaccard_like >= 0.95:
        return min(1.0, max(base, 0.92 * jaccard_like))
    return min(1.0, base)


def cosine_similarity(a: list[float] | None, b: list[float] | None) -> float:
    if not a or not b or len(a) != len(b):
        return 0.0
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(y * y for y in b))
    if not na or not nb:
        return 0.0
    return max(0.0, min(1.0, dot / (na * nb)))


@dataclass(frozen=True)
class MemoryScoringParams:
    """The production values (as of 2026-11-16) are the defaults."""

    w_vec: float = 0.65
    w_lex: float = 0.20
    lexical_gate: float = 0.82
    lexical_only_weight: float = 0.82
    threshold_global: float = 0.88
    threshold_private: float = 0.90
    threshold_intent_pattern: float = 0.84

    @property
    def w_trust(self) -> float:
        return max(0.0, 1.0 - self.w_vec - self.w_lex)

    def to_dict(self) -> dict[str, float]:
        out = asdict(self)
        out["w_trust"] = round(self.w_trust, 4)
        return out


def hybrid_score(vec: float | None, lex: float, trust: float, params: MemoryScoringParams) -> float:
    """Same shape as lookupMemory: vector blend, or a lexical-only path for near-identical text."""
    lex_only = params.lexical_only_weight * lex + (1 - params.lexical_only_weight) * trust
    if vec is None:
        return lex_only
    blended = params.w_vec * vec + params.w_lex * lex + params.w_trust * trust
    return max(blended, lex_only if lex >= params.lexical_gate else 0.0)
