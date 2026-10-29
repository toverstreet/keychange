import type { Params } from '@keychange/contract'
import { buildEffectChain } from './effect-chain'
import { stretchChannels, stretchedLength } from './stretch'
import { writeChannel } from './samples'

/** Extra time rendered after the material so a reverb tail can decay. Matches
 *  the generated impulse length in `impulse.ts`. */
const REVERB_TAIL_SEC = 2.4

/**
 * Fade applied at the edges of an exported region.
 *
 * A clip cut at an arbitrary sample starts and ends on a step, which is an
 * audible click at both ends. Five milliseconds is long enough to remove it and
 * short enough that nobody hears a fade.
 */
export const EDGE_FADE_SEC = 0.005

export type Region = { a: number; b: number }

/** Extract a region of the source, with edge fades, in source seconds. */
export function sliceChannels(
  channels: Float32Array[],
  sampleRate: number,
  region: Region,
): Float32Array[] {
  const total = channels[0]?.length ?? 0
  const from = Math.max(0, Math.min(total, Math.floor(Math.min(region.a, region.b) * sampleRate)))
  const to = Math.max(from + 1, Math.min(total, Math.ceil(Math.max(region.a, region.b) * sampleRate)))
  const fade = Math.min(Math.floor(EDGE_FADE_SEC * sampleRate), Math.floor((to - from) / 2))

  return channels.map((data) => {
    const out = data.slice(from, to)
    for (let i = 0; i < fade; i++) {
      const g = i / fade
      out[i] *= g
      out[out.length - 1 - i] *= g
    }
    return out
  })
}

/**
 * Render `params` applied to `source`, offline.
 *
 * This is the export path, and it is deliberately the *same* two stages the
 * live engine uses: stretch first, then the shared effect chain. The live
 * engine plays the stretched buffer through `buildEffectChain` on an
 * AudioContext; this renders it through `buildEffectChain` on an
 * OfflineAudioContext. Nothing else differs, so the exported file cannot drift
 * from what was previewed.
 *
 * The offline context is created at the *source* sample rate. Letting it default
 * would resample the output -- which is exactly the downgrade keypitch.app
 * applied to the reference file (48 kHz in, 44.1 kHz out).
 */
export type RenderProgress = (fraction: number, stage: 'stretch' | 'effects') => void

export async function renderToBuffer(
  source: AudioBuffer,
  params: Params,
  onProgress?: RenderProgress,
  contextFactory?: (channels: number, frames: number, sampleRate: number) => OfflineAudioContext,
  /** Export only this slice of the source. Omit for the whole track. */
  region?: Region | null,
): Promise<AudioBuffer> {
  const channelCount = source.numberOfChannels
  const sampleRate = source.sampleRate

  let channels: Float32Array[] = []
  for (let ch = 0; ch < channelCount; ch++) channels.push(source.getChannelData(ch).slice())

  // Slicing happens before the stretch, not after: stretching the whole track
  // to throw most of it away would make a four-bar export cost the same as a
  // full one, and the loop's own boundaries are what should be faded.
  if (region) channels = sliceChannels(channels, sampleRate, region)
  const sourceFrames = channels[0]?.length ?? 0

  const stretched = stretchChannels(channels, sampleRate, params, (f) => onProgress?.(f * 0.7, 'stretch'))
  const frames = stretched[0]?.length ?? stretchedLength(sourceFrames, params.speed)

  // With reverb engaged, render past the end of the material so the tail
  // decays instead of being cut dead on the last source frame. Without this a
  // "Slow + Reverb" export ends on an abrupt chop, which is audible and is the
  // one preset most likely to be exported.
  const tailFrames = params.reverbMix > 0 ? Math.ceil(REVERB_TAIL_SEC * sampleRate) : 0
  const renderFrames = Math.max(1, frames + tailFrames)

  const makeContext =
    contextFactory ?? ((ch, len, rate) => new OfflineAudioContext(ch, len, rate))
  const ctx = makeContext(channelCount, renderFrames, sampleRate)

  const buffer = ctx.createBuffer(channelCount, Math.max(1, frames), sampleRate)
  stretched.forEach((data, ch) => writeChannel(buffer, data, ch))

  const src = ctx.createBufferSource()
  src.buffer = buffer

  const durationSec = frames / sampleRate
  const chain = buildEffectChain(ctx, params, { durationSec, startTime: 0 })
  src.connect(chain.input)
  chain.output.connect(ctx.destination)
  src.start(0)

  onProgress?.(0.75, 'effects')
  const rendered = await ctx.startRendering()
  onProgress?.(1, 'effects')
  return rendered
}

/** Export filename mirroring the convention already on the user's Desktop:
 *  "pitchdown a wholestep-<original>-keypitch.m4a". */
export function exportFilename(
  originalName: string,
  params: Params,
  ext: 'wav' | 'mp3',
  region?: Region | null,
): string {
  const base = originalName.replace(/\.[^.]+$/, '')
  const bits: string[] = []
  // Seconds rather than m:ss, because a colon is not a filename character and
  // exporting several loops from one track should produce distinct names.
  if (region) {
    bits.push(`${Math.round(Math.min(region.a, region.b))}s-${Math.round(Math.max(region.a, region.b))}s`)
  }
  if (params.pitchSemitones !== 0) {
    const n = Math.abs(params.pitchSemitones)
    const dir = params.pitchSemitones > 0 ? 'pitchup' : 'pitchdown'
    const label = n === 1 ? 'a halfstep' : n === 2 ? 'a wholestep' : `${n} semitones`
    bits.push(`${dir} ${label}`)
  }
  if (params.speed !== 1) bits.push(`${params.speed.toFixed(2)}x`)
  if (params.reverbMix > 0) bits.push('reverb')
  if (params.eightD) bits.push('8d')
  const prefix = bits.length ? `${bits.join(' ')}-` : ''
  return `${prefix}${base}-keychange.${ext}`
}
