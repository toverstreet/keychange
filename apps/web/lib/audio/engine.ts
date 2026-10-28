import { DEFAULT_PARAMS, type Params } from '@keypitch/contract'
import { buildEffectChain } from './effect-chain'
import { isNeutral, stretchChannels } from './stretch'
import { writeChannel } from './samples'

/**
 * Owns the live Web Audio graph. The UI calls `setParams` and never touches an
 * AudioNode.
 *
 * Pitch and speed are applied by re-stretching the source buffer, using the same
 * `stretchChannels` the export uses. Stretching the whole 8.5-minute reference
 * file measures ~0.5 s, which is what makes this affordable and is why there is
 * no real-time pitch node here at all. Everything downstream (EQ, reverb, 8D)
 * is a native node and responds instantly.
 *
 * Positions are always expressed in *source* seconds. The stretched buffer runs
 * on a different clock (source / speed), and conflating the two is how a
 * playhead drifts away from the waveform the moment speed changes.
 */

export type EngineState = {
  playing: boolean
  /** Source seconds. */
  position: number
  /** True while a pitch/speed re-render is in flight. */
  rendering: boolean
}

export type EngineListener = (state: EngineState) => void

const RESTRETCH_DEBOUNCE_MS = 120

export class AudioEngine {
  readonly source: AudioBuffer
  readonly durationSec: number

  private ctx: AudioContext
  private params: Params
  private stretched: AudioBuffer
  private node: AudioBufferSourceNode | null = null
  private chainInput: AudioNode | null = null
  private masterGain: GainNode

  private playing = false
  /** Source-time position where the current playback run began. */
  private runStartSource = 0
  /** ctx.currentTime when the current playback run began. */
  private runStartCtx = 0
  private pausedAt = 0

  private rendering = false
  private restretchTimer: ReturnType<typeof setTimeout> | null = null
  private listeners = new Set<EngineListener>()
  private loopCheck: ReturnType<typeof setInterval> | null = null

  constructor(source: AudioBuffer, ctx?: AudioContext, params: Params = DEFAULT_PARAMS) {
    this.source = source
    this.durationSec = source.duration
    this.ctx = ctx ?? new AudioContext({ sampleRate: source.sampleRate })
    this.params = { ...params, eqGainsDb: [...params.eqGainsDb] }
    this.masterGain = this.ctx.createGain()
    this.masterGain.connect(this.ctx.destination)
    this.stretched = source
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

  // --- position ---------------------------------------------------------

  /** Current playback position in source seconds. */
  get positionSec(): number {
    if (!this.playing) return this.pausedAt
    const elapsedStretched = this.ctx.currentTime - this.runStartCtx
    // Stretched time scales by speed; converting back keeps the playhead in
    // step with the waveform, which is drawn in source time.
    const pos = this.runStartSource + elapsedStretched * this.params.speed
    return Math.min(this.durationSec, Math.max(0, pos))
  }

  // --- parameters -------------------------------------------------------

  setParams(partial: Partial<Params>): void {
    const before = this.params
    const next: Params = {
      ...before,
      ...partial,
      eqGainsDb: partial.eqGainsDb ? [...partial.eqGainsDb] : [...before.eqGainsDb],
    }
    const needsRestretch =
      next.pitchSemitones !== before.pitchSemitones || next.speed !== before.speed

    this.params = next

    if (needsRestretch) {
      // Debounced: dragging a slider should not queue a render per pixel.
      if (this.restretchTimer) clearTimeout(this.restretchTimer)
      this.rendering = true
      this.emit()
      this.restretchTimer = setTimeout(() => {
        this.restretchTimer = null
        this.restretchNow()
      }, RESTRETCH_DEBOUNCE_MS)
    } else {
      // Effects-only change: rebuild the native chain in place, preserving
      // playback position so adjusting EQ mid-loop is seamless.
      this.rebuildChain()
    }
    this.emit()
  }

  private restretchNow(): void {
    const channels: Float32Array[] = []
    for (let ch = 0; ch < this.source.numberOfChannels; ch++) {
      channels.push(this.source.getChannelData(ch).slice())
    }

    if (isNeutral({ pitchSemitones: this.params.pitchSemitones, speed: this.params.speed })) {
      this.stretched = this.source
    } else {
      const out = stretchChannels(channels, this.source.sampleRate, {
        pitchSemitones: this.params.pitchSemitones,
        speed: this.params.speed,
      })
      const buf = this.ctx.createBuffer(out.length, out[0].length, this.source.sampleRate)
      out.forEach((d, ch) => writeChannel(buf, d, ch))
      this.stretched = buf
    }

    this.rendering = false
    this.rebuildChain()
    this.emit()
  }

  // --- graph ------------------------------------------------------------

  private rebuildChain(): void {
    const resumeAt = this.positionSec
    const wasPlaying = this.playing
    this.teardownNode()

    const chain = buildEffectChain(this.ctx, this.params, {
      durationSec: this.stretched.duration,
      startTime: this.ctx.currentTime,
    })
    chain.output.connect(this.masterGain)
    this.chainInput = chain.input

    if (wasPlaying) {
      this.startNodeAt(resumeAt)
    } else {
      this.pausedAt = resumeAt
    }
  }

  private startNodeAt(sourceSeconds: number): void {
    if (!this.chainInput) return
    const node = this.ctx.createBufferSource()
    node.buffer = this.stretched
    node.connect(this.chainInput)

    const clamped = Math.min(this.durationSec, Math.max(0, sourceSeconds))
    // Offsets into the stretched buffer are in stretched time.
    const offset = clamped / this.params.speed

    node.start(0, offset)
    node.onended = () => {
      if (this.node === node && this.playing && !this.params.loop) {
        this.playing = false
        this.pausedAt = this.durationSec
        this.emit()
      }
    }

    this.node = node
    this.playing = true
    this.runStartSource = clamped
    this.runStartCtx = this.ctx.currentTime
    this.ensureLoopWatcher()
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
  }

  // --- loop -------------------------------------------------------------

  /**
   * Looping is enforced by a watcher rather than AudioBufferSourceNode.loop.
   * The native loop points are in stretched time and would need rewriting on
   * every speed change, and they cannot be adjusted while a node is playing
   * without a restart anyway. A watcher keeps loop state in source time, which
   * is the only representation the rest of the app uses.
   */
  private ensureLoopWatcher(): void {
    if (this.loopCheck) return
    this.loopCheck = setInterval(() => {
      const loop = this.params.loop
      if (!this.playing || !loop) return
      if (this.positionSec >= loop.b - 0.005) this.seek(loop.a)
    }, 25)
  }

  // --- transport --------------------------------------------------------

  async play(): Promise<void> {
    if (this.ctx.state === 'suspended') await this.ctx.resume()
    if (this.playing) return
    const from = this.pausedAt >= this.durationSec ? (this.params.loop?.a ?? 0) : this.pausedAt
    if (!this.chainInput) this.rebuildChain()
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
    if (this.restretchTimer) clearTimeout(this.restretchTimer)
    if (this.loopCheck) clearInterval(this.loopCheck)
    this.loopCheck = null
    this.teardownNode()
    this.listeners.clear()
    void this.ctx.close()
  }
}
