"""Content-addressed cache.

Keyed by SHA-256 of the file bytes, so re-analysing or re-separating the same
audio is a hit regardless of filename. Analysis of an 8-minute file takes tens
of seconds and separation takes minutes; neither should ever be paid twice.
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

CACHE_ROOT = Path(__file__).resolve().parent.parent / ".cache"


def content_hash(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def cache_dir(digest: str) -> Path:
    d = CACHE_ROOT / digest
    d.mkdir(parents=True, exist_ok=True)
    return d


def read_json(digest: str, name: str) -> dict | None:
    path = cache_dir(digest) / name
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text())
    except (json.JSONDecodeError, OSError):
        # A truncated cache entry is a miss, not a crash.
        return None


def write_json(digest: str, name: str, payload: dict) -> None:
    tmp = cache_dir(digest) / f"{name}.tmp"
    tmp.write_text(json.dumps(payload))
    tmp.replace(cache_dir(digest) / name)
