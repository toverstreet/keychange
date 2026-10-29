import { EQ_BANDS, type Params } from '@keychange/contract'
import { generateImpulse } from './impulse'

/**
 * The effect portion of the signal graph.
 *
 * A pure function of (ctx, params, opts) that works against both AudioContext
 * and OfflineAudioContext. Live playback and export call it with different
 * contexts and nothing else differs, which is what makes the exported file
 * provably the thing that was previewed.
 *
 * It returns handles to the nodes, not just endpoints, so the live engine can
 * update parameters *in place*. Rebuilding the chain on every slider event
 * instead would restart the source node ~60 times a second (audible stuttering)
 * and leak the previous chain, since Web Audio keeps nodes alive while they are
 * connected toward the destination.
 *
 * Pitch and speed are not here: they are applied upstream by `stretch.ts`.
 *
 *   input -> eq[10] -> panner -> +-> dry gain --------+-> output
 *                                +-> convolver -> wet +
 */
export type EffectChain = {
  input: AudioNode
  output: AudioNode
  eq: BiquadFilterNode[]
  panner: StereoPannerNode
  dry: GainNode
  wet: GainNode
  convolver: ConvolverNode
}

export type ChainOptions = {
  /** Length of the material, used to schedule 8D automation. */
  durationSec: number
  /** Context time at which the material starts. 0 for an offline render. */
  startTime?: number
  /**
   * Where in the material playback begins, in *stretched* seconds.
   *
   * The 8D rotation phase is a function of position in the material, not of
   * when the graph happened to be built. Without this, starting playback from
   * the middle of a track would rotate from phase 0 while the export rotated
   * from the phase belonging to that position -- so the exported 8D movement
   * would not match what was previewed.
   */
  phaseOffsetSec?: number
}

/** Rotations per second of the 8D effect: slow enough to read as movement
 *  around the listener rather than as tremolo. */
export const EIGHT_D_HZ = 0.1
const EIGHT_D_DEPTH = 0.95
const EIGHT_D_STEPS_PER_CYCLE = 48

/** Impulse responses are cached per context. Regenerating one costs ~230k PRNG
 *  calls and ~1.8 MB, which is not something to repeat on a slider drag. */
const impulseCache = new WeakMap<BaseAudioContext, AudioBuffer>()

function impulseFor(ctx: BaseAudioContext): AudioBuffer {
  let ir = impulseCache.get(ctx)
  if (!ir) {
    ir = generateImpulse(ctx)
    impulseCache.set(ctx, ir)
  }
  return ir
}

/** Equal-power dry/wet. Linear would dip audibly mid-travel. */
export function mixGains(reverbMix: number): { dry: number; wet: number } {
  const mix = Math.min(1, Math.max(0, reverbMix))
  return { dry: Math.cos((mix * Math.PI) / 2), wet: Math.sin((mix * Math.PI) / 2) }
}

/** Schedule (or clear) the 8D rotation automation on an existing panner. */
export function scheduleEightD(
  panner: StereoPannerNode,
  params: Params,
  opts: ChainOptions,
): void {
  const start = opts.startTime ?? 0
  panner.pan.cancelScheduledValues(start)

  if (!params.eightD) {
    panner.pan.setValueAtTime(0, start)
    return
  }

  const phase = opts.phaseOffsetSec ?? 0
  const cycles = Math.max(1, opts.durationSec * EIGHT_D_HZ)
  const steps = Math.ceil(cycles * EIGHT_D_STEPS_PER_CYCLE)
  const stepSec = opts.durationSec / Math.max(1, steps)

  panner.pan.setValueAtTime(Math.sin(2 * Math.PI * EIGHT_D_HZ * phase) * EIGHT_D_DEPTH, start)
  for (let s = 1; s <= steps; s++) {
    const t = start + s * stepSec
    const value = Math.sin(2 * Math.PI * EIGHT_D_HZ * (phase + s * stepSec)) * EIGHT_D_DEPTH
    panner.pan.linearRampToValueAtTime(value, t)
  }
}

/** Apply parameters to an existing chain without rebuilding it. */
export function applyParams(chain: EffectChain, params: Params, opts: ChainOptions): void {
  EQ_BANDS.forEach((_, i) => {
    chain.eq[i].gain.value = params.eqGainsDb[i] ?? 0
  })
  const { dry, wet } = mixGains(params.reverbMix)
  chain.dry.gain.value = dry
  chain.wet.gain.value = wet
  scheduleEightD(chain.panner, params, opts)
}

export function buildEffectChain(
  ctx: BaseAudioContext,
  params: Params,
  opts: ChainOptions,
): EffectChain {
  const input = ctx.createGain()
  let tail: AudioNode = input

  // Peaking filters throughout rather than shelving at the extremes, so every
  // band behaves the same and the UI row can stay uniform.
  const eq: BiquadFilterNode[] = EQ_BANDS.map((freq, i) => {
    const filter = ctx.createBiquadFilter()
    filter.type = 'peaking'
    filter.frequency.value = freq
    filter.Q.value = 1.0
    filter.gain.value = params.eqGainsDb[i] ?? 0
    tail.connect(filter)
    tail = filter
    return filter
  })

  // StereoPanner with scheduled automation rather than an HRTF PannerNode: the
  // audible result is the recognisable rotation, it behaves identically in
  // every context including offline rendering, and it needs no HRTF dataset.
  const panner = ctx.createStereoPanner()
  tail.connect(panner)
  tail = panner

  const output = ctx.createGain()
  const dryNode = ctx.createGain()
  const wetNode = ctx.createGain()

  const gains = mixGains(params.reverbMix)
  dryNode.gain.value = gains.dry
  wetNode.gain.value = gains.wet

  tail.connect(dryNode)
  dryNode.connect(output)

  // The convolver is always present, with the wet path silenced at mix 0.
  // Creating it lazily would mean rebuilding the graph the moment someone
  // touches the reverb slider, which is the thing this design exists to avoid.
  const convolver = ctx.createConvolver()
  convolver.normalize = true
  convolver.buffer = impulseFor(ctx)
  tail.connect(convolver)
  convolver.connect(wetNode)
  wetNode.connect(output)

  const chain: EffectChain = { input, output, eq, panner, dry: dryNode, wet: wetNode, convolver }
  scheduleEightD(panner, params, opts)
  return chain
}

/** Disconnect a chain from everything downstream. Web Audio keeps nodes alive
 *  while they are connected toward the destination, so a chain that is replaced
 *  without this is retained for the lifetime of the context. */
export function disposeChain(chain: EffectChain): void {
  chain.output.disconnect()
  chain.dry.disconnect()
  chain.wet.disconnect()
  chain.convolver.disconnect()
  chain.panner.disconnect()
  for (const f of chain.eq) f.disconnect()
  chain.input.disconnect()
}
