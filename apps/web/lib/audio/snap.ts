/**
 * Snapping loop points to the detected beat grid.
 *
 * This is why the worker returns a beat grid rather than just a BPM. Dragging a
 * loop handle to a musically useful place by eye is fiddly and never quite
 * right; snapping to the analysed beats -- or to bar lines -- is what makes the
 * loop usable for practice rather than approximate.
 */
export type SnapOptions = {
  /** Snap to bar starts rather than individual beats. */
  bars?: boolean
  beatsPerBar?: number
}

/** Beat times that begin a bar. */
export function barLines(grid: number[], beatsPerBar = 4): number[] {
  if (grid.length === 0) return []
  const out: number[] = []
  for (let i = 0; i < grid.length; i += beatsPerBar) out.push(grid[i])
  return out
}

export function nearestBarIndex(seconds: number, grid: number[], beatsPerBar = 4): number {
  const lines = barLines(grid, beatsPerBar)
  if (lines.length === 0) return 0
  let best = 0
  for (let i = 1; i < lines.length; i++) {
    if (Math.abs(lines[i] - seconds) < Math.abs(lines[best] - seconds)) best = i
  }
  return best
}

export function snapToGrid(seconds: number, grid: number[], opts: SnapOptions = {}): number {
  // With fewer than two points there is nothing to snap to, and snapping to a
  // single point would yank every drag to it. Degrade to a no-op -- this is the
  // state the UI is in whenever the worker is unavailable.
  if (grid.length < 2) return seconds

  const candidates = opts.bars ? barLines(grid, opts.beatsPerBar ?? 4) : grid
  if (candidates.length === 0) return seconds

  let best = candidates[0]
  let bestDistance = Math.abs(candidates[0] - seconds)
  for (let i = 1; i < candidates.length; i++) {
    const d = Math.abs(candidates[i] - seconds)
    if (d < bestDistance) {
      bestDistance = d
      best = candidates[i]
    }
  }
  return best
}
