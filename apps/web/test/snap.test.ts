import { describe, it, expect } from 'vitest'
import { snapToGrid, nearestBarIndex, barLines } from '../lib/audio/snap'

const grid = [0, 0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0]

describe('snapToGrid', () => {
  it('snaps to the nearest beat', () => {
    expect(snapToGrid(1.12, grid)).toBe(1.0)
    expect(snapToGrid(1.4, grid)).toBe(1.5)
  })

  it('snaps exactly on a beat to itself', () => {
    expect(snapToGrid(1.5, grid)).toBe(1.5)
  })

  it('clamps below the first and above the last beat', () => {
    expect(snapToGrid(-5, grid)).toBe(0)
    expect(snapToGrid(99, grid)).toBe(4.0)
  })

  it('snaps to bar lines when asked, not just beats', () => {
    // 4/4: bars start at indices 0, 4, 8 -> 0, 2.0, 4.0 seconds.
    // Nearest bar, not the bar containing the time -- consistent with how beat
    // snapping behaves, so a handle does not jump backwards past the beat the
    // user is clearly aiming at.
    expect(snapToGrid(0.4, grid, { bars: true, beatsPerBar: 4 })).toBe(0)
    expect(snapToGrid(1.12, grid, { bars: true, beatsPerBar: 4 })).toBe(2.0)
    expect(snapToGrid(1.9, grid, { bars: true, beatsPerBar: 4 })).toBe(2.0)
    expect(snapToGrid(3.6, grid, { bars: true, beatsPerBar: 4 })).toBe(4.0)
  })

  it('honours a different time signature', () => {
    // 3/4: bars at indices 0, 3, 6 -> 0, 1.5, 3.0 seconds.
    expect(snapToGrid(1.4, grid, { bars: true, beatsPerBar: 3 })).toBe(1.5)
    expect(snapToGrid(2.9, grid, { bars: true, beatsPerBar: 3 })).toBe(3.0)
  })

  it('returns the input unchanged when there is no grid', () => {
    // Analysis may be unavailable (worker down); snapping must degrade to a
    // no-op rather than collapsing every drag to zero.
    expect(snapToGrid(1.234, [])).toBe(1.234)
    expect(snapToGrid(1.234, [2.0])).toBe(1.234)
  })
})

describe('barLines', () => {
  it('returns every fourth beat by default', () => {
    expect(barLines(grid, 4)).toEqual([0, 2.0, 4.0])
  })

  it('is empty for an empty grid', () => {
    expect(barLines([], 4)).toEqual([])
  })
})

describe('nearestBarIndex', () => {
  it('finds the bar containing a time', () => {
    expect(nearestBarIndex(2.1, grid, 4)).toBe(1)
    expect(nearestBarIndex(0.1, grid, 4)).toBe(0)
  })
})
