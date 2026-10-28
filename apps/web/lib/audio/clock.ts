/**
 * Playback position arithmetic.
 *
 * Extracted as pure functions because this is the trickiest reasoning in the
 * project and it is easy to get subtly wrong: positions are expressed in
 * *source* seconds everywhere in the app, while the stretched buffer that is
 * actually playing runs on a source/speed clock.
 */

export type Anchor = {
  /** Source-time position where the current playback run began. */
  sourceSec: number
  /** Context time when the current playback run began. */
  ctxTime: number
  /** Speed in effect since the anchor was set. */
  speed: number
}

/** Source position now, given the anchor the current run started from. */
export function sourcePositionAt(anchor: Anchor, nowCtxTime: number, durationSec: number): number {
  const elapsedStretched = nowCtxTime - anchor.ctxTime
  const pos = anchor.sourceSec + elapsedStretched * anchor.speed
  return Math.min(durationSec, Math.max(0, pos))
}

/**
 * Re-anchor before a speed change.
 *
 * Without this the new speed is retroactively applied to time that was already
 * played at the old speed, so the reported position jumps by
 * `elapsed x (newSpeed - oldSpeed)` the instant the slider moves -- and because
 * the restretch is debounced, playback then *restarts* at that wrong position.
 * Dragging the speed slider slowly accumulates the error across the whole drag.
 */
export function reanchorForSpeedChange(
  anchor: Anchor,
  nowCtxTime: number,
  newSpeed: number,
  durationSec: number,
): Anchor {
  return {
    sourceSec: sourcePositionAt(anchor, nowCtxTime, durationSec),
    ctxTime: nowCtxTime,
    speed: newSpeed,
  }
}

/** Offset into the stretched buffer for a given source position. */
export function stretchedOffset(sourceSec: number, speed: number): number {
  return sourceSec / speed
}
