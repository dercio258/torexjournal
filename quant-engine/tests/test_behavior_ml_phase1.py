"""Phase 1 corrections: honest evaluation split, label provenance, strategy embedding mapping."""
from __future__ import annotations

from pathlib import Path
import sys

import numpy as np
import polars as pl
import pytest

ROOT_DIR = Path(__file__).resolve().parent.parent
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from app.behavior_ml.dataset_builder import hash_bucket_diagnostics
from app.behavior_ml.features import (
    LABEL_SOURCE_FEEDBACK,
    LABEL_SOURCE_JOURNAL,
    LABEL_SOURCE_WEAK,
    STRATEGY_BASE_VOCAB,
    SYMBOL_BASE_VOCAB,
    label_source_from_weight,
    strategy_to_idx,
)
from app.behavior_ml.trainer import _calibration_holdout_indices, _masked_metrics


def test_label_source_from_weight():
    assert label_source_from_weight(5.0) == LABEL_SOURCE_FEEDBACK
    assert label_source_from_weight(3.0) == LABEL_SOURCE_JOURNAL
    assert label_source_from_weight(1.0) == LABEL_SOURCE_WEAK


def test_calibration_holdout_split_is_per_account_and_chronological():
    # Windows are emitted per account in time order: A0..A5, then B0..B3, then C0
    accounts = ["A"] * 6 + ["B"] * 4 + ["C"]
    calib, holdout = _calibration_holdout_indices(accounts, calibration_fraction=0.5)

    assert set(calib).isdisjoint(set(holdout))
    assert sorted(set(calib) | set(holdout)) == list(range(len(accounts)))
    # Per account, every calibration window precedes every holdout window
    for acc in ("A", "B"):
        idxs = [i for i, a in enumerate(accounts) if a == acc]
        acc_cal = [i for i in calib if i in idxs]
        acc_hold = [i for i in holdout if i in idxs]
        assert acc_cal and acc_hold
        assert max(acc_cal) < min(acc_hold)
    # A single-window account goes to the holdout, never to calibration
    assert 10 in holdout and 10 not in calib


def test_masked_metrics_empty_subset():
    y = np.zeros((4, 6), dtype=np.float32)
    p = np.zeros((4, 6), dtype=np.float32)
    out = _masked_metrics(y, p, np.zeros(4, dtype=bool))
    assert out["samples"] == 0 and out["classesWithAuc"] == 0


@pytest.mark.parametrize(
    "label, expected",
    [
        ("London Open", "LONDON_OPEN"),
        ("NY breakout", "NY_BREAKOUT"),
        ("New York session", "NY_BREAKOUT"),
        ("SMC order block", "SMC_OB"),
        ("OB retest", "SMC_OB"),
        ("Liquidity sweep", "LIQUIDITY_SWEEP"),
        ("trend pullback", "TREND_FOLLOW"),
        ("scalping m1", "SCALPING"),
        ("ICT FVG", "ICT_FVG"),
    ],
)
def test_strategy_mapping_known_tokens(label: str, expected: str):
    assert strategy_to_idx(label) == STRATEGY_BASE_VOCAB[expected]


@pytest.mark.parametrize(
    "label, wrong",
    [
        ("Robot grid", "SMC_OB"),  # "OB" inside ROBOT
        ("Any setup", "NY_BREAKOUT"),  # "NY" inside ANY
        ("Strict rules", "ICT_FVG"),  # "ICT" inside STRICT
        ("Reopened position", "LONDON_OPEN"),  # "OPEN" inside REOPENED
        ("Sunny day", "NY_BREAKOUT"),  # "NY" inside SUNNY
    ],
)
def test_strategy_mapping_no_substring_false_positives(label: str, wrong: str):
    assert strategy_to_idx(label) != STRATEGY_BASE_VOCAB[wrong]


def test_synthetic_labels_are_never_gold():
    from app.behavior_ml.features import GOLD_LABEL_SOURCES, LABEL_SOURCE_SYNTHETIC, label_source_for_row

    assert label_source_for_row(3.0, "SYNTHETIC_ARCHETYPE") == LABEL_SOURCE_SYNTHETIC
    assert label_source_for_row(5.0, "SYNTHETIC_ARCHETYPE") == LABEL_SOURCE_SYNTHETIC
    assert label_source_for_row(1.0, "SYNTHETIC_ARCHETYPE") == LABEL_SOURCE_WEAK
    assert label_source_for_row(3.0, "REAL_DB") == LABEL_SOURCE_JOURNAL
    assert LABEL_SOURCE_SYNTHETIC not in GOLD_LABEL_SOURCES


@pytest.mark.parametrize(
    "comment",
    ["Imported HTML", "Imported via MT5 report", "Win payout if Volatility 75 Index is higher", "Lose payout if x"],
)
def test_import_and_contract_comments_are_not_strategies(comment: str):
    from app.behavior_ml.features import resolve_effective_strategy

    assert resolve_effective_strategy(None, None, 0, comment) == "<UNTAGGED>"


def test_real_comment_still_becomes_strategy():
    from app.behavior_ml.features import resolve_effective_strategy

    assert resolve_effective_strategy(None, None, 0, "Operacional EURUSD") == "CMD:Operacional EURUSD"


def test_hash_bucket_diagnostics_reports_collisions():
    sym_start = max(SYMBOL_BASE_VOCAB.values()) + 1
    strat_start = max(STRATEGY_BASE_VOCAB.values()) + 1
    df = pl.DataFrame(
        {
            "symbol_idx": [2, sym_start, sym_start, sym_start + 1],
            "symbol_token": ["XAUUSD", "FOO", "BAR", "BAZ"],
            "strategy_idx": [3, strat_start, strat_start, strat_start],
            "effective_strategy": ["London", "x", "x", "y"],
        }
    )
    diag = hash_bucket_diagnostics(df)
    sym = diag["symbol_idx"]
    assert sym["distinctHashedTokens"] == 3
    assert sym["bucketsUsed"] == 2
    assert sym["collidingBuckets"] == [{"bucket": sym_start, "tokens": ["BAR", "FOO"], "rows": 2}]
    assert diag["strategy_idx"]["collidingBuckets"][0]["tokens"] == ["x", "y"]
