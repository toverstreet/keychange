import { DEFAULT_PARAMS, type Params } from '@keychange/contract'
import { reanchorForSpeedChange, sourcePositionAt, stretchedOffset, type Anchor } from './clock'
import { applyParams, buildEffectChain, disposeChain, type EffectChain } from './effect-chain'
import { writeChannel } from './samples'
import { isNeutral, stretchChannels } from './stretch'

/**
 * Owns the live Web Audio graph. The UI calls `setParams` and never touches an
 * AudioNode.
 *
 * Pitch and speed are applied by re-stretching the source buffer with the same
 * `stretchChannels` the export uses -- stretching the whole 8.5-minute
 * reference file measures ~0.5 s, which is what makes this affordable and why
 * there is no real-time pitch node here at all. Everything downstream (EQ,
 * reverb, 8D) is a native node updated in place, so it responds instantly.
 *
 * The effect chain is built once and mutated. An earlier version rebuilt it on
 * every parameter change, which restarted the source node ~60 times a second
 * while a slider was dragged (audible stuttering) and leaked every previous
 * chain, because Web Audio retains nodes that are still connected toward the
 * destination.
 *
 * Positions are always expressed in *source* seconds. The stretched buffer runs
 * on a source/speed clock, and conflating the two is how a playhead drifts away
 * from the waveform the moment speed changes. See `clock.ts`.
 */

export type EngineState = {
  playing: boolean
  /** Source seconds. */
  position: number
  /** True while a pitch/speed re-render is pending or in flight. */
  rendering: boolean
}

export type EngineListener = (state: EngineState) => void

const RESTRETCH_DEBOUNCE_MS = 120
const LOOP_POLL_MS = 10

export class AudioEngine {
  readonly source: AudioBuffer
  readonly durationSec: number

  /** Counts full graph rebuilds. Effects-only changes must not increment it;
   *  asserted in the tests, because a regression here is inaudible until it
   *  has leaked a few hundred megabytes. */
  chainBuilds = 0

  private ctx: BaseAudioContext
  private ownsContext: boolean
  private params: Params
  private stretched: AudioBuffer
  private node: AudioBufferSourceNode | null = null
  private chain: EffectChain | null = null
  private masterGain: GainNode

  private playing = false
  private anchor: Anchor = { sourceSec: 0, ctxTime: 0, speed: 1 }
  private pausedAt = 0

  private rendering = false
  private restretchTimer: ReturnType<typeof setTimeout> | null = null
  private listeners = new Set<EngineListener>()
  private loopCheck: ReturnType<typeof setInterval> | null = null
  private disposed = false

  constructor(source: AudioBuffer, ctx?: BaseAudioContext, params: Params = DEFAULT_PARAMS) {
    this.source = source
    this.durationSec = source.duration
    this.ownsContext = !ctx
    this.ctx = ctx ?? new AudioContext({ sampleRate: source.sampleRate })
    this.params = { ...params, eqGainsDb: [...params.eqGainsDb] }
    this.masterGain = this.ctx.createGain()
    this.masterGain.connect(this.ctx.destination)
    this.stretched = source
    this.anchor = { sourceSec: 0, ctxTime: this.ctx.currentTime, speed: this.params.speed }
    this.restretchNow()
  }

  // --- subscription -----------------------------------------------------

  subscribe(listener: EngineListener): () => void {
    this.listeners.add(listener)
    listener(this.state())
    return () => this.listeners.delete(listener)
  }

  private emit(): void {
    const s = this.state()
    for (const l of this.listeners) l(s)
  }

  state(): EngineState {
    return { playing: this.playing, position: this.positionSec, rendering: this.rendering }
  }

  getParams(): Params {
    return { ...this.params, eqGainsDb: [...this.params.eqGainsDb] }
  }

  get positionSec(): number {
    if (!this.playing) return this.pausedAt
    return sourcePositionAt(this.anchor, this.ctx.currentTime, this.durationSec)
  }

  // --- parameters -------------------------------------------------------

  setParams(partial: Partial<Params>): void {
    if (this.disposed) return
    const before = this.params
    const next: Params = {
      ...before,
      ...partial,
      eqGainsDb: partial.eqGainsDb ? [...partial.eqGainsDb] : [...before.eqGainsDb],
    }
    const needsRestretch =
      next.pitchSemitones !== before.pitchSemitones || next.speed !== before.speed

    if (needsRestretch && this.playing && next.speed !== before.speed) {
      // Re-anchor *before* adopting the new speed, or the elapsed time already
      // played at the old speed gets reinterpreted at the new one and the
      // position jumps by elapsed x (new - old).
      this.anchor = reanchorForSpeedChange(this.anchor, this.ctx.currentTime, next.speed, this.durationSec)
    }

    this.params = next

    if (needsRestretch) {
      // Debounced: dragging a slider should not queue a render per pixel.
      if (this.restretchTimer) clearTimeout(this.restretchTimer)
      this.rendering = true
      this.restretchTimer = setTimeout(() => {
        this.restretchTimer = null
        this.restretchNow()
      }, RESTRETCH_DEBOUNCE_MS)
    } else if (this.chain) {
      // Effects-only: mutate the existing chain. No teardown, no new nodes.
      applyParams(this.chain, this.params, this.chainOptions())
    }
    this.emit()
  }

