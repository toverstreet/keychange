import { describe, it, expect } from 'vitest'
import { computePeaks, PEAK_BUCKETS } from '../lib/audio/peaks'
import { makeBuffer } from './helpers/fake-buffer'

describe('computePeaks', () => {
  it('returns two values per bucket, min before max', () => {
    const buf = makeBuffer({ length: 1000, channels: 1, fill: (i) => Math.sin(i / 10) })
    const peaks = computePeaks(buf, 50)
    expect(peaks).toHaveLength(100)
    for (let b = 0; b < 50; b++) {
      expect(peaks[b * 2]).toBeLessThanOrEqual(peaks[b * 2 + 1])
    }
  })

  it('preserves the global extremes', () => {
    const buf = makeBuffer({ length: 1000, channels: 1, fill: (i) => (i === 500 ? 1 : i === 700 ? -1 : 0) })
    const peaks = computePeaks(buf, 50)
    expect(Math.max(...peaks)).toBeCloseTo(1, 5)
    expect(Math.min(...peaks)).toBeCloseTo(-1, 5)
  })

  it('reduces across channels so a stereo file shows the true envelope', () => {
    // Left peaks positive, right peaks negative. A per-channel-only reading
    // would miss one side of the envelope.
    const buf = makeBuffer({
      length: 100, channels: 2,
      fill: (i, ch) => (ch === 0 ? (i === 50 ? 0.9 : 0) : i === 50 ? -0.8 : 0),
    })
    const peaks = computePeaks(buf, 10)
    expect(Math.max(...peaks)).toBeCloseTo(0.9, 5)
    expect(Math.min(...peaks)).toBeCloseTo(-0.8, 5)
  })

  it('handles a buffer shorter than the bucket count without producing NaN', () => {
    const buf = makeBuffer({ length: 5, channels: 1, fill: () => 0.5 })
    const peaks = computePeaks(buf, 100)
    expect(peaks).toHaveLength(200)
    expect(peaks.every((v) => Number.isFinite(v))).toBe(true)
  })

  it('is a flat line for silence', () => {
    const buf = makeBuffer({ length: 1000, channels: 1, fill: () => 0 })
    expect(Array.from(computePeaks(buf, 20)).every((v) => v === 0)).toBe(true)
  })

  it('exposes a sensible default bucket count', () => {
    expect(PEAK_BUCKETS).toBeGreaterThan(200)
  })
})

describe('computePeaks over a range', () => {
  const SR = 48000

  it('reads only the requested window', () => {
    // A spike at 1.5 s must be visible when that second is in range and absent
    // when it is not -- this is the whole basis of zooming showing new detail.
    const buf = makeBuffer({
      length: SR * 3,
      channels: 1,
      sampleRate: SR,
      fill: (i) => (i === Math.floor(SR * 1.5) ? 1 : 0),
    })
    const inRange = computePeaks(buf, 50, 1.0, 2.0)
    const outOfRange = computePeaks(buf, 50, 2.0, 3.0)
    expect(Math.max(...inRange)).toBeCloseTo(1, 5)
    expect(Math.max(...outOfRange)).toBe(0)
  })

  it('resolves detail a full-track view would average away', () => {
    // Two spikes 10 ms apart. Across the whole 3 s at 50 buckets they land in
    // one bucket; across a 100 ms window they are clearly separate.
    const a = Math.floor(SR * 1.5)
    const b = a + Math.floor(SR * 0.01)
    const buf = makeBuffer({
      length: SR * 3,
      channels: 1,
      sampleRate: SR,
      fill: (i) => (i === a || i === b ? 1 : 0),
    })
    const occupied = (peaks: Float32Array) => {
      let n = 0
      for (let i = 0; i < peaks.length / 2; i++) if (peaks[i * 2 + 1] > 0.5) n++
      return n
    }
    expect(occupied(computePeaks(buf, 50))).toBe(1)
    expect(occupied(computePeaks(buf, 50, 1.45, 1.55))).toBe(2)
  })

  it('defaults to the whole buffer', () => {
    const buf = makeBuffer({ length: 1000, channels: 1, sampleRate: SR, fill: (i) => Math.sin(i / 10) })
    expect(Array.from(computePeaks(buf, 20))).toEqual(Array.from(computePeaks(buf, 20, 0)))
  })

  it('clamps a range that runs past the end', () => {
    const buf = makeBuffer({ length: SR, channels: 1, sampleRate: SR, fill: () => 0.5 })
    const peaks = computePeaks(buf, 20, 0.5, 99)
    expect(peaks.every((v) => Number.isFinite(v))).toBe(true)
    expect(Math.max(...peaks)).toBeCloseTo(0.5, 5)
  })
})
