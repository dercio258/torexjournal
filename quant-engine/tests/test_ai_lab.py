"""AI lab: parity with the backend scoring, tuning, privacy and trust formula."""

from __future__ import annotations

import pytest

from app.ai_lab.answer_quality import detect_locale
from app.ai_lab.concept_discovery import load_glossary_aliases, sanitize_question
from app.ai_lab.similarity import MemoryScoringParams, hybrid_score, lexical_similarity, trigram_similarity
from app.ai_lab.trust import base_trust
from app.ai_lab.tuning import EvalPair, evaluate, load_pairs, score_pairs, tune
from app.ai_lab.runner import EVAL_PAIRS

# Reference values printed by AiSemanticMemoryService (TypeScript) on 2026-11-16.
TS_REFERENCE = [
    ("o que é scalping", "explica-me o scalping", 0.46153846153846156, 0.40384615384615385),
    ("o que é drawdown", "qual é o meu drawdown", 0.5641025641025641, 0.92),
    ("what is a stop loss", "what is a trailing stop", 0.6363636363636364, 0.5750000000000001),
    ("Como importar os meus trades?", "como importo operações do MT5", 0.4067796610169492, 0.32961116650049854),
    ("o que é fair value gap", "o que é fvg", 0.5294117647058824, 0.2911764705882353),
]


@pytest.mark.parametrize("a,b,trigram,lexical", TS_REFERENCE)
def test_similarity_matches_backend(a: str, b: str, trigram: float, lexical: float) -> None:
    assert trigram_similarity(a, b) == pytest.approx(trigram, abs=1e-12)
    assert lexical_similarity(a, b) == pytest.approx(lexical, abs=1e-12)


def test_hybrid_score_matches_backend_shape() -> None:
    p = MemoryScoringParams()
    # With a vector: max(blend, lexical-only when lex >= gate)
    assert hybrid_score(0.9, 0.5, 0.8, p) == pytest.approx(0.65 * 0.9 + 0.2 * 0.5 + 0.15 * 0.8)
    assert hybrid_score(0.5, 0.9, 0.8, p) == pytest.approx(0.82 * 0.9 + 0.18 * 0.8)
    # Without a vector: lexical-only
    assert hybrid_score(None, 0.5, 0.8, p) == pytest.approx(0.82 * 0.5 + 0.18 * 0.8)


def test_eval_set_is_balanced_and_valid() -> None:
    pairs = load_pairs(EVAL_PAIRS)
    assert len(pairs) >= 100
    same = sum(p.same for p in pairs)
    assert 0.35 < same / len(pairs) < 0.65
    assert {p.locale for p in pairs} == {"pt", "en"}
    assert any(p.kind == "concept_vs_personal" for p in pairs)


def test_baseline_flags_concept_vs_personal_false_reuse() -> None:
    """'o que é drawdown' vs 'qual é o meu drawdown' scores 0.92 lexically: reused today without vectors."""
    pairs = [EvalPair("o que é drawdown", "qual é o meu drawdown", False, "pt", "concept_vs_personal")]
    m = evaluate(score_pairs(pairs, None), MemoryScoringParams())
    assert m["falsePositives"] == 1


def test_tuning_respects_the_precision_floor() -> None:
    pairs = load_pairs(EVAL_PAIRS)
    result = tune(score_pairs(pairs, None), MemoryScoringParams(), precision_floor=0.98, trials=60)
    tuned = result["tuned"]["metrics"]
    assert result["mode"] == "lexical_only"
    if result["recommendApply"]:
        assert tuned["precision"] >= 0.98
        assert tuned["recall"] >= result["baseline"]["metrics"]["recall"] or result["baseline"]["metrics"]["precision"] < 0.98
    p = result["tuned"]["params"]
    assert p["threshold_private"] - p["threshold_global"] == pytest.approx(0.02, abs=1e-4)


def test_sanitize_question_removes_personal_data() -> None:
    q = sanitize_question("oi, sou o Dercio, tenho 22 anos, email a@b.com, tel +258 84 123 4567, o que é FVG?")
    assert "Dercio" not in q and "22 anos" not in q and "a@b.com" not in q and "123" not in q
    assert "FVG" in q


def test_glossary_aliases_are_read_from_the_backend() -> None:
    aliases = load_glossary_aliases()
    assert {"scalping", "stop loss", "profit factor", "fomo"} <= aliases


@pytest.mark.parametrize(
    "text,expected",
    [("Qual é a minha maior perda?", "pt"), ("What is my biggest loss?", "en"), ("ok", "x")],
)
def test_detect_locale_matches_backend(text: str, expected: str) -> None:
    assert detect_locale(text, fallback="x") == expected


def test_base_trust_matches_backend_formula() -> None:
    assert base_trust(0, 0, 0) == 0.5
    assert base_trust(4, 0, 3) == pytest.approx(min(0.99, 6 / 8 + 0.18), abs=1e-4)
    assert base_trust(1, 2, 1) == pytest.approx(3 / 7, abs=1e-4)
