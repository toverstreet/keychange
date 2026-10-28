"""Estimator tests built on synthetic signals with known answers.

No binary fixtures: the signals are generated, so the tests are fast, run
anywhere, and genuinely exercise the estimators rather than memorising one
file's output.
"""
import numpy as np
import pytest

from keypitch_worker.analyze import analyze_array, detect_key

SR = 22050


def click_train(bpm: float, seconds: float = 8.0, sr: int = SR) -> np.ndarray:
    """Impulses at a known tempo. Unambiguous ground truth for beat tracking."""
    y = np.zeros(int(sr * seconds), dtype=np.float32)
    period = sr * 60.0 / bpm
    n = 0
    while int(n * period) < len(y):
        # A short decaying burst reads as a percussive onset; a single sample
        # has too little energy for the onset detector to latch onto reliably.
        i = int(n * period)
        burst = np.exp(-np.arange(200) / 20.0).astype(np.float32)
        end = min(i + 200, len(y))
        y[i:end] += burst[: end - i]
        n += 1
    return y


def tone(freq: float, seconds: float, sr: int = SR) -> np.ndarray:
    t = np.arange(int(sr * seconds)) / sr
    return np.sin(2 * np.pi * freq * t).astype(np.float32)


def chord_progression(freqs_per_chord, seconds_each=1.0, sr=SR) -> np.ndarray:
    """Stacked sine chords, which give the chroma estimator real harmonic content."""
    parts = []
    for freqs in freqs_per_chord:
        seg = np.zeros(int(sr * seconds_each), dtype=np.float32)
        for f in freqs:
            seg += tone(f, seconds_each, sr)
        parts.append(seg / len(freqs))
    return np.concatenate(parts)


class TestBpm:
    @pytest.mark.parametrize("bpm", [100, 120, 135])
    def test_recovers_known_tempo(self, bpm):
        out = analyze_array(click_train(bpm), SR)
        assert abs(out["bpm"] - bpm) / bpm < 0.02, f"got {out['bpm']} want {bpm}"

    def test_beat_grid_spacing_matches_bpm(self):
        out = analyze_array(click_train(120), SR)
        grid = out["beatGrid"]
        assert len(grid) > 8, "expected a usable number of beats"
        spacing = np.diff(grid)
        # 120 BPM = 0.5 s between beats. Loop snapping is only as good as this.
        assert abs(float(np.median(spacing)) - 0.5) < 0.03

    def test_beat_grid_is_sorted_and_non_negative(self):
        grid = analyze_array(click_train(120), SR)["beatGrid"]
        assert all(b >= 0 for b in grid)
        assert grid == sorted(grid)


class TestKey:
    def test_c_major_scale(self):
        freqs = [261.63, 293.66, 329.63, 349.23, 392.00, 440.00, 493.88, 523.25]
        y = np.concatenate([tone(f, 0.5) for f in freqs])
        out = analyze_array(y, SR)
        assert out["key"] == "C"
        assert out["scale"] == "major"

    def test_c_major_chords(self):
        # I - IV - V - I in C major
        y = chord_progression([
            [261.63, 329.63, 392.00],  # C  E  G
            [349.23, 440.00, 523.25],  # F  A  C
            [392.00, 493.88, 587.33],  # G  B  D
            [261.63, 329.63, 392.00],  # C  E  G
        ])
        out = analyze_array(y, SR)
        assert out["key"] == "C"

    def test_transposing_the_input_transposes_the_detected_key(self):
        """A whole step up from C major must read as D major. This catches a
        rotation-direction error in the chroma correlation, which is the single
        easiest way to get key detection subtly and consistently wrong."""
        ratio = 2 ** (2 / 12)
        freqs = [261.63, 293.66, 329.63, 349.23, 392.00, 440.00, 493.88, 523.25]
        y = np.concatenate([tone(f * ratio, 0.5) for f in freqs])
        assert analyze_array(y, SR)["key"] == "D"

    def test_confidence_is_a_margin_not_a_correlation(self):
        """Ambiguous input must score lower than unambiguous input."""
        clear = np.concatenate([tone(f, 0.5) for f in [261.63, 329.63, 392.00] * 3])
        noise = np.random.default_rng(0).standard_normal(SR * 4).astype(np.float32)
        _, _, clear_conf = detect_key(clear, SR)
        _, _, noise_conf = detect_key(noise, SR)
        assert clear_conf > noise_conf
        assert 0.0 <= noise_conf <= 1.0 and 0.0 <= clear_conf <= 1.0


class TestPitch:
    @pytest.mark.parametrize("freq", [220.0, 440.0])
    def test_recovers_sine_fundamental(self, freq):
        out = analyze_array(tone(freq, 2.0), SR)
        assert abs(out["pitchHz"] - freq) < 1.0, f"got {out['pitchHz']} want {freq}"


class TestContract:
    def test_returns_every_field_the_frontend_schema_requires(self):
        out = analyze_array(click_train(120), SR)
        required = {
            "key", "scale", "keyConfidence", "bpm", "bpmConfidence",
            "beatGrid", "pitchHz", "durationSec", "sampleRate",
        }
        assert required <= set(out)
        assert out["scale"] in ("major", "minor")
        assert 0.0 <= out["keyConfidence"] <= 1.0
        assert 0.0 <= out["bpmConfidence"] <= 1.0
        assert out["durationSec"] == pytest.approx(8.0, abs=0.1)

    def test_handles_silence_without_crashing(self):
        """A silent or near-silent file must degrade, not raise."""
        out = analyze_array(np.zeros(SR * 2, dtype=np.float32), SR)
        assert out["keyConfidence"] == 0.0
        assert out["pitchHz"] == 0.0
