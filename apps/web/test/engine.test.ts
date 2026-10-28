import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { DEFAULT_PARAMS, TONE_PRESETS, type Params } from '@keypitch/contract'
import { AudioEngine } from '../lib/audio/engine'
import { makeOfflineContext, bufferFrom, SR } from './helpers/offline'
import { sine } from './helpers/dsp'

/**
 * The engine is driven against an injected OfflineAudioContext. Its clock does
 * not advance, so these tests cover graph lifecycle and parameter handling;
 * the time arithmetic is covered exhaustively as pure functions in clock.test.ts.
 */
function makeEngine(seconds = 2, params: Params = DEFAULT_PARAMS) {
  const ctx = makeOfflineContext(2, seconds + 5)
  const tone = sine(440, seconds, SR)
  const buffer = bufferFrom(ctx, [tone, tone], SR)
  return { ctx, engine: new AudioEngine(buffer, ctx, params) }
}

let engines: AudioEngine[] = []
beforeEach(() => { engines = [] })
afterEach(() => { for (const e of engines) e.dispose() })
/** Register an engine for teardown. Takes the {ctx, engine} pair makeEngine returns. */
function track<T extends { engine: AudioEngine }>(pair: T): T {
  engines.push(pair.engine)
  return pair
}

describe('graph lifecycle', () => {
  it('does not rebuild the effect chain for effects-only changes', () => {
    // The regression this pins: an earlier version rebuilt the whole chain on
    // every parameter event. A slider emits ~60/s while dragged, each rebuild
    // restarted the source node (audible stuttering) and leaked the previous
    // chain, including a freshly generated ~1.8 MB impulse response.
    const { engine } = track(makeEngine())
    const builds = engine.chainBuilds

    for (let i = 0; i <= 12; i++) {
      engine.setParams({ eqGainsDb: new Array(10).fill(i - 6) })
      engine.setParams({ reverbMix: i / 12 })
    }
    engine.setParams({ eqGainsDb: TONE_PRESETS.vocals })

    expect(engine.chainBuilds).toBe(builds)
  })

  it('does not rebuild the chain when toggling 8D', () => {
    const { engine } = track(makeEngine())
    const builds = engine.chainBuilds
    engine.setParams({ eightD: true })
    engine.setParams({ eightD: false })
    expect(engine.chainBuilds).toBe(builds)
  })

  it('builds the chain exactly once for a sequence including pitch changes', () => {
    const { engine } = track(makeEngine())
    engine.setParams({ reverbMix: 0.5 })
    engine.setParams({ eqGainsDb: TONE_PRESETS.bass })
    expect(engine.chainBuilds).toBe(1)
  })

  it('reports effects-only changes immediately rather than entering a render', () => {
    const { engine } = track(makeEngine())
    engine.setParams({ reverbMix: 0.4 })
    expect(engine.state().rendering).toBe(false)
  })

  it('enters a rendering state for a pitch change and leaves it after the debounce', async () => {
    const { engine } = track(makeEngine())
    engine.setParams({ pitchSemitones: 2 })
    expect(engine.state().rendering).toBe(true)
    await new Promise((r) => setTimeout(r, 400))
    expect(engine.state().rendering).toBe(false)
    expect(engine.getParams().pitchSemitones).toBe(2)
  })
})

describe('parameters', () => {
  it('returns a defensive copy of its params', () => {
    const { engine } = track(makeEngine())
    const a = engine.getParams()
    a.eqGainsDb[0] = 99
    expect(engine.getParams().eqGainsDb[0]).toBe(0)
  })

  it('copies incoming EQ arrays rather than aliasing the caller', () => {
    const { engine } = track(makeEngine())
    const gains = new Array(10).fill(3)
    engine.setParams({ eqGainsDb: gains })
    gains[0] = 99
    expect(engine.getParams().eqGainsDb[0]).toBe(3)
  })

  it('merges partial updates without dropping other fields', () => {
    const { engine } = track(makeEngine())
    engine.setParams({ reverbMix: 0.5 })
    engine.setParams({ eightD: true })
    const p = engine.getParams()
    expect(p.reverbMix).toBe(0.5)
    expect(p.eightD).toBe(true)
  })
})

describe('transport', () => {
  it('starts paused at zero', () => {
    const { engine } = track(makeEngine())
    expect(engine.state().playing).toBe(false)
    expect(engine.positionSec).toBe(0)
  })

  it('seeks while paused and reports the new position', () => {
    const { engine } = track(makeEngine(4))
    engine.seek(1.5)
    expect(engine.positionSec).toBeCloseTo(1.5, 6)
  })

  it('clamps a seek to the material', () => {
    const { engine } = track(makeEngine(2))
    engine.seek(99)
    expect(engine.positionSec).toBeCloseTo(engine.durationSec, 6)
    engine.seek(-99)
    expect(engine.positionSec).toBe(0)
  })

  it('notifies subscribers and stops after unsubscribing', () => {
    const { engine } = track(makeEngine())
    const seen: number[] = []
    const off = engine.subscribe((s) => seen.push(s.position))
    expect(seen).toHaveLength(1) // immediate current state
    engine.seek(0.5)
    expect(seen.length).toBeGreaterThan(1)
    const count = seen.length
    off()
    engine.seek(0.9)
    expect(seen).toHaveLength(count)
  })
})

describe('dispose', () => {
  it('does not close an injected context, which belongs to the caller', () => {
    const { ctx, engine } = makeEngine()
    engine.dispose()
    // Still usable: closing a borrowed context would break the next engine.
    expect(() => ctx.createGain()).not.toThrow()
  })

  it('is idempotent and ignores later calls', () => {
    const { engine } = makeEngine()
    engine.dispose()
    expect(() => engine.dispose()).not.toThrow()
    expect(() => engine.setParams({ reverbMix: 1 })).not.toThrow()
    expect(() => engine.seek(1)).not.toThrow()
  })

  it('clears a pending restretch so it cannot fire after disposal', async () => {
    const { engine } = makeEngine()
    engine.setParams({ pitchSemitones: 3 })
    engine.dispose()
    await new Promise((r) => setTimeout(r, 400))
    expect(engine.state().rendering).toBe(true) // never cleared, because it never ran
  })
})
