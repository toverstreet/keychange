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
