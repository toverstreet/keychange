import { describe, it, expect } from 'vitest'
import { DEFAULT_PARAMS, STYLE_PRESETS, TONE_PRESETS, type Params } from '@keychange/contract'
import { decodeParams, encodeParams, paramsFromHash, shareUrl } from '../lib/share'

const sets: Record<string, Params> = {
  default: DEFAULT_PARAMS,
  extreme: { pitchSemitones: -12, speed: 0.5, reverbMix: 1, eqGainsDb: new Array(10).fill(-12), eightD: true, loop: { a: 1.5, b: 92.25 } },
  preset: { ...DEFAULT_PARAMS, ...STYLE_PRESETS.garage, eqGainsDb: TONE_PRESETS.bass } as Params,
  typical: { pitchSemitones: -2, speed: 0.85, reverbMix: 0.3, eqGainsDb: TONE_PRESETS.vocals, eightD: false, loop: { a: 12.345, b: 20.5 } },
}

describe('params round-trip', () => {
  for (const [name, params] of Object.entries(sets)) {
    it(`survives a round trip: ${name}`, () => {
      expect(decodeParams(encodeParams(params))).toEqual(params)
    })
  }
})

describe('decodeParams rejects bad input', () => {
  it('returns null for garbage', () => {
    expect(decodeParams('garbage!!!')).toBeNull()
  })

  it('returns null for valid base64 that is not JSON', () => {
    expect(decodeParams(btoa('not json at all'))).toBeNull()
  })

  it('returns null when the EQ array is the wrong length', () => {
    // A short array would silently desynchronise every band from its frequency.
    const bad = btoa(JSON.stringify({ p: 0, s: 1, r: 0, e: [0, 0, 0], d: 0, l: null }))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
    expect(decodeParams(bad)).toBeNull()
  })

  it('returns null for an empty string', () => {
    expect(decodeParams('')).toBeNull()
  })
})

describe('clamping', () => {
  it('clamps out-of-range values rather than trusting the URL', () => {
    const wild = btoa(JSON.stringify({ p: 99, s: 99, r: 99, e: new Array(10).fill(99), d: 1, l: null }))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
    const out = decodeParams(wild)
    expect(out).not.toBeNull()
    expect(out!.pitchSemitones).toBe(12)
    expect(out!.speed).toBe(1.5)
    expect(out!.reverbMix).toBe(1)
    expect(out!.eqGainsDb.every((g) => g === 12)).toBe(true)
  })

  it('orders a reversed loop', () => {
    const rev = btoa(JSON.stringify({ p: 0, s: 1, r: 0, e: new Array(10).fill(0), d: 0, l: [9, 3] }))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
    expect(decodeParams(rev)!.loop).toEqual({ a: 3, b: 9 })
  })
})

describe('shareUrl / paramsFromHash', () => {
  it('round-trips through a hash', () => {
    const url = shareUrl(sets.typical, 'https://example.test/')
    expect(paramsFromHash(new URL(url).hash)).toEqual(sets.typical)
  })

  it('returns null when the hash carries no settings', () => {
    expect(paramsFromHash('#other=1')).toBeNull()
    expect(paramsFromHash('')).toBeNull()
  })
})
