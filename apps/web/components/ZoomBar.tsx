'use client'

import { spanOf, type View } from '@/lib/audio/viewport'
import { formatTime } from '@/lib/format'

export function ZoomBar({
  view,
  duration,
  hasLoop,
  following,
  onZoom,
  onFitLoop,
  onFitAll,
  onToggleFollow,
}: {
  view: View
  duration: number
  hasLoop: boolean
  following: boolean
  onZoom: (factor: number) => void
  onFitLoop: () => void
  onFitAll: () => void
  onToggleFollow: () => void
}) {
  const span = spanOf(view)
  const zoomed = span < duration - 0.001

  return (
    <div className="flex flex-wrap items-center gap-2 mt-3">
      <span className="legend">Zoom</span>
      <button className="btn" style={{ padding: '6px 11px' }} onClick={() => onZoom(0.5)} title="Zoom in">
        +
      </button>
      <button className="btn" style={{ padding: '6px 11px' }} onClick={() => onZoom(2)} title="Zoom out">
        −
      </button>
      <button className="btn" onClick={onFitLoop} disabled={!hasLoop} title="Frame the loop">
        Fit loop
      </button>
      <button className="btn" onClick={onFitAll} disabled={!zoomed}>
        Whole track
      </button>

      <button
        className={`btn ${following ? 'btn-on' : ''}`}
        onClick={onToggleFollow}
        title="Scroll the view to keep the playhead visible"
      >
        Follow
      </button>

      <span className="readout" style={{ fontSize: 13, marginLeft: 4 }}>
        {formatTime(view.start)} – {formatTime(view.end)}
      </span>
      <span style={{ color: 'var(--ink-faint)', fontSize: 12 }}>
        {zoomed ? 'scroll to zoom · ⌘-drag to pan' : 'scroll to zoom'}
      </span>
    </div>
  )
}
