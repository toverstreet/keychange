'use client'

import { formatTime } from '@/lib/format'

export function Transport({
  playing,
  position,
  duration,
  rendering,
  onToggle,
  onSeek,
  onBack,
}: {
  playing: boolean
  position: number
  duration: number
  rendering: boolean
  onToggle: () => void
  onSeek: (sec: number) => void
  onBack: () => void
}) {
  return (
    <div className="flex items-center gap-5 flex-wrap">
      <button
        className="btn btn-transport"
        onClick={onToggle}
        aria-label={playing ? 'Pause' : 'Play'}
        title={playing ? 'Pause (space)' : 'Play (space)'}
      >
        {playing ? (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
            <rect x="6" y="4" width="4" height="16" rx="1" />
            <rect x="14" y="4" width="4" height="16" rx="1" />
          </svg>
        ) : (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
            <path d="M7 4l13 8-13 8z" />
          </svg>
        )}
      </button>

      <button className="btn" onClick={onBack} title="Back to start">
        ⟲ Start
      </button>
      <button className="btn" onClick={() => onSeek(Math.max(0, position - 5))} title="Back 5 seconds">
        −5s
      </button>

      <div className="display px-4 py-2" style={{ minWidth: 190 }}>
        <div className="readout" style={{ fontSize: 24, lineHeight: 1.1 }}>
          {formatTime(position)}
          <span style={{ color: 'var(--amber-dim)', fontSize: 15 }}> / {formatTime(duration)}</span>
        </div>
      </div>

      {rendering && (
        <span className="legend pulsing" style={{ color: 'var(--amber)' }}>
          ● Rendering
        </span>
      )}
    </div>
  )
}
