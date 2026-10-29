"""Key, tempo and pitch estimation.

Analysis runs on a mono downmix at 22050 Hz. That is a deliberate exception to
the project's no-resampling rule: it affects only the estimate, never the audio
the user hears or exports, and it roughly quarters the work on an 8-minute file.
The `sampleRate` field in the response always reports the *source* rate.
"""
from __future__ import annotations

import numpy as np
import librosa

ANALYSIS_SR = 22050

PITCH_CLASSES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]

# Krumhansl-Schmuckler key profiles: the perceived stability of each scale
# degree, from the original probe-tone experiments.
KS_MAJOR = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
KS_MINOR = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])

# Below this RMS there is nothing to analyse; report zero confidence rather
# than letting the estimators produce confident noise.
SILENCE_RMS = 1e-4


def detect_key(y: np.ndarray, sr: int) -> tuple[str, str, float]:
    """Return (pitch class, 'major'|'minor', confidence 0..1).

    Confidence is the *margin* between the best and runner-up candidate, scaled,
    rather than the raw correlation. A high correlation that only barely beats
    its own relative minor is not a confident answer, and reporting it as one is
    how a tool tells someone to tune to the wrong key.
    """
    if float(np.sqrt(np.mean(y**2))) < SILENCE_RMS:
        return "C", "major", 0.0

    chroma = librosa.feature.chroma_cqt(y=y, sr=sr).mean(axis=1)
    total = chroma.sum()
    if total <= 0:
        return "C", "major", 0.0
    chroma = chroma / total

    # How peaked the chroma is, which is what distinguishes tonal material from
    # noise. Measured, on a flat (white-noise) chroma this ratio is 1.05 while
    # real tonal content sits at 2.4-3.1.
    peakedness = float(chroma.max() / chroma.mean()) - 1.0

    scored: list[tuple[float, str, str]] = []
    for i in range(12):
        # Rotating the chroma left by i expresses it relative to tonic i, so it
        # can be compared against profiles written in C. Getting this direction
        # backwards yields a consistent, plausible-looking wrong answer, which
        # is why there is a transposition test guarding it.
        rotated = np.roll(chroma, -i)
        for profile, scale in ((KS_MAJOR, "major"), (KS_MINOR, "minor")):
            corr = float(np.corrcoef(rotated, profile)[0, 1])
            if np.isnan(corr):
                corr = -1.0
            scored.append((corr, PITCH_CLASSES[i], scale))

    scored.sort(key=lambda s: -s[0])
    best, runner_up = scored[0], scored[1]

    # Margin alone is not enough, and is in fact actively misleading: white
    # noise measured a *higher* margin (0.262) than a clear C major triad
    # (0.077), because an almost-flat chroma can still correlate unevenly with
    # the 24 rotated profiles by chance. Gating the margin on peakedness is
    # what makes "no detectable key" score low instead of high.
    margin = float(np.clip((best[0] - runner_up[0]) * 4.0, 0.0, 1.0))
    tonality = float(np.clip(peakedness, 0.0, 1.0))
    confidence = float(np.clip(margin * tonality, 0.0, 1.0))
    return best[1], best[2], confidence


