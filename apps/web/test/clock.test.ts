import { describe, it, expect } from 'vitest'
import { reanchorForSpeedChange, sourcePositionAt, stretchedOffset, type Anchor } from '../lib/audio/clock'

const DURATION = 509.333

describe('sourcePositionAt', () => {
  it('advances in real time at speed 1', () => {
    const a: Anchor = { sourceSec: 10, ctxTime: 100, speed: 1 }
    expect(sourcePositionAt(a, 105, DURATION)).toBeCloseTo(15, 6)
  })

  it('advances in source time faster than context time when slowed down', () => {
    // At 0.5x, 5 s of listening covers 2.5 s of the source.
    const a: Anchor = { sourceSec: 10, ctxTime: 100, speed: 0.5 }
    expect(sourcePositionAt(a, 105, DURATION)).toBeCloseTo(12.5, 6)
  })

  it('advances faster than context time when sped up', () => {
    const a: Anchor = { sourceSec: 0, ctxTime: 0, speed: 1.5 }
    expect(sourcePositionAt(a, 10, DURATION)).toBeCloseTo(15, 6)
  })

  it('clamps to the material', () => {
    const a: Anchor = { sourceSec: 0, ctxTime: 0, speed: 1 }
    expect(sourcePositionAt(a, 99999, DURATION)).toBe(DURATION)
    expect(sourcePositionAt(a, -50, DURATION)).toBe(0)
  })
})

describe('reanchorForSpeedChange', () => {
  it('does not move the position when the speed changes', () => {
    // The regression this exists for: playing at 1.0 from source 10 s, five
    // seconds in, the user drags speed to 0.5. Without re-anchoring the
    // position is recomputed as 10 + 5*0.5 = 12.5 while the audio is genuinely
    // at 15 -- the playhead snaps back 2.5 s and playback restarts there.
    const before: Anchor = { sourceSec: 10, ctxTime: 100, speed: 1 }
    const positionAtChange = sourcePositionAt(before, 105, DURATION)
    expect(positionAtChange).toBeCloseTo(15, 6)

    const after = reanchorForSpeedChange(before, 105, 0.5, DURATION)
    expect(sourcePositionAt(after, 105, DURATION)).toBeCloseTo(positionAtChange, 6)
    expect(after.speed).toBe(0.5)
  })

  it('continues correctly at the new speed after re-anchoring', () => {
    const before: Anchor = { sourceSec: 10, ctxTime: 100, speed: 1 }
    const after = reanchorForSpeedChange(before, 105, 0.5, DURATION)
    // Two more seconds of listening at 0.5x covers one more second of source.
    expect(sourcePositionAt(after, 107, DURATION)).toBeCloseTo(16, 6)
  })

  it('holds position across a sequence of changes, as a slider drag produces', () => {
    // A drag emits many speed changes. Each must preserve the position, or the
    // error accumulates over the whole drag rather than over one debounce.
    let anchor: Anchor = { sourceSec: 30, ctxTime: 0, speed: 1 }
    let now = 0
    for (const [dt, speed] of [[1, 0.95], [1, 0.9], [1, 0.85], [1, 0.8]] as const) {
      now += dt
      const positionBefore = sourcePositionAt(anchor, now, DURATION)
      anchor = reanchorForSpeedChange(anchor, now, speed, DURATION)
      expect(sourcePositionAt(anchor, now, DURATION)).toBeCloseTo(positionBefore, 9)
    }
    // Four seconds of listening at descending speeds covers less than four
    // seconds of source, and strictly more than the slowest rate would give.
    const final = sourcePositionAt(anchor, now, DURATION)
    expect(final).toBeGreaterThan(30)
    expect(final).toBeLessThan(34)
  })
})

describe('stretchedOffset', () => {
  it('maps source time into the stretched buffer', () => {
    expect(stretchedOffset(60, 1)).toBe(60)
    expect(stretchedOffset(60, 0.5)).toBe(120)
    expect(stretchedOffset(60, 1.5)).toBe(40)
  })

  it('round-trips with the position maths', () => {
    const speed = 0.85
    const anchor: Anchor = { sourceSec: 0, ctxTime: 0, speed }
    const offset = stretchedOffset(100, speed)
    expect(sourcePositionAt(anchor, offset, DURATION)).toBeCloseTo(100, 6)
  })
})
