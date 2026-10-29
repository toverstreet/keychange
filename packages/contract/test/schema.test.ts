import { describe, it, expect } from 'vitest'
import {
  analysisResultSchema,
  separationJobSchema,
  DEFAULT_PARAMS,
  EQ_BANDS,
  TONE_PRESETS,
  STYLE_PRESETS,
} from '../src/index'

const valid = {
  key: 'G', scale: 'major' as const, keyConfidence: 0.71,
  bpm: 135, bpmConfidence: 0.9, beatGrid: [0.41, 0.85],
  pitchHz: 440, durationSec: 509.3, sampleRate: 48000,
}

describe('analysisResultSchema', () => {
  it('accepts a well-formed result', () => {
    expect(analysisResultSchema.parse(valid)).toEqual(valid)
  })

  it('rejects a confidence outside 0..1', () => {
    expect(() => analysisResultSchema.parse({ ...valid, keyConfidence: 1.5 })).toThrow()
  })

  it('rejects a missing beat grid, since loop snapping depends on it', () => {
    const { beatGrid, ...withoutGrid } = valid
    expect(() => analysisResultSchema.parse(withoutGrid)).toThrow()
  })

  it('rejects a scale outside major/minor', () => {
    expect(() => analysisResultSchema.parse({ ...valid, scale: 'dorian' })).toThrow()
  })
})

describe('separationJobSchema', () => {
  it('accepts a running job with no stems yet', () => {
    const job = { id: 'abc', status: 'running' as const, progress: 0.4, error: null, stems: null }
    expect(separationJobSchema.parse(job)).toEqual(job)
  })

  it('rejects an unknown status', () => {
    expect(() =>
      separationJobSchema.parse({ id: 'a', status: 'frobnicating', progress: 0, error: null, stems: null }),
    ).toThrow()
  })
})

describe('params', () => {
  it('has one EQ gain per band', () => {
    expect(DEFAULT_PARAMS.eqGainsDb).toHaveLength(EQ_BANDS.length)
    expect(EQ_BANDS).toHaveLength(10)
  })

  it('defaults to a neutral, unmodified signal', () => {
    expect(DEFAULT_PARAMS.pitchSemitones).toBe(0)
    expect(DEFAULT_PARAMS.speed).toBe(1)
    expect(DEFAULT_PARAMS.reverbMix).toBe(0)
    expect(DEFAULT_PARAMS.eqGainsDb.every((g) => g === 0)).toBe(true)
    expect(DEFAULT_PARAMS.eightD).toBe(false)
    expect(DEFAULT_PARAMS.loop).toBeNull()
  })

  it('gives every tone preset exactly one gain per band', () => {
    for (const [name, gains] of Object.entries(TONE_PRESETS)) {
      expect(gains, name).toHaveLength(EQ_BANDS.length)
    }
  })

  it('defines the three keychange style presets', () => {
    expect(Object.keys(STYLE_PRESETS).sort()).toEqual(['garage', 'slowReverb', 'speedUp'])
    expect(STYLE_PRESETS.speedUp.speed).toBeGreaterThan(1)
    expect(STYLE_PRESETS.slowReverb.speed).toBeLessThan(1)
    expect(STYLE_PRESETS.slowReverb.reverbMix).toBeGreaterThan(0)
  })
})
