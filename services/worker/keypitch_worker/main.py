"""FastAPI routes. Logic lives in the sibling modules; this file only wires."""
from __future__ import annotations

import tempfile
from pathlib import Path

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

from . import cache, separate as separation
from .analyze import ANALYSIS_SR, analyze_array
from .audio_io import DecodeError, decode_to_array, decode_to_wav, probe

app = FastAPI(title="keypitch-worker", version="0.1.0")

# The frontend is a separate origin in development and may be a hosted origin
# later. This worker only ever handles audio the user themselves submitted.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> dict:
    return {"ok": True}


# Deliberately `def`, not `async def`. FastAPI runs sync handlers in a
# threadpool but runs async ones on the event loop itself -- and the body here
# is blocking (subprocess, librosa). As `async def`, a ~12 s cold analysis made
# the whole worker unresponsive, so /health and every separation poll queued
# behind it.
@app.post("/analyze")
def analyze(file: UploadFile = File(...)) -> dict:
    data = file.file.read()
    if not data:
        raise HTTPException(status_code=400, detail="empty upload")

    digest = cache.content_hash(data)
    cached = cache.read_json(digest, "analysis.json")
    if cached is not None:
        return cached

    suffix = Path(file.filename or "audio").suffix or ".bin"
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=True) as tmp:
        tmp.write(data)
        tmp.flush()
        try:
            info = probe(tmp.name)
            y, sr = decode_to_array(tmp.name, sr=ANALYSIS_SR, mono=True)
        except DecodeError as exc:
            raise HTTPException(status_code=415, detail=str(exc)) from exc
        result = analyze_array(y, sr, source_sample_rate=info["sample_rate"])

    # ffprobe's container duration is more trustworthy than a sample count
    # derived from a resampled decode.
    if info["duration"] > 0:
        result["durationSec"] = round(info["duration"], 3)

    cache.write_json(digest, "analysis.json", result)
    return result


@app.post("/decode")
def decode(file: UploadFile = File(...)) -> FileResponse:
    """WAV fallback for codecs the browser refuses to decode.

    Sync for the same reason as /analyze: the ffmpeg call blocks."""
    data = file.file.read()
    if not data:
        raise HTTPException(status_code=400, detail="empty upload")

    digest = cache.content_hash(data)
    out = cache.cache_dir(digest) / "source.wav"
    if not out.exists():
        suffix = Path(file.filename or "audio").suffix or ".bin"
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=True) as tmp:
            tmp.write(data)
            tmp.flush()
            try:
                decode_to_wav(tmp.name, out)
            except DecodeError as exc:
                raise HTTPException(status_code=415, detail=str(exc)) from exc
    return FileResponse(out, media_type="audio/wav", filename="source.wav")


@app.post("/separate")
def start_separation(file: UploadFile = File(...)) -> dict:
    data = file.file.read()
    if not data:
        raise HTTPException(status_code=400, detail="empty upload")
    job = separation.start_job(data, file.filename or "audio")
    return job.as_dict()


@app.get("/separate/{job_id}")
def separation_status(job_id: str) -> dict:
    try:
        return separation.get_job(job_id).as_dict()
    except separation.UnknownJobError as exc:
        raise HTTPException(status_code=404, detail="unknown separation job") from exc


@app.get("/separate/{job_id}/{stem}")
def separation_stem(job_id: str, stem: str) -> FileResponse:
    if stem not in separation.STEM_FILES:
        raise HTTPException(status_code=404, detail="unknown stem")
    try:
        path = separation.stem_path(job_id, stem)
    except separation.UnknownJobError as exc:
        raise HTTPException(status_code=404, detail="stem not ready") from exc
    if not path.exists():
        raise HTTPException(status_code=404, detail="stem file missing")
    return FileResponse(path, media_type="audio/wav", filename=f"{stem}.wav")
