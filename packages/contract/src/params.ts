/**
 * Parameter state for the audio engine.
 *
 * This is deliberately a plain, serialisable object with no methods and no
 * references to Web Audio types. Three things depend on that:
 *   - the live engine and the offline export build their graphs from the same
 *     value, which is how export parity is possible at all;
 *   - presets are just literals;
 *   - shareable links are just this object, encoded.
 */
export type Params = {
  /** -12..+12, independent of `speed`. */
  pitchSemitones: number
  /** 0.5..1.5 playback rate, independent of `pitchSemitones`. */
  speed: number
  /** 0 = fully dry, 1 = fully wet. */
  reverbMix: number
  /** One gain in dB per entry of `EQ_BANDS`, same order. */
  eqGainsDb: number[]
  /** Slow rotational panning. */
  eightD: boolean
  /** A/B loop region in seconds of source time, or null for no loop. */
  loop: { a: number; b: number } | null
}

/** Centre frequencies of the 10-band EQ, in Hz. */
export const EQ_BANDS = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000] as const

export const EQ_BAND_COUNT = EQ_BANDS.length

export const PARAM_RANGES = {
  pitchSemitones: { min: -12, max: 12, step: 1 },
  speed: { min: 0.5, max: 1.5, step: 0.01 },
  reverbMix: { min: 0, max: 1, step: 0.01 },
  eqGainDb: { min: -12, max: 12, step: 0.5 },
} as const

export const DEFAULT_PARAMS: Params = {
  pitchSemitones: 0,
  speed: 1,
  reverbMix: 0,
  eqGainsDb: new Array(EQ_BAND_COUNT).fill(0),
  eightD: false,
  loop: null,
}

/** Tone curves, one gain per EQ band. Mirrors keypitch.app's preset set. */
export const TONE_PRESETS: Record<string, number[]> = {
  //          31   62  125  250  500   1k   2k   4k   8k  16k
  flat:      [  0,   0,   0,   0,   0,   0,   0,   0,   0,   0],
  bass:      [  8,   7,   5,   2,   0,   0,   0,   0,   0,   0],
  vocals:    [ -4,  -3,  -1,   1,   3,   4,   3,   1,   0,  -1],
  treble:    [  0,   0,   0,   0,   0,   1,   3,   5,   7,   8],
  warm:      [  4,   3,   2,   1,   0,  -1,  -2,  -2,  -1,   0],
  bright:    [ -2,  -1,   0,   0,   1,   2,   3,   4,   5,   5],
  loudness:  [  6,   5,   3,   0,  -2,  -2,   0,   3,   5,   6],
}

/** One-click styles. Each is a partial overlay onto the current params. */
export const STYLE_PRESETS: Record<string, Partial<Params>> = {
  slowReverb: { speed: 0.85, reverbMix: 0.45, pitchSemitones: 0 },
  speedUp: { speed: 1.25, reverbMix: 0, pitchSemitones: 0 },
  // A copy, not a reference: sharing the array would let one in-place write
  // corrupt both presets globally.
  garage: { speed: 0.92, reverbMix: 0.3, pitchSemitones: 0, eqGainsDb: [...TONE_PRESETS.bass] },
}

export const STYLE_PRESET_LABELS: Record<keyof typeof STYLE_PRESETS & string, string> = {
  slowReverb: 'Slow + Reverb',
  speedUp: 'Speed Up',
  garage: 'Garage',
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v))
}

/** Clamp a params object into valid ranges. Used when restoring a shared link,
 *  where the values arrive from outside and cannot be trusted. */
export function clampParams(p: Params): Params {
  const r = PARAM_RANGES
  return {
    pitchSemitones: clamp(p.pitchSemitones, r.pitchSemitones.min, r.pitchSemitones.max),
    speed: clamp(p.speed, r.speed.min, r.speed.max),
    reverbMix: clamp(p.reverbMix, r.reverbMix.min, r.reverbMix.max),
    eqGainsDb: p.eqGainsDb.map((g) => clamp(g, r.eqGainDb.min, r.eqGainDb.max)),
    eightD: p.eightD,
    loop: p.loop ? { a: Math.max(0, Math.min(p.loop.a, p.loop.b)), b: Math.max(p.loop.a, p.loop.b) } : null,
  }
}
