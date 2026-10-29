# KeyChange

A local clone of [keypitch.app](https://keypitch.app). Load an audio file, read its
key / BPM / pitch, shift pitch and speed independently, loop a section snapped to the
beat, shape it with EQ and reverb, separate vocals from instrumental, and export.

Nothing is uploaded anywhere. There is no size or duration cap, and the source sample
rate is preserved through the whole pipeline.

## Getting it

```bash
git clone https://github.com/toverstreet/keychange.git
cd keychange
./install.sh
```

The installer adds anything missing (Node, ffmpeg, uv) via Homebrew, sets the project
up, builds `KeyChange.app` and puts it in Applications. It asks one question: whether to
include stem separation, which is the difference between a 0.9 GB and a 1.9 GB install.
`INSTALL.md` is the version of this written for someone who does not live in a terminal.

`git pull && ./install.sh` updates an existing copy.

## Running it as a desktop app

```bash
desktop/build_app.sh
open desktop/KeyChange.app
```

That builds the production app and assembles `desktop/KeyChange.app`, which starts both
servers and opens a window with no address bar or tabs. Drag it to the Dock, or
`ln -sfn "$PWD/desktop/KeyChange.app" /Applications/KeyChange.app`.

Re-run `build_app.sh` after changing the code — the app runs the built copy, and the
launcher offers to rebuild when it notices the source is newer. **Moving the project**
means rebuilding; moving the app does not, because the paths are baked in at build time.

- Port 3210, deliberately not 3000, so the app and `npm run dev` can both run.
- Logs: `~/Library/Logs/KeyChange/`
- Stop the servers: `desktop/stop.sh`. The launcher detaches them on purpose, so closing
  the window does not abandon a Demucs run that is minutes in — the cost is that they
  outlive the window, and the worker keeps torch resident.

**Open it at `127.0.0.1`, not at the machine's LAN address.** Chrome blocks a page served
from a LAN IP from fetching `127.0.0.1`, so analysis and stems fail with nothing but
`TypeError: Failed to fetch` in the console. The launcher always uses `127.0.0.1`; reaching
the app from another device would mean pointing `NEXT_PUBLIC_WORKER_URL` at a routable
address and rebuilding.

## Running it from a terminal

Two processes. The web app is useful on its own; the worker adds analysis and stems.

```bash
npm install
npm run dev        # http://localhost:3000
```

```bash
npm run worker     # http://127.0.0.1:8008
```

The worker needs [uv](https://docs.astral.sh/uv/) and ffmpeg. With it stopped the app
still loads, plays, pitches, slows, loops and exports — only the analysis and stems
panels degrade, and they say so inline.

## Tests

```bash
npm test                                   # 198 tests across the web app and contract
cd services/worker && uv run pytest        # 30 tests
```

The audio tests are not mocks. They render through `node-web-audio-api`, a real Web
Audio implementation, and assert on measured spectra: a 440 Hz sine shifted up two
semitones must land at 493.88 Hz, a 1 kHz EQ boost must raise 1 kHz without moving
125 Hz, and the offline export must match the live graph band for band. The worker's
estimators are checked against generated signals with known answers — a 120 BPM click
train, a C major scale, a 440 Hz tone.

## How it fits together

```
apps/web/          Next.js — UI, audio engine, export
packages/contract/ shared types + zod schemas for worker I/O
services/worker/   FastAPI — /analyze, /separate
```

`apps/web/lib/worker-client.ts` is the only file in the frontend that knows the worker
exists, and it validates every response against the shared schemas. To point at a hosted
GPU worker instead, set `NEXT_PUBLIC_WORKER_URL`. Nothing else changes.

## Practice and clip workflow

Loop points snap to the analysed beat grid, and the waveform zooms: scroll to zoom about
the pointer, Cmd-drag to pan, **Fit loop** to frame the current loop, **Follow** to keep
the playhead in view. This matters more than it sounds — a whole 8.5-minute track across
1600 buckets is 0.32 s per bucket against a 0.44 s beat, so bar lines are drawn but a bar
is barely a pixel column wide. Zoomed to a four-bar loop it is 0.006 s per bucket.

Export has a **Range** control whenever a loop is set: `Loop` or `Full track`, each showing
its duration. It is never applied implicitly — exporting only the loop because one happens
to be set would blindside anyone who left one behind from practising. Clip edges get a 5 ms
fade, because a cut at an arbitrary sample clicks at both ends. A four-bar clip exports in
about 0.3 s against 17.7 s for the full track, since the slice happens before the stretch.

## Decisions worth knowing before changing things

**One stretch implementation, shared by playback and export.** Stretching the whole
8.5-minute reference track takes 0.5 s, so changing pitch or speed re-renders through
the same code the export uses rather than running a separate real-time path. Export
parity is therefore structural, not something a test has to hope for. The cost is about
half a second to settle after you release a slider.

**SoundTouchJS truncates its own tail.** Extracting until the source runs dry strands
170–500 ms in its internal FIFO, and the shortfall does not grow with input length. Left
alone it clips the end off every export, invisibly. `stretchChannels` pads the source
with a second of silence and trims to an exact frame count. Don't remove that.
`spike/README.md` has the measurements.

**BPM is a line fit, not librosa's tempo scalar.** The scalar is quantised by hop length
and pulled by a prior at 120 BPM — it read 117.45 for a true 120. Fitting beat time
against beat index held within 0.1% at every tempo tested.

**Key confidence gates on chroma peakedness.** The best-vs-runner-up margin alone is
inverted on noise: white noise scored a *higher* margin (0.262) than a clear C major
triad (0.077). A low-confidence key is shown qualified rather than asserted.

**Decode at the file's own rate, never the device's.** `decodeAudioData` resamples to the
decoding context's rate, and a bare `new AudioContext()` adopts the *output device's* rate —
so a 48 kHz file on a 44.1 kHz output decodes to 44.1 kHz, and every "preserve the source
rate" guarantee downstream then faithfully preserves the wrong rate. `lib/audio/sniff.ts`
reads the rate from the container header first, and the decode happens in a context created
at it. When the rate genuinely can't be determined the UI says "resampled by the browser"
rather than claiming otherwise.

**The effect chain is built once and mutated.** Rebuilding it per parameter change restarts
the source node ~60 times a second while a slider is dragged — audible stuttering — and leaks
every previous chain, because Web Audio retains nodes still connected toward the destination.
`engine.chainBuilds` exists so a test can assert this.

**Re-anchor before changing speed.** Position is tracked in source seconds against an anchor;
adopting a new speed without re-anchoring reinterprets already-played time at the new rate and
jumps the playhead. See `lib/audio/clock.ts`, which is pure so it can be tested exhaustively.

**Don't pass `segment` to Demucs.** `htdemucs` is a transformer with a fixed training
length of 343,980 samples; overriding the segment fails inside the model. Memory is
bounded by its own overlapped splitting.

**Stems come back at 44.1 kHz** because that is the model's rate. This is the one place
the source rate is not preserved, and the UI says so.

## Verified against

`~/Desktop/Won't get fooled again 135bpm.m4a` — 8:29, 48 kHz stereo.

| | |
|---|---|
| Analysis | A major (74% confidence), 135.30 BPM against the filename's 135, 110.0 Hz (A2) |
| Cold analysis | 11.6 s |
| Export, pitched down a whole step at 0.85× | 17.7 s, 599.2 s out of an expected 599.2 s, 48 kHz preserved |
| Exported file re-analysed | **G major, 98.0 Hz** — exactly a whole step below the source |
| Separation | 48 s for the full track on MPS, 10.6× realtime |
| 44.1 kHz file on a 48 kHz output device | decodes and exports at 44.1 kHz; the pre-fix path decoded it at 48 kHz |
| 4-bar loop | 7.0 s against 7.1 s expected at 135.3 BPM |
| 4-bar loop export | 7.13 s of audio in 0.3 s, 48 kHz, first and last samples at 0 |
| Fit loop | view 8:29 -> 0:10, resolution 0.32 s -> 0.006 s per bucket |

## Not included

Lyrics display. Everything else keypitch.app does is here.

## Licence

MIT — see [LICENSE](LICENSE). Copyright © 2026 Mule AI LLC. Built by [Mule AI](https://www.muleai.ai).

Dependencies are not redistributed here: npm and PyPI fetch them on your machine when
you install, and ffmpeg comes from your own Homebrew. They carry their own licences,
among them SoundTouchJS and lamejs (LGPL), Demucs (MIT) and PyTorch (BSD).
