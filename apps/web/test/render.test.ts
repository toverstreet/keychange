import { describe, it, expect } from 'vitest'
import { DEFAULT_PARAMS, TONE_PRESETS, type Params } from '@keychange/contract'
import { OfflineAudioContext } from 'node-web-audio-api'
import { renderToBuffer, exportFilename, sliceChannels, EDGE_FADE_SEC } from '../lib/audio/render'
import { encodeWav } from '../lib/audio/wav'
import { applyParams, buildEffectChain } from '../lib/audio/effect-chain'
import { stretchChannels } from '../lib/audio/stretch'
import { bufferFrom, makeOfflineContext, SR } from './helpers/offline'
import { bandLevelDb, dominantFreq, rms, sine, whiteNoise } from './helpers/dsp'

const factory = (ch: number, frames: number, rate: number) =>
  new OfflineAudioContext(ch, frames, rate) as unknown as OfflineAudioContext

const p = (over: Partial<Params>): Params => ({ ...DEFAULT_PARAMS, ...over })

function sourceBuffer(data: Float32Array[], sampleRate = SR): AudioBuffer {
  const ctx = makeOfflineContext(data.length, 0.1, sampleRate)
  return bufferFrom(ctx, data, sampleRate)
}

describe('renderToBuffer', () => {
  it('preserves the source sample rate rather than resampling to 44.1 kHz', async () => {
    // keypitch.app returned the 48 kHz reference file at 44.1 kHz. Not doing
    // that is a stated promise of this project.
    const src = sourceBuffer([sine(440, 1, SR), sine(440, 1, SR)])
    const out = await renderToBuffer(src, p({ pitchSemitones: 2 }), undefined, factory)
    expect(out.sampleRate).toBe(48000)
  })

  it('preserves the channel count', async () => {
    const src = sourceBuffer([sine(440, 0.5, SR), sine(660, 0.5, SR)])
    const out = await renderToBuffer(src, p({}), undefined, factory)
    expect(out.numberOfChannels).toBe(2)
  })

  it('applies pitch', async () => {
    const src = sourceBuffer([sine(440, 2, SR), sine(440, 2, SR)])
    const out = await renderToBuffer(src, p({ pitchSemitones: 2 }), undefined, factory)
    expect(dominantFreq(out.getChannelData(0), SR)).toBeCloseTo(493.88, 0)
  })

  it('applies speed to duration without touching pitch', async () => {
    const src = sourceBuffer([sine(440, 2, SR), sine(440, 2, SR)])
    const out = await renderToBuffer(src, p({ speed: 1.5 }), undefined, factory)
    expect(out.duration).toBeCloseTo(2 / 1.5, 1)
    expect(dominantFreq(out.getChannelData(0), SR)).toBeCloseTo(440, 0)
  })

  it('applies EQ', async () => {
    const noise = whiteNoise(1, SR)
    const src = sourceBuffer([noise, noise])
    const flat = await renderToBuffer(src, p({}), undefined, factory)
    const bass = await renderToBuffer(src, p({ eqGainsDb: TONE_PRESETS.bass }), undefined, factory)
    const delta = bandLevelDb(bass.getChannelData(0), 62, SR) - bandLevelDb(flat.getChannelData(0), 62, SR)
    expect(delta).toBeGreaterThan(3)
  })

  it('reports progress through both stages, ending at 1', async () => {
    const src = sourceBuffer([sine(440, 1, SR), sine(440, 1, SR)])
    const seen: Array<[number, string]> = []
    await renderToBuffer(src, p({ pitchSemitones: 1 }), (f, s) => seen.push([f, s]), factory)
    expect(seen.some(([, s]) => s === 'stretch')).toBe(true)
    expect(seen.some(([, s]) => s === 'effects')).toBe(true)
    expect(seen[seen.length - 1][0]).toBe(1)
  })

  it('does not truncate the tail of the material', async () => {
    const src = sourceBuffer([sine(440, 4, SR), sine(440, 4, SR)])
    const out = await renderToBuffer(src, p({ pitchSemitones: 2 }), undefined, factory)
    const lastQuarter = out.getChannelData(0).subarray(out.length - Math.floor(SR * 0.25))
    expect(rms(lastQuarter)).toBeGreaterThan(0.3)
  })
})

