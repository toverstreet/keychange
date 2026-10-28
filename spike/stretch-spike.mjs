/**
 * Phase 0 spike. Answers three questions before anything depends on SoundTouchJS:
 *   1. Does it shift pitch accurately while preserving duration?
 *   2. Is its synchronous buffer path deterministic?
 *   3. Can the pipeline tail be recovered?
 *
 * (2) is what the Phase 2 export path rests on: if identical input can yield
 * different output, "what you download is what you heard" is unprovable.
 *
 * (3) turned out to be the real finding. SoundTouchJS leaves 170-500 ms stuck in
 * its internal FIFO when the source runs dry, and the shortfall does not grow
 * with input length -- it is an unflushed tail, not a proportional error. Left
 * unhandled it silently truncates the end of every export. The fix proven here
 * is to pad the source with silence past the worst-case latency, then trim the
 * result to the exact expected frame count. `stretchOffline` must do the same.
 */
import assert from 'node:assert'
import { SoundTouch, SimpleFilter } from 'soundtouchjs'

const SR = 48000
const FREQ = 440
const FLUSH_PAD_SEC = 1.0 // comfortably past the ~0.5 s worst case measured

function makeSource(mono) {
  return {
    extract(target, numFrames, position) {
      const available = Math.max(0, Math.min(numFrames, mono.length - position))
      for (let i = 0; i < available; i++) {
        const s = mono[position + i]
        target[i * 2] = s
        target[i * 2 + 1] = s
      }
      return available
    },
  }
}

function sine(freq, seconds, sr = SR) {
  const out = new Float32Array(Math.floor(seconds * sr))
  for (let i = 0; i < out.length; i++) out[i] = Math.sin((2 * Math.PI * freq * i) / sr)
  return out
}

/** Pitch/time stretch with the tail recovered and the length made exact. */
function process(mono, { pitchSemitones = 0, speed = 1 }) {
  const padded = new Float32Array(mono.length + Math.floor(FLUSH_PAD_SEC * SR))
  padded.set(mono, 0)

  const st = new SoundTouch()
  st.pitchSemitones = pitchSemitones
  st.tempo = speed
  const filter = new SimpleFilter(makeSource(padded), st)

  const CHUNK = 4096
  const buf = new Float32Array(CHUNK * 2)
  const expected = Math.round(mono.length / speed)
  const out = new Float32Array(expected)
  let written = 0
  let frames
  let guard = Math.ceil((padded.length / CHUNK) * 8) + 256

  while (written < expected && (frames = filter.extract(buf, CHUNK)) > 0 && guard-- > 0) {
    const take = Math.min(frames, expected - written)
    for (let i = 0; i < take; i++) out[written + i] = buf[i * 2]
    written += take
  }
  // A shortfall here would mean even the padded run came up short.
  return { audio: out, written, expected }
}

function estimateFreq(x, sr = SR) {
  const a = Math.floor(x.length * 0.3)
  const b = Math.floor(x.length * 0.7)
  let crossings = 0
  for (let i = a + 1; i < b; i++) {
    if ((x[i - 1] < 0 && x[i] >= 0) || (x[i - 1] >= 0 && x[i] < 0)) crossings++
  }
  return (crossings * sr) / (2 * (b - a))
}

const results = {}
const input = sine(FREQ, 4)

// --- 1. pitch accuracy, duration preserved -------------------------------
const up2 = process(input, { pitchSemitones: 2 })
const up2Freq = estimateFreq(up2.audio)
const want = FREQ * Math.pow(2, 2 / 12)
const pitchErr = Math.abs(up2Freq - want) / want
results.pitch = { got: +up2Freq.toFixed(2), want: +want.toFixed(2), errPct: +(pitchErr * 100).toFixed(3) }
results.pitchDuration = { frames: up2.written, expected: up2.expected, complete: up2.written === up2.expected }

// --- 2. speed changes duration but not pitch -----------------------------
for (const speed of [1.5, 0.85]) {
  const r = process(input, { speed })
  results[`speed${speed}`] = {
    ratio: +(input.length / r.written).toFixed(4),
    pitchHz: +estimateFreq(r.audio).toFixed(2),
    complete: r.written === r.expected,
  }
}

// --- 3. determinism ------------------------------------------------------
const a = process(input, { pitchSemitones: 2, speed: 0.9 }).audio
const b = process(input, { pitchSemitones: 2, speed: 0.9 }).audio
const identical = a.length === b.length && Buffer.compare(Buffer.from(a.buffer), Buffer.from(b.buffer)) === 0
results.deterministic = identical

// --- 4. the tail actually carries signal, not silence --------------------
const tail = up2.audio.slice(-SR * 0.15)
let tailRms = 0
for (const s of tail) tailRms += s * s
tailRms = Math.sqrt(tailRms / tail.length)
results.tailRms = +tailRms.toFixed(4)

console.log(JSON.stringify(results, null, 2))

assert.ok(pitchErr < 0.01, `pitch off by ${(pitchErr * 100).toFixed(2)}%`)
assert.ok(up2.written === up2.expected, `pitch shift short by ${up2.expected - up2.written} frames`)
for (const speed of [1.5, 0.85]) {
  const r = results[`speed${speed}`]
  assert.ok(Math.abs(r.ratio - speed) < 0.01, `speed ${speed} produced ratio ${r.ratio}`)
  assert.ok(Math.abs(r.pitchHz - FREQ) / FREQ < 0.01, `speed ${speed} altered pitch to ${r.pitchHz} Hz`)
  assert.ok(r.complete, `speed ${speed} output incomplete`)
}
assert.ok(identical, 'non-deterministic output: export parity cannot be guaranteed')
assert.ok(tailRms > 0.3, `tail is near-silent (rms ${tailRms}) -- flush padding did not recover it`)

console.log('\nSPIKE PASS -- accurate, duration-exact, deterministic, tail recovered.')
console.log('Decision: SoundTouchJS. stretchOffline MUST pad by', FLUSH_PAD_SEC, 's and trim to exact length.')
