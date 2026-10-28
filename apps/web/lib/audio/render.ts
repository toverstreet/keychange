import type { Params } from '@keypitch/contract'
import { buildEffectChain } from './effect-chain'
import { stretchChannels, stretchedLength } from './stretch'
import { writeChannel } from './samples'

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
): Promise<AudioBuffer> {
  const channelCount = source.numberOfChannels
  const sampleRate = source.sampleRate

  const channels: Float32Array[] = []
  for (let ch = 0; ch < channelCount; ch++) channels.push(source.getChannelData(ch).slice())

  const stretched = stretchChannels(channels, sampleRate, params, (f) => onProgress?.(f * 0.7, 'stretch'))
  const frames = stretched[0]?.length ?? stretchedLength(source.length, params.speed)

  const makeContext =
    contextFactory ?? ((ch, len, rate) => new OfflineAudioContext(ch, len, rate))
  const ctx = makeContext(channelCount, Math.max(1, frames), sampleRate)

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
export function exportFilename(originalName: string, params: Params, ext: 'wav' | 'mp3'): string {
  const base = originalName.replace(/\.[^.]+$/, '')
  const bits: string[] = []
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
  return `${prefix}${base}-keypitch.${ext}`
}
