import { describe, it, expect } from 'vitest'
import { clampView, fitRegion, followPlayhead, MIN_SPAN_SEC, spanOf, zoomAt } from '../lib/audio/viewport'

const DURATION = 509.333
const full = { start: 0, end: DURATION }

describe('clampView', () => {
  it('leaves a valid view alone', () => {
    expect(clampView({ start: 10, end: 20 }, DURATION)).toEqual({ start: 10, end: 20 })
  })

  it('pulls a view back inside the material without shrinking it', () => {
    const v = clampView({ start: -30, end: 20 }, DURATION)
    expect(v.start).toBe(0)
    expect(spanOf(v)).toBeCloseTo(50, 6)
  })

  it('pulls a view back from past the end without shrinking it', () => {
    const v = clampView({ start: DURATION - 10, end: DURATION + 40 }, DURATION)
    expect(v.end).toBeCloseTo(DURATION, 6)
    expect(spanOf(v)).toBeCloseTo(50, 6)
  })

  it('never zooms in past the minimum span', () => {
    const v = clampView({ start: 10, end: 10.0001 }, DURATION)
    expect(spanOf(v)).toBeCloseTo(MIN_SPAN_SEC, 6)
  })

  it('never zooms out past the whole track', () => {
    expect(clampView({ start: -100, end: DURATION + 100 }, DURATION)).toEqual(full)
  })

  it('handles a span wider than the track by showing the track', () => {
    expect(clampView({ start: 0, end: DURATION * 3 }, DURATION)).toEqual(full)
  })
})

describe('zoomAt', () => {
  it('zooming in keeps the anchored time under the cursor', () => {
    const anchor = 120
    const before = { start: 0, end: DURATION }
    const after = zoomAt(before, 0.5, anchor, DURATION)
    const fractionBefore = (anchor - before.start) / spanOf(before)
    const fractionAfter = (anchor - after.start) / spanOf(after)
    expect(fractionAfter).toBeCloseTo(fractionBefore, 6)
    expect(spanOf(after)).toBeCloseTo(spanOf(before) * 0.5, 4)
  })

  it('zooming out widens the view', () => {
    const before = { start: 100, end: 120 }
    const after = zoomAt(before, 2, 110, DURATION)
    expect(spanOf(after)).toBeCloseTo(40, 4)
  })

  it('clamps rather than running off the start', () => {
    const after = zoomAt({ start: 0, end: 20 }, 2, 1, DURATION)
    expect(after.start).toBe(0)
  })

  it('stops at the whole track when zooming out repeatedly', () => {
    let v = { start: 200, end: 210 }
    for (let i = 0; i < 20; i++) v = zoomAt(v, 2, 205, DURATION)
    expect(v).toEqual(full)
  })

  it('stops at the minimum span when zooming in repeatedly', () => {
    let v = { start: 0, end: DURATION }
    for (let i = 0; i < 60; i++) v = zoomAt(v, 0.5, 100, DURATION)
    expect(spanOf(v)).toBeCloseTo(MIN_SPAN_SEC, 6)
  })
})

describe('fitRegion', () => {
  it('frames a loop with a margin on each side', () => {
    const v = fitRegion(100, 108, DURATION)
    expect(v.start).toBeLessThan(100)
    expect(v.end).toBeGreaterThan(108)
    // The loop should occupy most of the view, not a sliver of it.
    expect(8 / spanOf(v)).toBeGreaterThan(0.6)
  })

  it('does not run past the start of the track for a loop at zero', () => {
    const v = fitRegion(0, 8, DURATION)
    expect(v.start).toBe(0)
  })

  it('does not run past the end of the track for a loop at the end', () => {
    const v = fitRegion(DURATION - 8, DURATION, DURATION)
    expect(v.end).toBeCloseTo(DURATION, 6)
  })

  it('respects the minimum span for a very short loop', () => {
    const v = fitRegion(100, 100.05, DURATION)
    expect(spanOf(v)).toBeGreaterThanOrEqual(MIN_SPAN_SEC)
  })
})

describe('followPlayhead', () => {
  it('leaves the view alone while the playhead is comfortably inside it', () => {
    const v = { start: 100, end: 140 }
    expect(followPlayhead(v, 120, DURATION)).toEqual(v)
  })

  it('scrolls forward when the playhead reaches the right edge', () => {
    const v = { start: 100, end: 140 }
    const after = followPlayhead(v, 139, DURATION)
    expect(after.start).toBeGreaterThan(100)
    expect(spanOf(after)).toBeCloseTo(40, 6)
    expect(139).toBeGreaterThanOrEqual(after.start)
    expect(139).toBeLessThanOrEqual(after.end)
  })

  it('scrolls back when the playhead jumps behind the view, as a loop does', () => {
    const v = { start: 100, end: 140 }
    const after = followPlayhead(v, 60, DURATION)
    expect(after.start).toBeLessThan(100)
    expect(60).toBeGreaterThanOrEqual(after.start)
    expect(60).toBeLessThanOrEqual(after.end)
  })

  it('does not scroll when the whole track is already in view', () => {
    expect(followPlayhead(full, 400, DURATION)).toEqual(full)
  })

  it('clamps at the end of the track rather than scrolling past it', () => {
    const v = { start: DURATION - 40, end: DURATION }
    expect(followPlayhead(v, DURATION - 1, DURATION).end).toBeCloseTo(DURATION, 6)
  })
})
