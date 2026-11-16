"""Gemini embeddings for the evaluation set, cached on disk so each phrase is embedded once.

Only the fixed, synthetic evaluation phrases are sent; no user data. Without a
GEMINI_API_KEY the lab falls back to lexical-only evaluation.
"""

from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path

import httpx

from .db import load_env

MODEL = "gemini-embedding-2"
DIMENSIONS = 768
_URL = "https://generativelanguage.googleapis.com/v1beta/models/{model}:embedContent"


class EmbeddingCache:
    def __init__(self, path: Path):
        self.path = path
        self._data: dict[str, list[float]] = {}
        if path.exists():
            self._data = json.loads(path.read_text(encoding="utf-8"))

    @staticmethod
    def key(text: str, task_type: str) -> str:
        return hashlib.sha256(f"{MODEL}:{DIMENSIONS}:{task_type}:{text}".encode("utf-8")).hexdigest()[:32]

    def get(self, text: str, task_type: str) -> list[float] | None:
        return self._data.get(self.key(text, task_type))

    def put(self, text: str, task_type: str, values: list[float]) -> None:
        self._data[self.key(text, task_type)] = values

    def save(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.path.write_text(json.dumps(self._data), encoding="utf-8")


def gemini_key() -> str | None:
    load_env()
    key = os.environ.get("GEMINI_API_KEY", "").strip()
    return key or None


def embed_texts(texts: list[tuple[str, str]], cache: EmbeddingCache, timeout_s: float = 20.0) -> dict[tuple[str, str], list[float]]:
    """Embeds (text, task_type) pairs, using the cache first. Raises if the API is unreachable."""
    key = gemini_key()
    out: dict[tuple[str, str], list[float]] = {}
    missing = [(t, task) for t, task in texts if cache.get(t, task) is None]
    if missing and not key:
        raise RuntimeError("GEMINI_API_KEY is not set")
    with httpx.Client(timeout=timeout_s) as client:
        for text, task in missing:
            resp = client.post(
                _URL.format(model=MODEL),
                headers={"Content-Type": "application/json", "x-goog-api-key": key or ""},
                json={
                    "model": f"models/{MODEL}",
                    "content": {"parts": [{"text": text}]},
                    "taskType": task,
                    "outputDimensionality": DIMENSIONS,
                },
            )
            resp.raise_for_status()
            values = resp.json().get("embedding", {}).get("values") or []
            if values:
                cache.put(text, task, values)
    cache.save()
    for text, task in texts:
        values = cache.get(text, task)
        if values:
            out[(text, task)] = values
    return out