describe('export parity: the offline render must equal what the live engine plays', () => {
  /**
   * The live engine stretches the source, then plays the stretched buffer
   * through `buildEffectChain` + `applyParams` on its context. This builds the
   * graph the same way the engine does -- including `applyParams`, which the
   * engine uses for every effects change -- and compares band by band against
   * `renderToBuffer`.
   *
   * It is not a perfect stand-in for the engine (that would need a running
   * audio clock), but it exercises the same chain-construction and
   * parameter-application code paths, so a change that makes one diverge from
   * the other fails here rather than shipping as "the download sounds
   * different".
   */
  async function renderAsEngineWould(data: Float32Array[], params: Params): Promise<AudioBuffer> {
    const stretched = stretchChannels(
      data.map((d) => d.slice()),
      SR,
      { pitchSemitones: params.pitchSemitones, speed: params.speed },
    )
    const frames = stretched[0].length
    const ctx = factory(data.length, frames, SR)
    const buf = ctx.createBuffer(data.length, frames, SR)
    stretched.forEach((d, ch) => buf.copyToChannel(d as Float32Array<ArrayBuffer>, ch))
    const src = ctx.createBufferSource()
    src.buffer = buf

    const opts = { durationSec: frames / SR, startTime: 0, phaseOffsetSec: 0 }
    const chain = buildEffectChain(ctx, params, opts)
    applyParams(chain, params, opts) // the engine always does this on start
    src.connect(chain.input)
    chain.output.connect(ctx.destination)
    src.start(0)
    return ctx.startRendering()
  }

  it('matches band for band under a combined parameter set', async () => {
    const params = p({ pitchSemitones: 2, speed: 0.9, reverbMix: 0.3, eqGainsDb: TONE_PRESETS.warm })
    const noise = whiteNoise(2, SR)
    const src = sourceBuffer([noise, noise])

    const live = await renderAsEngineWould([noise, noise], params)
    const offline = await renderToBuffer(src, params, undefined, factory)

    // The offline render is longer by the reverb tail it is allowed to ring
    // out; compare over the material itself.
    expect(offline.length).toBeGreaterThanOrEqual(live.length)
    const common = Math.min(offline.length, live.length)
    const a = offline.getChannelData(0).subarray(0, common)
    const b = live.getChannelData(0).subarray(0, common)
    for (const f of [125, 500, 2000, 8000]) {
      expect(Math.abs(bandLevelDb(a, f, SR) - bandLevelDb(b, f, SR)), `band ${f} Hz`).toBeLessThan(0.5)
    }
  })

  it('matches exactly in length when there is no reverb tail to ring out', async () => {
    const params = p({ pitchSemitones: 2, speed: 0.9, reverbMix: 0 })
    const noise = whiteNoise(1, SR)
    const live = await renderAsEngineWould([noise, noise], params)
    const offline = await renderToBuffer(sourceBuffer([noise, noise]), params, undefined, factory)
    expect(offline.length).toBe(live.length)
  })

  it('matches with 8D engaged, where automation could most easily diverge', async () => {
    const params = p({ eightD: true, speed: 1 })
    const noise = whiteNoise(3, SR)
    const live = await renderAsEngineWould([noise, noise], params)
    const offline = await renderToBuffer(sourceBuffer([noise, noise]), params, undefined, factory)
    const common = Math.min(offline.length, live.length)
    expect(rms(offline.getChannelData(0).subarray(0, common))).toBeCloseTo(
      rms(live.getChannelData(0).subarray(0, common)), 3)
    expect(rms(offline.getChannelData(1).subarray(0, common))).toBeCloseTo(
      rms(live.getChannelData(1).subarray(0, common)), 3)
  })

  it('lets the reverb tail decay instead of cutting it off at the last frame', async () => {
    const params = p({ reverbMix: 0.8, speed: 1 })
    const click = new Float32Array(SR)
    click[SR - 100] = 1 // an impulse right at the end of the material
    const offline = await renderToBuffer(sourceBuffer([click, click]), params, undefined, factory)
    // There must be rendered audio after the source ends, carrying the tail.
    expect(offline.length).toBeGreaterThan(SR)
    expect(rms(offline.getChannelData(0).subarray(SR))).toBeGreaterThan(1e-5)
  })
})

