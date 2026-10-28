import { describe, it, expect } from 'vitest'
import { DEFAULT_PARAMS, EQ_BANDS, TONE_PRESETS, type Params } from '@keypitch/contract'
import { buildEffectChain } from '../lib/audio/effect-chain'
import { generateImpulse } from '../lib/audio/impulse'
import { makeOfflineContext, bufferFrom, SR } from './helpers/offline'
import { bandLevelDb, rms, sine, whiteNoise } from './helpers/dsp'

/** Render a signal through the effect chain alone. */
async function renderChain(input: Float32Array[], params: Params, seconds: number) {
  const ctx = makeOfflineContext(2, seconds)
  const src = ctx.createBufferSource()
  src.buffer = bufferFrom(ctx, input.length === 1 ? [input[0], input[0]] : input)
  const chain = buildEffectChain(ctx, params, { durationSec: seconds, startTime: 0 })
  src.connect(chain.input)
  chain.output.connect(ctx.destination)
  src.start(0)
  const rendered = await ctx.startRendering()
  return rendered
}

const p = (over: Partial<Params>): Params => ({ ...DEFAULT_PARAMS, ...over })

describe('EQ', () => {
  it('boosting one band raises that band and leaves distant bands alone', async () => {
    const noise = whiteNoise(1, SR)
    const gains = new Array(10).fill(0)
    gains[EQ_BANDS.indexOf(1000)] = 12

    const flat = await renderChain([noise], p({}), 1)
    const boosted = await renderChain([noise], p({ eqGainsDb: gains }), 1)

    const at1k = bandLevelDb(boosted.getChannelData(0), 1000, SR) - bandLevelDb(flat.getChannelData(0), 1000, SR)
    const at125 = bandLevelDb(boosted.getChannelData(0), 125, SR) - bandLevelDb(flat.getChannelData(0), 125, SR)

    expect(at1k).toBeGreaterThan(8)
    expect(Math.abs(at125)).toBeLessThan(2)
  })

  it('cutting a band attenuates it', async () => {
    const noise = whiteNoise(1, SR)
    const gains = new Array(10).fill(0)
    gains[EQ_BANDS.indexOf(2000)] = -12
    const flat = await renderChain([noise], p({}), 1)
    const cut = await renderChain([noise], p({ eqGainsDb: gains }), 1)
    const delta = bandLevelDb(cut.getChannelData(0), 2000, SR) - bandLevelDb(flat.getChannelData(0), 2000, SR)
    expect(delta).toBeLessThan(-8)
  })

  it('a flat EQ is transparent', async () => {
    const tone = sine(440, 0.5, SR)
    const out = await renderChain([tone], p({}), 0.5)
    expect(rms(out.getChannelData(0))).toBeCloseTo(rms(tone), 1)
  })

  it('the bass tone preset lifts low frequencies relative to high', async () => {
    const noise = whiteNoise(1, SR)
    const flat = await renderChain([noise], p({}), 1)
    const bass = await renderChain([noise], p({ eqGainsDb: TONE_PRESETS.bass }), 1)
    const low = bandLevelDb(bass.getChannelData(0), 62, SR) - bandLevelDb(flat.getChannelData(0), 62, SR)
    const high = bandLevelDb(bass.getChannelData(0), 8000, SR) - bandLevelDb(flat.getChannelData(0), 8000, SR)
    expect(low).toBeGreaterThan(high + 4)
  })
})

describe('reverb', () => {
  it('a dry render confines a click to its onset', async () => {
    const click = new Float32Array(SR * 2)
    click[0] = 1
    const out = await renderChain([click], p({ reverbMix: 0 }), 2)
    const tail = out.getChannelData(0).subarray(Math.floor(SR * 0.5))
    expect(rms(tail)).toBeLessThan(1e-4)
  })

  it('a wet render sustains energy well past the onset', async () => {
    const click = new Float32Array(SR * 2)
    click[0] = 1
    const out = await renderChain([click], p({ reverbMix: 0.9 }), 2)
    const tail = out.getChannelData(0).subarray(Math.floor(SR * 0.5))
    expect(rms(tail)).toBeGreaterThan(1e-4)
  })

  it('uses an equal-power crossfade so a mid mix does not dip in level', async () => {
    const noise = whiteNoise(1, SR)
    const dryOut = await renderChain([noise], p({ reverbMix: 0 }), 1)
    const midOut = await renderChain([noise], p({ reverbMix: 0.5 }), 1)
    const ratio = rms(midOut.getChannelData(0)) / rms(dryOut.getChannelData(0))
    // A linear crossfade would land near 0.5 here and sound like a volume drop.
    expect(ratio).toBeGreaterThan(0.6)
  })
})

describe('generateImpulse', () => {
  it('is identical for the same seed, so preview and export match', () => {
    const ctx = makeOfflineContext(2, 0.1)
    const a = generateImpulse(ctx)
    const b = generateImpulse(ctx)
    expect(Array.from(a.getChannelData(0).subarray(0, 1000))).toEqual(
      Array.from(b.getChannelData(0).subarray(0, 1000)),
    )
  })

  it('decays rather than sustaining', () => {
    const ctx = makeOfflineContext(2, 0.1)
    const ir = generateImpulse(ctx)
    const data = ir.getChannelData(0)
    const head = rms(data.subarray(0, 1000))
    const end = rms(data.subarray(data.length - 1000))
    expect(end).toBeLessThan(head * 0.2)
  })
})

describe('8D', () => {
  it('is off by default and leaves the channels identical', async () => {
    const noise = whiteNoise(1, SR)
    const out = await renderChain([noise, noise], p({ eightD: false }), 1)
    expect(rms(out.getChannelData(0))).toBeCloseTo(rms(out.getChannelData(1)), 4)
  })

  it('moves the image between the channels over time', async () => {
    // A full rotation is 10 s at 0.1 Hz, so render long enough to see the
    // balance invert rather than just differ.
    const seconds = 10
    const noise = whiteNoise(seconds, SR)
    const out = await renderChain([noise, noise], p({ eightD: true }), seconds)
    const L = out.getChannelData(0)
    const R = out.getChannelData(1)
    const win = (x: Float32Array, atSec: number) =>
      rms(x.subarray(Math.floor(atSec * SR), Math.floor((atSec + 0.5) * SR)))

    const early = win(L, 2.5) / Math.max(1e-9, win(R, 2.5))
    const late = win(L, 7.5) / Math.max(1e-9, win(R, 7.5))

    // The image must end up on opposite sides at the quarter and three-quarter
    // points of a rotation. Asserted as an inversion rather than a fixed
    // direction, so the test describes the effect rather than the sign of the
    // automation sine.
    expect(Math.min(early, late)).toBeLessThan(0.85)
    expect(Math.max(early, late)).toBeGreaterThan(1.2)
  })
})