  private chainOptions() {
    return {
      durationSec: this.stretched.duration,
      startTime: this.ctx.currentTime,
      phaseOffsetSec: stretchedOffset(this.positionSec, this.params.speed),
    }
  }

  private restretchNow(): void {
    if (this.disposed) return

    if (isNeutral({ pitchSemitones: this.params.pitchSemitones, speed: this.params.speed })) {
      this.stretched = this.source
    } else {
      const channels: Float32Array[] = []
      for (let ch = 0; ch < this.source.numberOfChannels; ch++) {
        channels.push(this.source.getChannelData(ch).slice())
      }
      const out = stretchChannels(channels, this.source.sampleRate, {
        pitchSemitones: this.params.pitchSemitones,
        speed: this.params.speed,
      })
      const buf = this.ctx.createBuffer(out.length, out[0].length, this.source.sampleRate)
      out.forEach((d, ch) => writeChannel(buf, d, ch))
      this.stretched = buf
    }

    this.rendering = false

    // Only the source node is replaced; the effect chain persists.
    const resumeAt = this.positionSec
    const wasPlaying = this.playing
    this.teardownNode()
    this.ensureChain()
    if (wasPlaying) this.startNodeAt(resumeAt)
    else this.pausedAt = resumeAt

    this.emit()
  }

  // --- graph ------------------------------------------------------------

  private ensureChain(): void {
    if (this.chain) return
    this.chain = buildEffectChain(this.ctx, this.params, this.chainOptions())
    this.chain.output.connect(this.masterGain)
    this.chainBuilds++
  }

  private startNodeAt(sourceSeconds: number): void {
    this.ensureChain()
    if (!this.chain) return

    const clamped = Math.min(this.durationSec, Math.max(0, sourceSeconds))
    const node = this.ctx.createBufferSource()
    node.buffer = this.stretched
    node.connect(this.chain.input)
    node.start(0, stretchedOffset(clamped, this.params.speed))

    node.onended = () => {
      if (this.node === node && this.playing && !this.params.loop) {
        this.playing = false
        this.pausedAt = this.durationSec
        this.stopLoopWatcher()
        this.emit()
      }
    }

    this.node = node
    this.playing = true
    this.anchor = { sourceSec: clamped, ctxTime: this.ctx.currentTime, speed: this.params.speed }

    // The rotation phase follows position in the material, so that playing from
    // the middle matches what an export has at that same point.
    applyParams(this.chain, this.params, this.chainOptions())
    this.startLoopWatcher()
  }

  private teardownNode(): void {
    if (this.node) {
      this.node.onended = null
      try {
        this.node.stop()
      } catch {
        /* already stopped */
      }
      this.node.disconnect()
      this.node = null
    }
    this.playing = false
    this.stopLoopWatcher()
  }

  // --- loop -------------------------------------------------------------

  /**
   * Looping is enforced by a watcher rather than AudioBufferSourceNode.loop,
   * whose loop points are in stretched time and would need rewriting on every
   * speed change -- and cannot be adjusted mid-playback without a restart. A
   * watcher keeps loop state in source time, the only representation the rest
   * of the app uses.
   */
  private startLoopWatcher(): void {
    if (this.loopCheck) return
    this.loopCheck = setInterval(() => {
      const loop = this.params.loop
      if (!this.playing || !loop) return
      if (this.positionSec >= loop.b) this.seek(loop.a)
    }, LOOP_POLL_MS)
  }

  private stopLoopWatcher(): void {
    if (this.loopCheck) {
      clearInterval(this.loopCheck)
      this.loopCheck = null
    }
  }

  // --- transport --------------------------------------------------------

  async play(): Promise<void> {
    if (this.disposed) return
    const ctx = this.ctx as AudioContext
    if (typeof ctx.resume === 'function' && ctx.state === 'suspended') await ctx.resume()
    if (this.playing) return
    const from = this.pausedAt >= this.durationSec ? (this.params.loop?.a ?? 0) : this.pausedAt
    this.startNodeAt(from)
    this.emit()
  }

  pause(): void {
    if (!this.playing) return
    const at = this.positionSec
    this.teardownNode()
    this.pausedAt = at
    this.emit()
  }

  async toggle(): Promise<void> {
    if (this.playing) this.pause()
    else await this.play()
  }

  seek(sourceSeconds: number): void {
    if (this.disposed) return
    const clamped = Math.min(this.durationSec, Math.max(0, sourceSeconds))
    if (this.playing) {
      this.teardownNode()
      this.startNodeAt(clamped)
    } else {
      this.pausedAt = clamped
    }
    this.emit()
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    if (this.restretchTimer) clearTimeout(this.restretchTimer)
    this.restretchTimer = null
    this.teardownNode()
    if (this.chain) {
      disposeChain(this.chain)
      this.chain = null
    }
    this.masterGain.disconnect()
    this.listeners.clear()
    // Only close a context this engine created. An injected one belongs to the
    // caller -- tests share one, and closing it would break the next engine.
    if (this.ownsContext) void (this.ctx as AudioContext).close?.()
  }
}
