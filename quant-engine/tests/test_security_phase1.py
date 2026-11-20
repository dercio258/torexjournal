from __future__ import annotations

import base64
import hashlib
import hmac
import json
from pathlib import Path
import shutil
import sys
import tempfile
import time

from fastapi.testclient import TestClient
import joblib
import pytest

ROOT_DIR = Path(__file__).resolve().parent.parent
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from app.behavior_ml.dataset_builder import DEFAULT_CHECKPOINT_PATH
from app.behavior_ml.service import BehaviorMlEngine
from app.main import app


def _make_hs256_jwt(payload: dict, secret: str, alg: str = "HS256") -> str:
    header_b64 = base64.urlsafe_b64encode(
        json.dumps({"alg": alg, "typ": "JWT"}).encode("utf-8")
    ).decode("ascii").rstrip("=")
    payload_b64 = base64.urlsafe_b64encode(
        json.dumps(payload).encode("utf-8")
    ).decode("ascii").rstrip("=")
    signing_input = f"{header_b64}.{payload_b64}".encode("ascii")
    sig_b64 = base64.urlsafe_b64encode(
        hmac.new(secret.encode("utf-8"), signing_input, hashlib.sha256).digest()
    ).decode("ascii").rstrip("=")
    return f"{header_b64}.{payload_b64}.{sig_b64}"


def test_quant_auth_middleware_enforces_internal_key_and_jwt(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("QUANT_INTERNAL_KEY", "test-internal-key-phase1")
    monkeypatch.setenv("JWT_SECRET", "test-jwt-secret-phase1-32-chars!!")
    monkeypatch.setenv("QUANT_ENFORCE_AUTH", "true")

    client = TestClient(app)

    # Health endpoints remain open for probes
    assert client.get("/health").status_code == 200
    assert client.get("/api/quant/health").status_code == 200

    # Protected quant/ml endpoints reject unauthenticated callers
    assert client.get("/api/quant/market-data/catalog").status_code == 401
    assert client.get("/api/ml/behavior/status").status_code == 401

    # Valid X-Internal-Key succeeds
    ok_internal = client.get(
        "/api/quant/market-data/catalog",
        headers={"X-Internal-Key": "test-internal-key-phase1"},
    )
    assert ok_internal.status_code == 200

    # Wrong X-Internal-Key fails
    bad_internal = client.get(
        "/api/quant/market-data/catalog",
        headers={"X-Internal-Key": "wrong-key"},
    )
    assert bad_internal.status_code == 401

    # Valid Bearer JWT succeeds
    valid_jwt = _make_hs256_jwt(
        {"sub": "user-1", "exp": int(time.time()) + 300},
        "test-jwt-secret-phase1-32-chars!!",
    )
    ok_jwt = client.get(
        "/api/ml/behavior/status",
        headers={"Authorization": f"Bearer {valid_jwt}"},
    )
    assert ok_jwt.status_code == 200

    # Expired, tampered, and alg=none JWTs are rejected
    expired_jwt = _make_hs256_jwt(
        {"sub": "user-1", "exp": int(time.time()) - 60},
        "test-jwt-secret-phase1-32-chars!!",
    )
    none_jwt = _make_hs256_jwt(
        {"sub": "user-1", "exp": int(time.time()) + 300},
        "test-jwt-secret-phase1-32-chars!!",
        alg="none",
    )
    assert client.get("/api/quant/market-data/catalog", headers={"Authorization": f"Bearer {expired_jwt}"}).status_code == 401
    assert client.get("/api/quant/market-data/catalog", headers={"Authorization": f"Bearer {none_jwt}"}).status_code == 401
    assert client.get("/api/quant/market-data/catalog", headers={"Authorization": f"Bearer {valid_jwt}tampered"}).status_code == 401


def test_quant_auth_returns_503_when_strict_mode_has_no_secrets(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.delenv("QUANT_INTERNAL_KEY", raising=False)
    monkeypatch.delenv("JWT_SECRET", raising=False)
    monkeypatch.setenv("QUANT_ENFORCE_AUTH", "true")

    client = TestClient(app)
    res = client.get("/api/quant/market-data/catalog")
    assert res.status_code == 503


def test_ensemble_refuses_load_without_valid_sha256_sidecar(tmp_path: Path):
    if not DEFAULT_CHECKPOINT_PATH.exists():
        pytest.skip("Checkpoint artifact missing")

    ckpt = tmp_path / "torex_behavior_net.pt"
    ens = tmp_path / "torex_tabular_ensemble.joblib"
    shutil.copy2(DEFAULT_CHECKPOINT_PATH, ckpt)
    joblib.dump({"estimators": [], "dummy": True}, ens)

    # 1. Missing .sha256 -> refuses to load ensemble
    engine_no_hash = BehaviorMlEngine(checkpoint_path=ckpt, ensemble_path=ens)
    engine_no_hash.ensure_loaded()
    assert engine_no_hash._ensemble is None

    # 2. Tampered .sha256 -> refuses to load ensemble
    digest_path = Path(f"{ens}.sha256")
    digest_path.write_text("0" * 64 + "\n", encoding="utf-8")
    engine_bad_hash = BehaviorMlEngine(checkpoint_path=ckpt, ensemble_path=ens)
    engine_bad_hash.ensure_loaded()
    assert engine_bad_hash._ensemble is None

    # 3. Valid .sha256 -> loads cleanly
    real_sha = hashlib.sha256(ens.read_bytes()).hexdigest()
    digest_path.write_text(f"{real_sha}\n", encoding="utf-8")
    engine_valid = BehaviorMlEngine(checkpoint_path=ckpt, ensemble_path=ens)
    engine_valid.ensure_loaded()
    assert isinstance(engine_valid._ensemble, dict)
    assert "estimators" in engine_valid._ensemble
