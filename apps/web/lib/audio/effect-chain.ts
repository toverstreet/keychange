import { EQ_BANDS, type Params } from '@keypitch/contract'
import { generateImpulse } from './impulse'

/**
 * Build the effect portion of the signal graph.
 *
 * Deliberately a pure function of (ctx, params, opts) that works against both
 * AudioContext and OfflineAudioContext. Live playback and export call it with
 * different contexts and nothing else differs, which is what makes the exported
 * file provably the thing that was previewed.
 *
 * Pitch and speed are *not* here: they are applied upstream by `stretch.ts`
 * before the audio reaches this chain.
 *
 *   input -> eq[10] -> panner -> +-> dry gain --+-> output
 *                               +-> convolver -> wet gain -+
 */
export type EffectChain = {
  input: AudioNode
  output: AudioNode
}

export type ChainOptions = {
  /** Length of the material, needed to schedule 8D automation. */
  durationSec: number
  /** Context time at which the material starts. 0 for an offline render. */
  startTime?: number
}

/** Rotations per second of the 8D effect. Slow enough to read as movement
 *  around the listener rather than tremolo. */
const EIGHT_D_HZ = 0.1
const EIGHT_D_DEPTH = 0.95
/** Automation breakpoints per rotation. Enough that the sweep is smooth. */
const EIGHT_D_STEPS_PER_CYCLE = 48

export function buildEffectChain(
  ctx: BaseAudioContext,
  params: Params,
  opts: ChainOptions,
): EffectChain {
  const input = ctx.createGain()
  let tail: AudioNode = input

  // --- EQ: one peaking filter per band ---------------------------------
  // Peaking rather than shelving at the extremes, so that a band's control
  // behaves the same everywhere on the row and the UI can stay uniform.
  EQ_BANDS.forEach((freq, i) => {
    const gain = params.eqGainsDb[i] ?? 0
    const filter = ctx.createBiquadFilter()
    filter.type = 'peaking'
    filter.frequency.value = freq
    filter.Q.value = 1.0
    filter.gain.value = gain
    tail.connect(filter)
    tail = filter
  })

  // --- 8D: slow rotational panning -------------------------------------
  // StereoPannerNode with scheduled automation rather than an HRTF PannerNode.
  // The audible result is the recognisable rotation, it behaves identically in
  // every context including offline rendering, and it needs no HRTF dataset.
  const panner = ctx.createStereoPanner()
  panner.pan.value = 0
  if (params.eightD) {
    const start = opts.startTime ?? 0
    const cycles = Math.max(1, opts.durationSec * EIGHT_D_HZ)
    const steps = Math.ceil(cycles * EIGHT_D_STEPS_PER_CYCLE)
    const stepSec = opts.durationSec / Math.max(1, steps)
    for (let s = 0; s <= steps; s++) {
      const t = start + s * stepSec
      const value = Math.sin(2 * Math.PI * EIGHT_D_HZ * (s * stepSec)) * EIGHT_D_DEPTH
      panner.pan.linearRampToValueAtTime(value, t)
    }
  }
  tail.connect(panner)
  tail = panner

  // --- Reverb: parallel dry/wet ----------------------------------------
  const output = ctx.createGain()
  const dry = ctx.createGain()
  const wet = ctx.createGain()

  // Equal-power crossfade rather than linear. A linear mix at 0.5 drops the
  // perceived level audibly in the middle of the control's travel.
  const mix = Math.min(1, Math.max(0, params.reverbMix))
  dry.gain.value = Math.cos((mix * Math.PI) / 2)
  wet.gain.value = Math.sin((mix * Math.PI) / 2)

  tail.connect(dry)
  dry.connect(output)

  if (mix > 0) {
    const convolver = ctx.createConvolver()
    convolver.normalize = true
    convolver.buffer = generateImpulse(ctx)
    tail.connect(convolver)
    convolver.connect(wet)
    wet.connect(output)
  }

  return { input, output }
}
