/**
 * The visible window of the waveform, in source seconds.
 *
 * A whole track drawn at once is useless for practice: 509 seconds across 1600
 * buckets is 0.32 s per bucket, while a beat at 135 BPM is 0.44 s. The bar
 * lines are drawn but a bar is barely wider than a pixel column, so loop points
 * can only be placed by number. Zooming is what makes them placeable by eye.
 *
 * Pure functions, so the behaviour that is fiddly to get right -- anchoring a
 * zoom under the cursor, clamping without changing span, following a playhead
 * that jumps backwards on every loop -- is testable without a canvas.
 */
export type View = { start: number; end: number }

/** The tightest zoom. About half a beat at a slow tempo; closer than this and
 *  there is nothing musical left to see. */
export const MIN_SPAN_SEC = 0.25

export function spanOf(view: View): number {
  return view.end - view.start
}

/**
 * Bring a view inside the material.
 *
 * Slides rather than shrinks: a view pushed past an edge keeps its span and
 * moves, because a zoom level the user chose should survive panning into a
 * corner.
 */
export function clampView(view: View, duration: number): View {
  if (duration <= 0) return { start: 0, end: 0 }

  let span = spanOf(view)
  if (!Number.isFinite(span) || span <= 0) span = MIN_SPAN_SEC
  span = Math.min(duration, Math.max(MIN_SPAN_SEC, span))

  let start = Number.isFinite(view.start) ? view.start : 0
  start = Math.min(Math.max(0, start), duration - span)

  return { start, end: start + span }
}

/**
 * Scale the view about a fixed point in time.
 *
 * `factor` below 1 zooms in. The anchored second keeps its position within the
 * view, which is what makes wheel-zoom feel like it is pointing at something
 * rather than drifting.
 */
export function zoomAt(view: View, factor: number, anchorSec: number, duration: number): View {
  const span = spanOf(view)
  if (span <= 0) return clampView(view, duration)

  const anchor = Math.min(Math.max(anchorSec, view.start), view.end)
  const fraction = (anchor - view.start) / span

  const nextSpan = Math.min(duration, Math.max(MIN_SPAN_SEC, span * factor))
  return clampView({ start: anchor - fraction * nextSpan, end: anchor + (1 - fraction) * nextSpan }, duration)
}

/** Frame a region with a margin, so a loop reads as sitting inside its context
 *  rather than filling the pane edge to edge. */
export function fitRegion(a: number, b: number, duration: number, margin = 0.18): View {
  const lo = Math.min(a, b)
  const hi = Math.max(a, b)
  const pad = Math.max(MIN_SPAN_SEC * 0.5, (hi - lo) * margin)
  return clampView({ start: lo - pad, end: hi + pad }, duration)
}

/**
 * Keep the playhead in view while playing.
 *
 * Scrolls only once the playhead nears an edge, rather than centring it
 * continuously: a waveform that slides under a stationary playhead is much
 * harder to read than one that holds still and jumps. A playhead behind the
 * view -- which happens on every loop return -- recentres instead.
 */
export function followPlayhead(view: View, position: number, duration: number, edge = 0.12): View {
  const span = spanOf(view)
  if (span >= duration) return view

  if (position < view.start) {
    return clampView({ start: position - span * 0.25, end: position + span * 0.75 }, duration)
  }

  const trigger = view.end - span * edge
  if (position >= trigger) {
    const shift = position - trigger
    return clampView({ start: view.start + shift, end: view.end + shift }, duration)
  }

  return view
}
