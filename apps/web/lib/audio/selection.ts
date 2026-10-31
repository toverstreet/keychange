/**
 * The selected section of the track, in source seconds.
 *
 * There is only one selection, and it *is* the A/B loop: what you drag across
 * the waveform is what plays round and round, and what an export writes when
 * its range is set to the selection. A second kind of marker that looked the
 * same but meant something else would be worse than useless.
 *
 * Snapping to the beat grid is what makes a loop usable for practice, but it is
 * also what made an arbitrary section impossible to pick -- every point placed
 * on the waveform was yanked to a grid line, so a section could only ever be a
 * whole number of beats. Hence `'off'`: a third snap mode, not a hidden
 * modifier, because "regardless of length" has to be a state you can sit in.
 *
 * Pure functions, so the fiddly parts -- a backwards drag, a drag that snaps to
 * a single point, a typed time -- are testable without a canvas.
 */
import type { Region } from './render'
import { snapToGrid } from './snap'

export type SnapMode = 'bars' | 'beats' | 'off'

/**
 * The shortest selection worth having.
 *
 * Twenty milliseconds is below anything musical and above the point where the
 * engine and the export's edge fades have nothing to work with. It exists only
 * so a stray click or a snap that collapses both ends cannot produce a
 * zero-length loop.
 */
export const MIN_REGION_SEC = 0.02

/** Pixels of travel before a press counts as a selection rather than a seek. */
export const DRAG_THRESHOLD_PX = 4

export function isDrag(dxPixels: number): boolean {
  return Math.abs(dxPixels) > DRAG_THRESHOLD_PX
}

export function nextSnapMode(mode: SnapMode): SnapMode {
  return mode === 'bars' ? 'beats' : mode === 'beats' ? 'off' : 'bars'
}

export function snapLabel(mode: SnapMode): string {
  return mode === 'bars' ? 'Bars' : mode === 'beats' ? 'Beats' : 'Off'
}

/** Snap a time by the active mode. `'off'` returns it untouched, as does any
 *  mode when analysis has not produced a grid. */
export function snapWithMode(seconds: number, mode: SnapMode, grid: number[], beatsPerBar = 4): number {
  if (mode === 'off') return seconds
  return snapToGrid(seconds, grid, { bars: mode === 'bars', beatsPerBar })
}

/**
 * Put two loose times in order, inside the material, and at least
 * `MIN_REGION_SEC` apart.
 *
 * Deliberately has no upper bound: a selection may be two frames or the entire
 * track, and the render path slices before it stretches, so a long one costs
 * what it should.
 */
export function normalizeRegion(a: number, b: number, duration: number): Region | null {
  if (!Number.isFinite(duration) || duration <= 0) return null

  const lo = Math.min(Math.max(0, Math.min(a, b)), duration)
  const hi = Math.min(Math.max(0, Math.max(a, b)), duration)

  if (hi - lo >= MIN_REGION_SEC) return { a: lo, b: hi }

  // Too short: grow forwards, or backwards when there is no room left at the
  // end of the track.
  const min = Math.min(MIN_REGION_SEC, duration)
  if (lo + min <= duration) return { a: lo, b: lo + min }
  return { a: duration - min, b: duration }
}

export type SnapContext = { mode: SnapMode; grid: number[]; beatsPerBar: number }

/** The region a drag across the waveform selects. */
export function regionFromDrag(
  fromSec: number,
  toSec: number,
  duration: number,
  snap: SnapContext,
): Region | null {
  const a = snapWithMode(fromSec, snap.mode, snap.grid, snap.beatsPerBar)
  const b = snapWithMode(toSec, snap.mode, snap.grid, snap.beatsPerBar)
  return normalizeRegion(a, b, duration)
}

/** Seconds as `m:ss.mmm`, or `h:mm:ss.mmm` past an hour. Milliseconds are the
 *  whole point of the typed fields, so they are always shown. */
export function formatTimeExact(sec: number): string {
  const t = Number.isFinite(sec) && sec > 0 ? sec : 0
  const h = Math.floor(t / 3600)
  const m = Math.floor((t % 3600) / 60)
  const s = Math.floor(t % 60)
  const ms = Math.round((t - Math.floor(t)) * 1000)
  // Rounding milliseconds can carry into the next second; re-derive rather than
  // printing "0:07.1000".
  if (ms === 1000) return formatTimeExact(Math.floor(t) + 1)
  const frac = String(ms).padStart(3, '0')
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${frac}`
    : `${m}:${String(s).padStart(2, '0')}.${frac}`
}

/**
 * Read a typed time: `83`, `83.45`, `1:23`, `1:23.45`, `1:02:03.5`.
 *
 * Returns null rather than a guess for anything else, so a half-typed field
 * leaves the loop where it is instead of jumping to zero.
 */
export function parseTime(text: string): number | null {
  const s = text.trim()
  if (!s) return null

  const parts = s.split(':')
  if (parts.length > 3) return null
  if (!parts.every((p) => /^\d*\.?\d+$/.test(p))) return null

  const nums = parts.map(Number)
  if (nums.some((n) => !Number.isFinite(n))) return null
  // Only the leading field may run past 59 -- "1:75" is a typo, not 135
  // seconds, and silently accepting it would move the loop somewhere the user
  // did not ask for.
  if (nums.slice(1).some((n) => n >= 60)) return null

  const seconds = nums.reduce((acc, n) => acc * 60 + n, 0)
  return seconds >= 0 ? seconds : null
}
