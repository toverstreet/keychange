# Phase 0 spike — time/pitch backend decision

Run: `node spike/stretch-spike.mjs`

## Verdict: SoundTouchJS. Proceed.

Measured on Apple M4, Node 24.14.1, soundtouchjs 0.3.0, 48 kHz:

| Question | Result |
|---|---|
| Pitch accuracy at +2 semitones | 493.75 Hz vs 493.88 expected — **0.027% error** |
| Duration preserved under pitch shift | exact (192000 / 192000 frames) |
| Speed 1.5 / 0.85 scale duration | exact ratios 1.5000 / 0.8500 |
| Speed leaves pitch alone | 439.69 / 439.87 Hz vs 440 — under 0.08% |
| Deterministic across runs | yes, byte-identical |

Rubber Band WASM is therefore not needed. Only `timepitch-node.ts` and
`stretch.worker.ts` would change if that ever reverses.

## The finding that matters: SoundTouchJS truncates the tail

The naive loop — extract until the source runs dry — loses **170–500 ms** off
the end. Crucially the shortfall does **not** grow with input length, so it is
not a proportional/rate error; it is audio stranded in SoundTouch's internal
FIFO when the source stops feeding it.

Measured deficits (see `latency-probe.mjs`):

```
1s pitch+2   deficit 11221 frames (233.8 ms)
2s pitch+2   deficit 10182 frames (212.1 ms)
4s pitch+2   deficit  8105 frames (168.9 ms)
1s speed0.85 deficit 24054 frames (501.1 ms)
```

Unhandled, this silently cuts the last few hundred milliseconds off every
export — the kind of bug that passes every "does it sound right?" check because
nobody listens to the last half-second.

**Required mitigation, now binding on `stretchOffline` (Task 8):**

1. Pad the source with **1.0 s of silence** (past the 0.5 s worst case observed).
2. Extract until `expected = round(sourceFrames / speed)` frames are written.
3. Trim to exactly `expected`.

The spike asserts the recovered tail carries real signal (RMS 0.64, not silence),
so the padding genuinely flushes the pipeline rather than appending zeros.
