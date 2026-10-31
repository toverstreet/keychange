import { describe, it, expect } from 'vitest'
import {
  MIN_REGION_SEC,
  formatTimeExact,
  isDrag,
  nextSnapMode,
  normalizeRegion,
  parseTime,
  regionFromDrag,
  snapWithMode,
} from '../lib/audio/selection'

const grid = [0, 0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0]

describe('snapWithMode', () => {
  it('snaps to beats, bars, or not at all', () => {
    expect(snapWithMode(1.12, 'beats', grid, 4)).toBe(1.0)
    expect(snapWithMode(1.12, 'bars', grid, 4)).toBe(2.0)
    expect(snapWithMode(1.12, 'off', grid, 4)).toBe(1.12)
  })

  it('leaves a time untouched with no grid, whatever the mode', () => {
    expect(snapWithMode(1.12, 'bars', [], 4)).toBe(1.12)
    expect(snapWithMode(1.12, 'beats', [0], 4)).toBe(1.12)
  })
})

describe('nextSnapMode', () => {
  it('cycles bars -> beats -> off -> bars', () => {
    expect(nextSnapMode('bars')).toBe('beats')
    expect(nextSnapMode('beats')).toBe('off')
    expect(nextSnapMode('off')).toBe('bars')
  })
})

describe('normalizeRegion', () => {
  it('orders the ends, so a backwards drag still selects', () => {
    expect(normalizeRegion(9, 4, 60)).toEqual({ a: 4, b: 9 })
  })

  it('clamps to the material', () => {
    expect(normalizeRegion(-3, 120, 60)).toEqual({ a: 0, b: 60 })
  })

  it('enforces a minimum length rather than returning a dead region', () => {
    const r = normalizeRegion(10, 10, 60)
    expect(r).not.toBeNull()
    expect(r!.b - r!.a).toBeCloseTo(MIN_REGION_SEC, 6)
    expect(r!.a).toBe(10)
  })

  it('grows backwards when the minimum will not fit at the end', () => {
    const r = normalizeRegion(60, 60, 60)
    expect(r!.b).toBe(60)
    expect(r!.b - r!.a).toBeCloseTo(MIN_REGION_SEC, 6)
  })

  it('returns null when there is no material to select', () => {
    expect(normalizeRegion(0, 1, 0)).toBeNull()
  })

  it('keeps a long region intact -- there is no upper bound on a selection', () => {
    // The point of the feature: any length, from a few milliseconds to the
    // whole track. Nothing here may cap it.
    expect(normalizeRegion(0.5, 3599.5, 3600)).toEqual({ a: 0.5, b: 3599.5 })
  })
})

describe('regionFromDrag', () => {
  it('snaps both ends by the active mode', () => {
    expect(regionFromDrag(1.12, 3.6, 60, { mode: 'bars', grid, beatsPerBar: 4 })).toEqual({ a: 2.0, b: 4.0 })
    expect(regionFromDrag(1.12, 2.9, 60, { mode: 'beats', grid, beatsPerBar: 4 })).toEqual({ a: 1.0, b: 3.0 })
  })

  it('keeps the exact times with snapping off', () => {
    expect(regionFromDrag(1.12, 2.9, 60, { mode: 'off', grid, beatsPerBar: 4 })).toEqual({ a: 1.12, b: 2.9 })
  })

  it('still produces a usable region when snapping collapses both ends', () => {
    // Both ends land on the same bar line. Snapping must not hand the engine a
    // zero-length loop.
    const r = regionFromDrag(1.9, 2.1, 60, { mode: 'bars', grid, beatsPerBar: 4 })
    expect(r!.b - r!.a).toBeCloseTo(MIN_REGION_SEC, 6)
  })
})

describe('isDrag', () => {
  it('treats a few pixels of movement as a click, not a selection', () => {
    // A plain press still seeks. Without a threshold every scrub would leave a
    // tiny loop behind.
    expect(isDrag(0)).toBe(false)
    expect(isDrag(3)).toBe(false)
    expect(isDrag(-3)).toBe(false)
    expect(isDrag(5)).toBe(true)
    expect(isDrag(-40)).toBe(true)
  })
})

describe('parseTime', () => {
  it('reads plain seconds', () => {
    expect(parseTime('83')).toBe(83)
    expect(parseTime('83.45')).toBeCloseTo(83.45, 6)
    expect(parseTime('  12.5  ')).toBeCloseTo(12.5, 6)
  })

  it('reads m:ss and h:mm:ss', () => {
    expect(parseTime('1:23')).toBe(83)
    expect(parseTime('1:23.45')).toBeCloseTo(83.45, 6)
    expect(parseTime('1:02:03.5')).toBeCloseTo(3723.5, 6)
  })

  it('rejects what it cannot read', () => {
    expect(parseTime('')).toBeNull()
    expect(parseTime('abc')).toBeNull()
    expect(parseTime('-4')).toBeNull()
    expect(parseTime('1:75')).toBeNull()
    expect(parseTime('1:2:3:4')).toBeNull()
  })

  it('round-trips with formatTimeExact', () => {
    for (const sec of [0, 0.02, 7.5, 83.45, 3723.5]) {
      expect(parseTime(formatTimeExact(sec))).toBeCloseTo(sec, 3)
    }
  })
})

describe('formatTimeExact', () => {
  it('shows milliseconds, because nudging a boundary by 50 ms is the point', () => {
    expect(formatTimeExact(83.45)).toBe('1:23.450')
    expect(formatTimeExact(7)).toBe('0:07.000')
    expect(formatTimeExact(3723.5)).toBe('1:02:03.500')
  })

  it('does not print a negative or non-finite time', () => {
    expect(formatTimeExact(-1)).toBe('0:00.000')
    expect(formatTimeExact(NaN)).toBe('0:00.000')
  })
})
