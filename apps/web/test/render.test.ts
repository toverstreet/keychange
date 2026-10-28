import { describe, it, expect } from 'vitest'
import { DEFAULT_PARAMS, TONE_PRESETS, type Params } from '@keypitch/contract'
import { OfflineAudioContext } from 'node-web-audio-api'
import { renderToBuffer, exportFilename } from '../lib/audio/render'
import { encodeWav } from '../lib/audio/wav'
import { buildEffectChain } from '../lib/audio/effect-chain'
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

describe('export parity: the offline render must equal the live graph', () => {
  /**
   * The live engine plays the stretched buffer through buildEffectChain on an
   * AudioContext; renderToBuffer runs the same stretched buffer through
   * buildEffectChain on an OfflineAudioContext. This reconstructs the live
   * arrangement explicitly and compares band by band, so a future change that
   * makes one path diverge from the other fails here rather than shipping as a
   * "the download sounds different" bug.
   */
  async function renderLiveEquivalent(data: Float32Array[], params: Params): Promise<AudioBuffer> {
    const stretched = stretchChannels(
      data.map((d) => d.slice()),
      SR,
      { pitchSemitones: params.pitchSemitones, speed: params.speed },
    )
    const frames = stretched[0].length
    const ctx = factory(data.length, frames, SR)
    const buf = ctx.createBuffer(data.length, frames, SR)
    stretched.forEach((d, ch) => buf.copyToChannel(d, ch))
    const src = ctx.createBufferSource()
    src.buffer = buf
    const chain = buildEffectChain(ctx, params, { durationSec: frames / SR, startTime: 0 })
    src.connect(chain.input)
    chain.output.connect(ctx.destination)
    src.start(0)
    return ctx.startRendering()
  }

  it('matches band for band under a combined parameter set', async () => {
    const params = p({ pitchSemitones: 2, speed: 0.9, reverbMix: 0.3, eqGainsDb: TONE_PRESETS.warm })
    const noise = whiteNoise(2, SR)
    const src = sourceBuffer([noise, noise])

    const live = await renderLiveEquivalent([noise, noise], params)
    const offline = await renderToBuffer(src, params, undefined, factory)

    expect(offline.length).toBe(live.length)
    for (const f of [125, 500, 2000, 8000]) {
      const a = bandLevelDb(offline.getChannelData(0), f, SR)
      const b = bandLevelDb(live.getChannelData(0), f, SR)
      expect(Math.abs(a - b), `band ${f} Hz`).toBeLessThan(0.5)
    }
  })

  it('matches with 8D engaged, where automation could most easily diverge', async () => {
    const params = p({ eightD: true, speed: 1 })
    const noise = whiteNoise(3, SR)
    const src = sourceBuffer([noise, noise])
    const live = await renderLiveEquivalent([noise, noise], params)
    const offline = await renderToBuffer(src, params, undefined, factory)
    expect(rms(offline.getChannelData(0))).toBeCloseTo(rms(live.getChannelData(0)), 3)
    expect(rms(offline.getChannelData(1))).toBeCloseTo(rms(live.getChannelData(1)), 3)
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

describe('exportFilename', () => {
  it('names a whole-step drop the way the reference file is named', () => {
    expect(exportFilename("Won't get fooled again 135bpm.m4a", p({ pitchSemitones: -2 }), 'mp3')).toBe(
      "pitchdown a wholestep-Won't get fooled again 135bpm-keypitch.mp3",
    )
  })

  it('labels a half step', () => {
    expect(exportFilename('song.wav', p({ pitchSemitones: 1 }), 'wav')).toBe('pitchup a halfstep-song-keypitch.wav')
  })

  it('includes speed and effects', () => {
    const name = exportFilename('song.mp3', p({ speed: 0.85, reverbMix: 0.4, eightD: true }), 'mp3')
    expect(name).toContain('0.85x')
    expect(name).toContain('reverb')
    expect(name).toContain('8d')
  })

  it('has no prefix at default settings', () => {
    expect(exportFilename('song.mp3', p({}), 'wav')).toBe('song-keypitch.wav')
  })
})
