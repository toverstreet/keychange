'use client'

import { formatTime } from '@/lib/format'
import { Panel } from './Panel'

export type ExportScope = 'full' | 'loop'

export type ExportState =
  | { kind: 'idle' }
  | { kind: 'working'; label: string; progress: number }
  | { kind: 'done'; filename: string }
  | { kind: 'error'; message: string }

export function ExportPanel({
  state,
  onExport,
  disabled,
  scope,
  onScope,
  loopSeconds,
  fullSeconds,
}: {
  state: ExportState
  onExport: (format: 'wav' | 'mp3') => void
  disabled?: boolean
  scope: ExportScope
  onScope: (scope: ExportScope) => void
  /** Null when no loop is set, which hides the choice entirely. */
  loopSeconds: number | null
  fullSeconds: number
}) {
  const working = state.kind === 'working'

  return (
    <Panel
      legend="Export"
      right={
        <span className="legend">
          {state.kind === 'done' ? 'written' : working ? `${Math.round(state.progress * 100)}%` : ''}
        </span>
      }
    >
      {loopSeconds !== null && (
        // Shown only when a loop exists, and never applied silently: exporting
        // just the loop because one happens to be set would blindside anyone
        // who left one behind from practising.
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <span className="legend">Range</span>
          <button
            className={`btn ${scope === 'loop' ? 'btn-on' : ''}`}
            onClick={() => onScope('loop')}
            disabled={disabled || working}
          >
            Loop · {formatTime(loopSeconds)}
          </button>
          <button
            className={`btn ${scope === 'full' ? 'btn-on' : ''}`}
            onClick={() => onScope('full')}
            disabled={disabled || working}
          >
            Full track · {formatTime(fullSeconds)}
          </button>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 mb-3">
        <button className="btn btn-lg" onClick={() => onExport('mp3')} disabled={disabled || working}>
          Export MP3
        </button>
        <button className="btn btn-lg" onClick={() => onExport('wav')} disabled={disabled || working}>
          Export WAV
        </button>
      </div>

      {working && (
        <div>
          <div className="display" style={{ height: 10, padding: 0 }}>
            <div
              style={{
                height: '100%',
                width: `${Math.max(2, state.progress * 100)}%`,
                background: 'linear-gradient(90deg, var(--amber-dim), var(--amber))',
                boxShadow: '0 0 12px var(--amber-glow)',
                transition: 'width 180ms linear',
              }}
            />
          </div>
          <div className="legend pulsing" style={{ marginTop: 8, color: 'var(--amber)' }}>
            {state.label}
          </div>
        </div>
      )}

      {state.kind === 'done' && (
        <div className="readout" style={{ fontSize: 14 }}>
          ✓ {state.filename}
        </div>
      )}

      {state.kind === 'error' && (
        <div style={{ color: '#ffb3b0', fontSize: 14 }}>{state.message}</div>
      )}

      {state.kind === 'idle' && (
        <p style={{ color: 'var(--ink-faint)', fontSize: 13, lineHeight: 1.5 }}>
          Rendered through the same effect chain you are hearing, at the file&apos;s own sample rate. WAV is 32-bit
          float; MP3 is 192 kbps.
          {loopSeconds !== null && scope === 'loop' && ' Clip edges get a 5 ms fade so they do not click.'}
        </p>
      )}
    </Panel>
  )
}
