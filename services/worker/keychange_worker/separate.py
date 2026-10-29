"""Demucs stem separation, run as a background job.

Separation takes minutes, so the HTTP surface is start/poll rather than one
long request: a browser fetch left open for several minutes is at the mercy of
every proxy and timeout between here and there, and gives no progress.

Results are cached by content hash. Separating the reference file twice should
cost nothing the second time.
"""
from __future__ import annotations

import threading
import traceback
from dataclasses import dataclass, field
from pathlib import Path

from . import cache

# Demucs emits four stems; the instrumental is the sum of everything but the
# vocals, which is what people actually want alongside an acapella.
VOCAL_STEM = "vocals"
STEM_FILES = {"vocals": "vocals.wav", "instrumental": "no_vocals.wav"}

# Memory is bounded by Demucs' own overlapped splitting (`split=True`), using
# each model's natural segment length.
#
# Do NOT override `segment` for htdemucs. It is a transformer with a fixed
# training length of 343,980 samples (7.8 s at 44.1 kHz), and passing a larger
# value fails inside the model with
#   RuntimeError: shape '[1, 4, -1, 343980]' is invalid for input of size ...
# An earlier version set segment=10 "to avoid OOM" and simply broke separation
# outright -- the splitting that actually bounds memory was already happening.
SEGMENT_SECONDS = None


def separator_kwargs() -> dict:
    """Arguments for demucs' Separator. Split out so the configuration can be
    asserted in tests without loading torch or the model weights."""
    kwargs: dict = {"model": "htdemucs", "split": True}
    if SEGMENT_SECONDS is not None:
        kwargs["segment"] = SEGMENT_SECONDS
    return kwargs


@dataclass
class Job:
    id: str
    status: str = "queued"  # queued | running | done | error
    progress: float = 0.0
    error: str | None = None
    stems: dict[str, str] | None = None
    lock: threading.Lock = field(default_factory=threading.Lock)

    def as_dict(self) -> dict:
        with self.lock:
            return {
                "id": self.id,
                "status": self.status,
                "progress": round(self.progress, 4),
                "error": self.error,
                "stems": (
                    {"vocals": f"/separate/{self.id}/vocals", "instrumental": f"/separate/{self.id}/instrumental"}
                    if self.stems
                    else None
                ),
            }


_jobs: dict[str, Job] = {}
_jobs_lock = threading.Lock()

# One separation at a time. Two concurrent Demucs runs on one GPU is slower than
# running them in sequence and risks exhausting memory.
_gpu_lock = threading.Lock()


class UnknownJobError(KeyError):
    pass


def _separator():
    """Built lazily: importing demucs pulls in torch, which costs seconds, and
    the analysis endpoint should not pay for it."""
    import torch
    from demucs.api import Separator

    device = "mps" if torch.backends.mps.is_available() else "cpu"
    return Separator(device=device, **separator_kwargs())


def _run(job: Job, digest: str, source: Path) -> None:
    try:
        with job.lock:
            job.status = "running"
            job.progress = 0.02

        out_dir = cache.cache_dir(digest)
        vocals_path = out_dir / STEM_FILES["vocals"]
        instrumental_path = out_dir / STEM_FILES["instrumental"]

        if not (vocals_path.exists() and instrumental_path.exists()):
            with _gpu_lock:
                import soundfile as sf
                import torch

                separator = _separator()
                with job.lock:
                    job.progress = 0.1

                _, stems = separator.separate_audio_file(source)

                with job.lock:
                    job.progress = 0.85

                vocals = stems[VOCAL_STEM]
                instrumental = sum(
                    tensor for name, tensor in stems.items() if name != VOCAL_STEM
                )

                rate = separator.samplerate
                # soundfile rather than torchaudio.save: torchaudio 2.11
                # delegates encoding to TorchCodec, which is a further
                # dependency, while soundfile is already required for analysis.
                # It also wants (frames, channels), the transpose of the
                # (channels, frames) tensors Demucs returns.
                sf.write(str(vocals_path), vocals.cpu().numpy().T, rate)
                sf.write(str(instrumental_path), instrumental.cpu().numpy().T, rate)
                del separator
                if torch.backends.mps.is_available():
                    torch.mps.empty_cache()

        with job.lock:
            job.stems = {"vocals": str(vocals_path), "instrumental": str(instrumental_path)}
            job.progress = 1.0
            job.status = "done"

    except Exception as exc:  # noqa: BLE001 - the message must reach the user
        with job.lock:
            job.status = "error"
            job.error = f"{type(exc).__name__}: {exc}"
        traceback.print_exc()


def start_job(data: bytes, filename: str = "audio") -> Job:
    """Start (or return a cached) separation for these bytes."""
    digest = cache.content_hash(data)

    with _jobs_lock:
        existing = _jobs.get(digest)
        if existing is not None and existing.status in ("queued", "running", "done"):
            return existing

        out_dir = cache.cache_dir(digest)
        vocals = out_dir / STEM_FILES["vocals"]
        instrumental = out_dir / STEM_FILES["instrumental"]

        job = Job(id=digest)
        _jobs[digest] = job

        if vocals.exists() and instrumental.exists():
            job.status = "done"
            job.progress = 1.0
            job.stems = {"vocals": str(vocals), "instrumental": str(instrumental)}
            return job

        suffix = Path(filename).suffix or ".bin"
        source = out_dir / f"source{suffix}"
        source.write_bytes(data)

        thread = threading.Thread(target=_run, args=(job, digest, source), daemon=True)
        thread.start()
        return job


def get_job(job_id: str) -> Job:
    with _jobs_lock:
        job = _jobs.get(job_id)
    if job is None:
        raise UnknownJobError(job_id)
    return job


def stem_path(job_id: str, stem: str) -> Path:
    job = get_job(job_id)
    with job.lock:
        if not job.stems or stem not in job.stems:
            raise UnknownJobError(f"{job_id}/{stem}")
        return Path(job.stems[stem])


def _reset_for_tests() -> None:
    with _jobs_lock:
        _jobs.clear()
