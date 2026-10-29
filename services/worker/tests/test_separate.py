"""Separation job-lifecycle tests.

The real model is never loaded here: a Demucs run takes minutes and needs a
GPU, which would make this suite useless as a fast feedback loop. What is
tested is the part that actually breaks -- the job state machine, caching and
the HTTP contract the frontend parses.
"""
import time

import pytest
from fastapi.testclient import TestClient

from keychange_worker import separate as separation
from keychange_worker.main import app

client = TestClient(app)


@pytest.fixture(autouse=True)
def clean_registry():
    separation._reset_for_tests()
    yield
    separation._reset_for_tests()


@pytest.fixture
def stub_run(monkeypatch):
    """Replace the Demucs run with one that writes two stub stems."""
    def fake_run(job, digest, source):
        from keychange_worker import cache
        out = cache.cache_dir(digest)
        for name in separation.STEM_FILES.values():
            (out / name).write_bytes(b"RIFF....WAVEstub")
        with job.lock:
            job.stems = {
                "vocals": str(out / separation.STEM_FILES["vocals"]),
                "instrumental": str(out / separation.STEM_FILES["instrumental"]),
            }
            job.progress = 1.0
            job.status = "done"

    monkeypatch.setattr(separation, "_run", fake_run)
    return fake_run


def wait_for(job_id: str, status: str, timeout: float = 3.0):
    deadline = time.time() + timeout
    while time.time() < deadline:
        job = separation.get_job(job_id)
        if job.as_dict()["status"] == status:
            return job
        time.sleep(0.02)
    raise AssertionError(f"job did not reach {status}")


def test_unknown_job_raises():
    with pytest.raises(separation.UnknownJobError):
        separation.get_job("nope")


def test_unknown_job_is_404():
    assert client.get("/separate/nope").status_code == 404


def test_job_runs_to_done(stub_run):
    job = separation.start_job(b"some audio bytes", "a.m4a")
    done = wait_for(job.id, "done")
    payload = done.as_dict()
    assert payload["progress"] == 1.0
    assert payload["stems"]["vocals"].endswith("/vocals")


def test_job_is_keyed_by_content_so_the_same_file_reuses_it(stub_run):
    a = separation.start_job(b"identical bytes", "a.m4a")
    wait_for(a.id, "done")
    b = separation.start_job(b"identical bytes", "renamed.m4a")
    assert a.id == b.id
    assert b.as_dict()["status"] == "done"


def test_a_failing_run_reports_error_rather_than_hanging(monkeypatch):
    def boom(job, digest, source):
        with job.lock:
            job.status = "error"
            job.error = "RuntimeError: out of memory"

    monkeypatch.setattr(separation, "_run", boom)
    job = separation.start_job(b"bytes", "a.m4a")
    done = wait_for(job.id, "error")
    assert "out of memory" in done.as_dict()["error"]


def test_api_contract_shape(stub_run):
    res = client.post("/separate", files={"file": ("a.m4a", b"bytes here", "audio/mp4")})
    assert res.status_code == 200
    body = res.json()
    assert set(body) == {"id", "status", "progress", "error", "stems"}
    assert body["status"] in ("queued", "running", "done")

    wait_for(body["id"], "done")
    polled = client.get(f"/separate/{body['id']}").json()
    assert polled["status"] == "done"
    assert polled["stems"]["instrumental"].endswith("/instrumental")


def test_stem_download(stub_run):
    job = separation.start_job(b"bytes for stems", "a.m4a")
    wait_for(job.id, "done")
    res = client.get(f"/separate/{job.id}/vocals")
    assert res.status_code == 200
    assert res.content.startswith(b"RIFF")


def test_unknown_stem_name_is_404(stub_run):
    job = separation.start_job(b"bytes for stems 2", "a.m4a")
    wait_for(job.id, "done")
    assert client.get(f"/separate/{job.id}/drums").status_code == 404


def test_empty_upload_rejected():
    assert client.post("/separate", files={"file": ("a.m4a", b"", "audio/mp4")}).status_code == 400


def test_separator_relies_on_demucs_splitting_and_does_not_override_segment():
    """htdemucs has a fixed training length of 343,980 samples. Overriding
    `segment` fails inside the model with an invalid-shape RuntimeError, which
    is exactly what an earlier "avoid OOM" change caused. Memory is bounded by
    split=True, not by a segment override."""
    kwargs = separation.separator_kwargs()
    assert kwargs["split"] is True
    assert "segment" not in kwargs


def test_reports_a_clear_message_when_separation_is_not_installed(monkeypatch):
    """A light install reaches this code with torch and demucs absent. It must
    say so plainly rather than failing with an ImportError, or minutes into a
    job that was never going to run."""
    monkeypatch.setattr(separation, "stems_available", lambda: False)
    job = separation.start_job(b"some bytes", "a.m4a")
    payload = job.as_dict()
    assert payload["status"] == "error"
    assert "not installed" in payload["error"]
    assert "uv sync --extra stems" in payload["error"]


def test_stems_available_reports_true_in_this_environment():
    # The development environment has the extra installed; if this ever fails
    # the check itself is broken rather than the environment.
    import importlib.util

    expected = importlib.util.find_spec("torch") is not None
    assert separation.stems_available() is expected
