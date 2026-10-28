"""Endpoint contract tests. These guard the shape the frontend's zod schemas
parse, which is the one thing a hosted worker swap must not break."""
import io
import subprocess
import tempfile
from pathlib import Path

import numpy as np
import pytest
from fastapi.testclient import TestClient

from keypitch_worker.main import app

client = TestClient(app)


@pytest.fixture(scope="module")
def wav_bytes() -> bytes:
    """A real 2 s 48 kHz stereo WAV, produced by ffmpeg so the test exercises
    the actual decode path rather than a hand-written header."""
    with tempfile.TemporaryDirectory() as d:
        path = Path(d) / "tone.wav"
        subprocess.run(
            ["ffmpeg", "-v", "error", "-y", "-f", "lavfi",
             "-i", "sine=frequency=440:duration=2:sample_rate=48000",
             "-ac", "2", str(path)],
            check=True,
        )
        return path.read_bytes()


def test_health():
    r = client.get("/health")
    assert r.status_code == 200 and r.json() == {"ok": True}


def test_analyze_returns_the_contract_shape(wav_bytes):
    r = client.post("/analyze", files={"file": ("tone.wav", wav_bytes, "audio/wav")})
    assert r.status_code == 200, r.text
    body = r.json()
    required = {"key", "scale", "keyConfidence", "bpm", "bpmConfidence",
                "beatGrid", "pitchHz", "durationSec", "sampleRate"}
    assert required <= set(body)
    assert isinstance(body["beatGrid"], list)
    assert body["pitchHz"] == pytest.approx(440.0, abs=1.0)


def test_analyze_reports_the_source_sample_rate_not_the_analysis_rate(wav_bytes):
    """Analysis runs at 22050 Hz internally; the response must still say 48000,
    or the frontend would build its export context at the wrong rate."""
    body = client.post("/analyze", files={"file": ("tone.wav", wav_bytes, "audio/wav")}).json()
    assert body["sampleRate"] == 48000


def test_analyze_is_cached_by_content(wav_bytes):
    a = client.post("/analyze", files={"file": ("a.wav", wav_bytes, "audio/wav")}).json()
    b = client.post("/analyze", files={"file": ("renamed.wav", wav_bytes, "audio/wav")}).json()
    assert a == b, "same bytes under a different filename must hit the cache"


def test_analyze_rejects_an_empty_upload():
    r = client.post("/analyze", files={"file": ("x.wav", b"", "audio/wav")})
    assert r.status_code == 400


def test_analyze_rejects_a_non_audio_payload():
    r = client.post("/analyze", files={"file": ("x.wav", b"not audio at all", "audio/wav")})
    assert r.status_code == 415


def test_decode_returns_a_wav(wav_bytes):
    r = client.post("/decode", files={"file": ("tone.wav", wav_bytes, "audio/wav")})
    assert r.status_code == 200
    assert r.content[:4] == b"RIFF"