describe('encodeWav', () => {
  it('writes a RIFF/WAVE header with the source rate and channel count', () => {
    const src = sourceBuffer([sine(440, 0.1, SR), sine(440, 0.1, SR)])
    const bytes = encodeWav(src)
    const view = new DataView(bytes.buffer)
    expect(new TextDecoder().decode(bytes.slice(0, 4))).toBe('RIFF')
    expect(new TextDecoder().decode(bytes.slice(8, 12))).toBe('WAVE')
    expect(view.getUint16(20, true)).toBe(3) // IEEE float, not 16-bit PCM
    expect(view.getUint16(22, true)).toBe(2)
    expect(view.getUint32(24, true)).toBe(48000)
    expect(view.getUint16(34, true)).toBe(32)
  })

  it('declares a data size matching the frame count', () => {
    const src = sourceBuffer([sine(440, 0.1, SR), sine(440, 0.1, SR)])
    const bytes = encodeWav(src)
    const declared = new DataView(bytes.buffer).getUint32(40, true)
    expect(declared).toBe(src.length * 2 * 4)
    expect(bytes.length).toBe(44 + declared)
  })

  it('round-trips sample values', () => {
    const data = Float32Array.from([0, 0.5, -0.5, 1, -1])
    const ctx = makeOfflineContext(1, 0.1)
    const buf = ctx.createBuffer(1, data.length, SR)
    buf.copyToChannel(data, 0)
    const bytes = encodeWav(buf)
    const view = new DataView(bytes.buffer)
    for (let i = 0; i < data.length; i++) {
      expect(view.getFloat32(44 + i * 4, true)).toBeCloseTo(data[i], 6)
    }
  })
})

describe('sliceChannels', () => {
  it('extracts the requested span', () => {
    const data = sine(440, 4, SR)
    const [out] = sliceChannels([data], SR, { a: 1, b: 3 })
    expect(out.length).toBe(SR * 2)
  })

  it('orders a reversed region rather than producing nothing', () => {
    const [out] = sliceChannels([sine(440, 4, SR)], SR, { a: 3, b: 1 })
    expect(out.length).toBe(SR * 2)
  })

  it('fades the edges so a clip does not click', () => {
    // Constant full-scale input: without fades both ends would start at 1.0,
    // which is a step discontinuity and an audible click at each end.
    const flat = new Float32Array(SR * 2).fill(1)
    const [out] = sliceChannels([flat], SR, { a: 0.5, b: 1.5 })
    expect(out[0]).toBeCloseTo(0, 5)
    expect(out[out.length - 1]).toBeCloseTo(0, 5)
    // ...and the fade is short enough to be inaudible, leaving the body intact.
    const fadeSamples = Math.floor(EDGE_FADE_SEC * SR)
    expect(out[fadeSamples + 10]).toBeCloseTo(1, 5)
    expect(rms(out)).toBeGreaterThan(0.99)
  })

  it('clamps a region that runs past the end', () => {
    const [out] = sliceChannels([sine(440, 2, SR)], SR, { a: 1, b: 99 })
    expect(out.length).toBe(SR)
  })

  it('keeps channels aligned', () => {
    const out = sliceChannels([sine(440, 3, SR), sine(880, 3, SR)], SR, { a: 1, b: 2 })
    expect(out[0].length).toBe(out[1].length)
    expect(dominantFreq(out[0], SR)).toBeCloseTo(440, 0)
    expect(dominantFreq(out[1], SR)).toBeCloseTo(880, 0)
  })
})

