import { describe, it, expect } from 'vitest'
import { formatSpan, formatTime } from '../lib/format'

describe('formatSpan', () => {
  it('shows a short selection as seconds, not as 0:00', () => {
    expect(formatSpan(0.42)).toBe('0.42s')
    expect(formatSpan(9.5)).toBe('9.50s')
  })

  it('falls back to m:ss once there are seconds worth rounding', () => {
    expect(formatSpan(83)).toBe('1:23')
    expect(formatSpan(10)).toBe('0:10')
  })

  it('does not print a negative or non-finite length', () => {
    expect(formatSpan(-1)).toBe('0:00')
    expect(formatSpan(NaN)).toBe('0:00')
  })
})

describe('formatTime', () => {
  it('stays a position formatter', () => {
    expect(formatTime(83)).toBe('1:23')
  })
})
