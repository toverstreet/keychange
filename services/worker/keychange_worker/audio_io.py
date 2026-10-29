"""Decoding via ffmpeg.

ffmpeg rather than soundfile/librosa because it handles everything the browser
might hand us -- AAC in an m4a, audio inside an mp4, flac, opus -- without a
per-codec Python dependency. ffmpeg 8.1.1 is already on this machine.
"""
from __future__ import annotations

import json
import subprocess
from pathlib import Path

import numpy as np

from .analyze import ANALYSIS_SR


class DecodeError(RuntimeError):
    pass


def probe(path: str | Path) -> dict:
    """Source sample rate, channels and duration, before any resampling."""
    cmd = [
        "ffprobe", "-v", "error", "-select_streams", "a:0",
        "-show_entries", "stream=sample_rate,channels",
        "-show_entries", "format=duration",
        "-of", "json", str(path),
    ]
    try:
        out = subprocess.run(cmd, capture_output=True, check=True, timeout=120).stdout
    except subprocess.CalledProcessError as exc:
        raise DecodeError(f"ffprobe failed: {exc.stderr.decode('utf-8', 'replace')[:400]}") from exc
    data = json.loads(out or b"{}")
    streams = data.get("streams") or [{}]
    fmt = data.get("format") or {}
    if not streams or "sample_rate" not in streams[0]:
        raise DecodeError("no audio stream found")
    return {
        "sample_rate": int(streams[0]["sample_rate"]),
        "channels": int(streams[0].get("channels", 1)),
        "duration": float(fmt.get("duration", 0.0)),
    }


def decode_to_array(path: str | Path, sr: int = ANALYSIS_SR, mono: bool = True) -> tuple[np.ndarray, int]:
    """Decode to a float32 array at `sr`. Returns (samples, sr)."""
    cmd = [
        "ffmpeg", "-v", "error", "-i", str(path),
        "-f", "f32le", "-acodec", "pcm_f32le",
        "-ac", "1" if mono else "2", "-ar", str(sr), "-",
    ]
    proc = subprocess.run(cmd, capture_output=True, timeout=1800)
    if proc.returncode != 0:
        raise DecodeError(f"ffmpeg failed: {proc.stderr.decode('utf-8', 'replace')[:400]}")
    y = np.frombuffer(proc.stdout, dtype=np.float32)
    if y.size == 0:
        raise DecodeError("decoded zero samples")
    if not mono:
        y = y.reshape(-1, 2).T
    return y, sr


def decode_to_wav(path: str | Path, out_path: str | Path) -> Path:
    """Transcode to WAV, preserving the source rate and channel count.

    Used for the browser's decode fallback: if `decodeAudioData` refuses a
    codec, the frontend gets a WAV it can always decode. The source rate is
    preserved deliberately -- resampling here would defeat the project's
    promise not to quietly downgrade the audio.
    """
    cmd = ["ffmpeg", "-v", "error", "-y", "-i", str(path), "-c:a", "pcm_f32le", "-f", "wav", str(out_path)]
    proc = subprocess.run(cmd, capture_output=True, timeout=1800)
    if proc.returncode != 0:
        raise DecodeError(f"ffmpeg failed: {proc.stderr.decode('utf-8', 'replace')[:400]}")
    return Path(out_path)