def detect_tempo(y: np.ndarray, sr: int) -> tuple[float, list[float], float]:
    """Return (bpm, beat onsets in seconds, confidence 0..1).

    The beat grid is returned alongside the BPM because loop snapping needs
    actual downbeat positions; a tempo number alone leaves the user nudging a
    slider to find a bar line.
    """
    if float(np.sqrt(np.mean(y**2))) < SILENCE_RMS:
        return 0.0, [], 0.0

    onset_env = librosa.onset.onset_strength(y=y, sr=sr)
    tempo, beats = librosa.beat.beat_track(onset_envelope=onset_env, sr=sr, units="time")
    grid = [float(b) for b in np.atleast_1d(beats)]

    # BPM comes from a least-squares fit of beat time against beat index, not
    # from librosa's tempo scalar. The scalar is quantised by the hop length
    # and pulled by librosa's log-normal prior around 120 BPM; measured against
    # synthetic click trains it was off by up to 2.1% (117.45 for a true 120),
    # while the line fit held within 0.1% at every tempo tried. Fitting a line
    # also averages the per-beat frame quantisation down across the whole file.
    bpm = float(np.atleast_1d(tempo)[0])
    if len(grid) >= 4:
        slope = float(np.polyfit(np.arange(len(grid)), np.asarray(grid), 1)[0])
        if slope > 0:
            bpm = 60.0 / slope

    # Confidence from how regular the recovered beats actually are. A tempo the
    # tracker is unsure about shows up as scattered inter-beat intervals.
    if len(grid) >= 3:
        spacing = np.diff(grid)
        median = float(np.median(spacing))
        if median > 0:
            jitter = float(np.median(np.abs(spacing - median)) / median)
            confidence = float(np.clip(1.0 - jitter * 5.0, 0.0, 1.0))
        else:
            confidence = 0.0
    else:
        confidence = 0.0

    return bpm, grid, confidence


# pyin dominates analysis cost -- 57.9 s of a 61 s run on an 8.5-minute file.
# Rather than analyse every frame, sample windows spread across the whole track
# and pool their voiced frames. Measured against the full-file result (110.0 Hz),
# every spread configuration tried recovered 110.0 Hz exactly in ~6.5 s, a 9x
# saving. A single contiguous 60 s window does *not* work: it returned 122.8 Hz,
# because one stretch of an 8-minute song is not representative of it. Spreading
# the windows is the whole point; shortening the audio is incidental.
PITCH_WINDOWS = 12
PITCH_WINDOW_SEC = 6.0


def detect_pitch(y: np.ndarray, sr: int) -> float:
    """Median voiced fundamental in Hz -- the reference-pitch figure."""
    if float(np.sqrt(np.mean(y**2))) < SILENCE_RMS:
        return 0.0

    fmin = float(librosa.note_to_hz("C2"))
    fmax = float(librosa.note_to_hz("C7"))
    window = int(PITCH_WINDOW_SEC * sr)

    if len(y) <= window * PITCH_WINDOWS:
        segments = [y]  # short enough to analyse whole
    else:
        starts = np.linspace(0, len(y) - window, PITCH_WINDOWS).astype(int)
        segments = [y[s : s + window] for s in starts]

    pooled: list[np.ndarray] = []
    for seg in segments:
        f0, voiced, _ = librosa.pyin(seg, fmin=fmin, fmax=fmax, sr=sr)
        if f0 is None:
            continue
        vals = f0[np.asarray(voiced, dtype=bool) & ~np.isnan(f0)]
        if vals.size:
            pooled.append(vals)

    if not pooled:
        return 0.0
    return float(np.median(np.concatenate(pooled)))


def analyze_array(y: np.ndarray, sr: int, source_sample_rate: int | None = None) -> dict:
    """Analyse a mono float array. Keys match the frontend's AnalysisResult."""
    y = np.asarray(y, dtype=np.float32)
    if y.ndim > 1:
        y = y.mean(axis=0)

    duration = float(len(y) / sr) if sr else 0.0

    if sr != ANALYSIS_SR:
        y_an = librosa.resample(y, orig_sr=sr, target_sr=ANALYSIS_SR)
        an_sr = ANALYSIS_SR
    else:
        y_an, an_sr = y, sr

    key, scale, key_conf = detect_key(y_an, an_sr)
    bpm, grid, bpm_conf = detect_tempo(y_an, an_sr)
    pitch_hz = detect_pitch(y_an, an_sr)

    return {
        "key": key,
        "scale": scale,
        "keyConfidence": round(key_conf, 4),
        "bpm": round(bpm, 2),
        "bpmConfidence": round(bpm_conf, 4),
        "beatGrid": [round(b, 4) for b in grid],
        "pitchHz": round(pitch_hz, 2),
        "durationSec": round(duration, 3),
        "sampleRate": int(source_sample_rate or sr),
    }
