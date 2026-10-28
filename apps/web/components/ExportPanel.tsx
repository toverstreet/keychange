'use client'

import { Panel } from './Panel'

export type ExportState =
  | { kind: 'idle' }
  | { kind: 'working'; label: string; progress: number }
  | { kind: 'done'; filename: string }
  | { kind: 'error'; message: string }

export function ExportPanel({
  state,
  onExport,
  disabled,
}: {
  state: ExportState
  onExport: (format: 'wav' | 'mp3') => void
  disabled?: boolean
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
        </p>
      )}
    </Panel>
  )
}