describe('renderToBuffer with a region', () => {
  it('renders only the region', async () => {
    const src = sourceBuffer([sine(440, 8, SR), sine(440, 8, SR)])
    const out = await renderToBuffer(src, p({}), undefined, factory, { a: 2, b: 5 })
    expect(out.duration).toBeCloseTo(3, 1)
  })

  it('applies speed to the region, not to the whole track', async () => {
    const src = sourceBuffer([sine(440, 8, SR), sine(440, 8, SR)])
    const out = await renderToBuffer(src, p({ speed: 1.5 }), undefined, factory, { a: 2, b: 5 })
    expect(out.duration).toBeCloseTo(3 / 1.5, 1)
  })

  it('still applies pitch within the region', async () => {
    const src = sourceBuffer([sine(440, 8, SR), sine(440, 8, SR)])
    const out = await renderToBuffer(src, p({ pitchSemitones: 2 }), undefined, factory, { a: 2, b: 6 })
    expect(dominantFreq(out.getChannelData(0), SR)).toBeCloseTo(493.88, 0)
  })

  it('renders a region of any length, on or off the beat', async () => {
    // The selection is free-form: it need not be a whole number of beats, and
    // nothing in the export path may round it to one.
    const src = sourceBuffer([sine(440, 8, SR), sine(440, 8, SR)])
    for (const region of [{ a: 1.137, b: 1.429 }, { a: 0.02, b: 7.981 }]) {
      const out = await renderToBuffer(src, p({}), undefined, factory, region)
      expect(out.duration).toBeCloseTo(region.b - region.a, 2)
    }
  })

  it('renders a region far shorter than a beat', async () => {
    const src = sourceBuffer([sine(440, 8, SR), sine(440, 8, SR)])
    const out = await renderToBuffer(src, p({}), undefined, factory, { a: 3, b: 3.02 })
    expect(out.duration).toBeCloseTo(0.02, 2)
    expect(out.length).toBeGreaterThan(0)
  })

  it('renders the whole track when no region is given', async () => {
    const src = sourceBuffer([sine(440, 4, SR), sine(440, 4, SR)])
    const out = await renderToBuffer(src, p({}), undefined, factory)
    expect(out.duration).toBeCloseTo(4, 1)
  })
})

describe('exportFilename', () => {
  it('names a whole-step drop the way the reference file is named', () => {
    expect(exportFilename("Won't get fooled again 135bpm.m4a", p({ pitchSemitones: -2 }), 'mp3')).toBe(
      "pitchdown a wholestep-Won't get fooled again 135bpm-keychange.mp3",
    )
  })

  it('labels a half step', () => {
    expect(exportFilename('song.wav', p({ pitchSemitones: 1 }), 'wav')).toBe('pitchup a halfstep-song-keychange.wav')
  })

  it('includes speed and effects', () => {
    const name = exportFilename('song.mp3', p({ speed: 0.85, reverbMix: 0.4, eightD: true }), 'mp3')
    expect(name).toContain('0.85x')
    expect(name).toContain('reverb')
    expect(name).toContain('8d')
  })

  it('has no prefix at default settings', () => {
    expect(exportFilename('song.mp3', p({}), 'wav')).toBe('song-keychange.wav')
  })

  it('names the region so several loops from one track do not collide', () => {
    const a = exportFilename('song.mp3', p({}), 'wav', { a: 12.4, b: 20.6 })
    const b = exportFilename('song.mp3', p({}), 'wav', { a: 40, b: 48 })
    expect(a).toBe('12s-21s-song-keychange.wav')
    expect(b).toBe('40s-48s-song-keychange.wav')
    expect(a).not.toBe(b)
  })

  it('combines a region with the other settings', () => {
    const name = exportFilename('song.mp3', p({ pitchSemitones: -2, speed: 0.85 }), 'mp3', { a: 10, b: 18 })
    expect(name).toContain('10s-18s')
    expect(name).toContain('pitchdown a wholestep')
    expect(name).toContain('0.85x')
  })
})
