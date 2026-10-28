import { describe, it, expect } from 'vitest'
import { stretchChannels, stretchedLength, FLUSH_PAD_SEC } from '../lib/audio/stretch'
import { dominantFreq, rms, sine } from './helpers/dsp'

const SR = 48000

describe('stretchChannels', () => {
  it('shifts pitch by the requested semitones', () => {
    const [out] = stretchChannels([sine(440, 2, SR)], SR, { pitchSemitones: 2, speed: 1 })
    expect(dominantFreq(out, SR)).toBeCloseTo(493.88, 0)
  })

  it('shifts pitch down as well as up', () => {
    const [out] = stretchChannels([sine(440, 2, SR)], SR, { pitchSemitones: -2, speed: 1 })
    expect(dominantFreq(out, SR)).toBeCloseTo(391.995, 0)
  })

  it('leaves duration untouched when only pitch changes', () => {
    const input = sine(440, 2, SR)
    const [out] = stretchChannels([input], SR, { pitchSemitones: 2, speed: 1 })
    expect(out.length).toBe(input.length)
  })

  it('scales duration by speed and leaves pitch alone', () => {
    const input = sine(440, 2, SR)
    const [out] = stretchChannels([input], SR, { pitchSemitones: 0, speed: 1.5 })
    expect(out.length).toBe(Math.round(input.length / 1.5))
    expect(dominantFreq(out, SR)).toBeCloseTo(440, 0)
  })

  it('slows down as well as speeds up', () => {
    const input = sine(440, 2, SR)
    const [out] = stretchChannels([input], SR, { pitchSemitones: 0, speed: 0.85 })
    expect(out.length).toBe(Math.round(input.length / 0.85))
    expect(dominantFreq(out, SR)).toBeCloseTo(440, 0)
  })

  it('combines pitch and speed independently', () => {
    const input = sine(440, 2, SR)
    const [out] = stretchChannels([input], SR, { pitchSemitones: 2, speed: 0.85 })
    expect(out.length).toBe(Math.round(input.length / 0.85))
    expect(dominantFreq(out, SR)).toBeCloseTo(493.88, 0)
  })

  it('fills the final frames with real signal rather than truncating the tail', () => {
    // SoundTouchJS strands 170-500 ms in its internal FIFO when the source runs
    // dry. Without flush padding this silently clips the end of every export,
    // which no listening check would catch. See spike/README.md.
    const input = sine(440, 4, SR)
    const [out] = stretchChannels([input], SR, { pitchSemitones: 2, speed: 1 })
    const lastQuarterSecond = out.subarray(out.length - SR * 0.25)
    expect(rms(lastQuarterSecond)).toBeGreaterThan(0.3)
  })

  it('is a pass-through at neutral settings', () => {
    const input = sine(440, 1, SR)
    const [out] = stretchChannels([input], SR, { pitchSemitones: 0, speed: 1 })
    expect(out.length).toBe(input.length)
    expect(dominantFreq(out, SR)).toBeCloseTo(440, 0)
  })

  it('preserves channel count and keeps channels aligned', () => {
    const left = sine(440, 1, SR)
    const right = sine(880, 1, SR)
    const out = stretchChannels([left, right], SR, { pitchSemitones: 0, speed: 1.25 })
    expect(out).toHaveLength(2)
    expect(out[0].length).toBe(out[1].length)
    expect(dominantFreq(out[0], SR)).toBeCloseTo(440, 0)
    expect(dominantFreq(out[1], SR)).toBeCloseTo(880, 0)
  })

  it('keeps mono as mono', () => {
    const out = stretchChannels([sine(440, 1, SR)], SR, { pitchSemitones: 2, speed: 1 })
    expect(out).toHaveLength(1)
    expect(dominantFreq(out[0], SR)).toBeCloseTo(493.88, 0)
  })

  it('processes more than two channels instead of silently emptying the extras', () => {
    // Handling only the first pair would export a surround file whose later
    // channels are present in the header but silent -- broken in a way that
    // looks fine until it is played on a rig that uses them.
    const freqs = [220, 330, 440, 550, 660, 770]
    const input = freqs.map((f) => sine(f, 1, SR))
    const out = stretchChannels(input, SR, { pitchSemitones: 0, speed: 1.25 })

    expect(out).toHaveLength(6)
    for (let ch = 0; ch < 6; ch++) {
      expect(out[ch].length, `channel ${ch} length`).toBe(out[0].length)
      expect(rms(out[ch]), `channel ${ch} is not silent`).toBeGreaterThan(0.3)
      expect(dominantFreq(out[ch], SR), `channel ${ch} frequency`).toBeCloseTo(freqs[ch], 0)
    }
  })

  it('handles an odd channel count, where the last channel has no partner', () => {
    const input = [sine(220, 1, SR), sine(440, 1, SR), sine(660, 1, SR)]
    const out = stretchChannels(input, SR, { pitchSemitones: 0, speed: 0.9 })
    expect(out).toHaveLength(3)
    expect(rms(out[2])).toBeGreaterThan(0.3)
    expect(dominantFreq(out[2], SR)).toBeCloseTo(660, 0)
  })

  it('is deterministic, which is what makes export parity provable', () => {
    const input = sine(440, 1, SR)
    const a = stretchChannels([input], SR, { pitchSemitones: 3, speed: 0.9 })[0]
    const b = stretchChannels([input], SR, { pitchSemitones: 3, speed: 0.9 })[0]
    expect(Array.from(a)).toEqual(Array.from(b))
  })

  it('reports progress monotonically from 0 to 1', () => {
    const seen: number[] = []
    stretchChannels([sine(440, 2, SR)], SR, { pitchSemitones: 1, speed: 1 }, (p) => seen.push(p))
    expect(seen.length).toBeGreaterThan(1)
    expect(seen[seen.length - 1]).toBeCloseTo(1, 5)
    for (let i = 1; i < seen.length; i++) expect(seen[i]).toBeGreaterThanOrEqual(seen[i - 1])
  })

  it('handles an empty input without throwing', () => {
    const out = stretchChannels([new Float32Array(0)], SR, { pitchSemitones: 2, speed: 1 })
    expect(out[0].length).toBe(0)
  })
})

describe('stretchedLength', () => {
  it('matches what stretchChannels produces', () => {
    for (const speed of [0.5, 0.85, 1, 1.25, 1.5]) {
      const input = sine(440, 1, SR)
      const expected = stretchedLength(input.length, speed)
      const [out] = stretchChannels([input], SR, { pitchSemitones: 0, speed })
      expect(out.length).toBe(expected)
    }
  })
})

describe('FLUSH_PAD_SEC', () => {
  it('exceeds the worst observed pipeline latency of ~0.5 s', () => {
    expect(FLUSH_PAD_SEC).toBeGreaterThan(0.5)
  })
})
