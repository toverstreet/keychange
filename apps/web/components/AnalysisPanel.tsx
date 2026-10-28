'use client'

import { LOW_CONFIDENCE_THRESHOLD, type AnalysisResult } from '@keypitch/contract'
import { Panel } from './Panel'

export type AnalysisState =
  | { kind: 'idle' }
  | { kind: 'running' }
  | { kind: 'done'; result: AnalysisResult }
  | { kind: 'offline' }
  | { kind: 'error'; message: string }

function Readout({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="display px-4 py-3 flex-1" style={{ minWidth: 120 }}>
      <div className="legend" style={{ marginBottom: 6 }}>
        {label}
      </div>
      <div className="readout" style={{ fontSize: 28, lineHeight: 1 }}>
        {value}
      </div>
      {sub && (
        <div style={{ color: 'var(--ink-faint)', fontSize: 12, marginTop: 6, letterSpacing: '0.04em' }}>{sub}</div>
      )}
    </div>
  )
}

export function AnalysisPanel({ state, onRetry }: { state: AnalysisState; onRetry: () => void }) {
  const lamp =
    state.kind === 'done' ? 'lamp-on' : state.kind === 'running' ? 'lamp-warn' : state.kind === 'idle' ? '' : 'lamp-err'

  return (
    <Panel
      legend="Analysis"
      right={
        <div className="flex items-center gap-2">
          <span className={`lamp ${lamp} ${state.kind === 'running' ? 'pulsing' : ''}`} />
          <span className="legend">
            {state.kind === 'running' ? 'Working' : state.kind === 'done' ? 'Ready' : state.kind === 'offline' ? 'Worker off' : ''}
          </span>
        </div>
      }
    >
      {state.kind === 'done' ? (
        <div className="flex gap-3 flex-wrap">
          <Readout
            label="Key"
            value={`${state.result.key} ${state.result.scale === 'major' ? 'maj' : 'min'}`}
            // A confidently wrong key is worse than an uncertain one when
            // someone is tuning an instrument to it, so the qualifier is shown
            // rather than hidden behind a tooltip.
            sub={
              state.result.keyConfidence < LOW_CONFIDENCE_THRESHOLD
                ? 'low confidence'
                : `confidence ${Math.round(state.result.keyConfidence * 100)}%`
            }
          />
          <Readout
            label="Tempo"
            value={state.result.bpm.toFixed(1)}
            sub={
              state.result.bpmConfidence < LOW_CONFIDENCE_THRESHOLD
                ? 'BPM · low confidence'
                : `BPM · ${state.result.beatGrid.length} beats`
            }
          />
          <Readout label="Pitch" value={`${state.result.pitchHz.toFixed(1)}`} sub="Hz reference" />
          <Readout
            label="Source"
            value={`${(state.result.sampleRate / 1000).toFixed(1)}k`}
            sub="sample rate preserved"
          />
        </div>
      ) : state.kind === 'running' ? (
        <div className="display px-4 py-6 readout pulsing" style={{ fontSize: 16 }}>
          Analysing key, tempo and pitch…
        </div>
      ) : state.kind === 'offline' ? (
        <div className="display px-4 py-4">
          <div style={{ color: 'var(--ink)', fontSize: 15, marginBottom: 8 }}>
            The analysis worker is not running.
          </div>
          <div style={{ color: 'var(--ink-faint)', fontSize: 14, marginBottom: 12, lineHeight: 1.55 }}>
            Everything else still works — playback, pitch, speed, effects and export. Start the worker to get key,
            tempo, beat snapping and stem separation.
          </div>
          <code
            style={{
              display: 'block',
              fontFamily: 'var(--font-azeret), monospace',
              fontSize: 13,
              color: 'var(--amber)',
              background: '#060708',
              border: '1px solid var(--line)',
              borderRadius: 'var(--radius)',
              padding: '8px 10px',
              marginBottom: 12,
            }}
          >
            npm run worker
          </code>
          <button className="btn" onClick={onRetry}>
            Retry
          </button>
        </div>
      ) : state.kind === 'error' ? (
        <div className="display px-4 py-4">
          <div style={{ color: '#ffb3b0', fontSize: 14, marginBottom: 12 }}>{state.message}</div>
          <button className="btn" onClick={onRetry}>
            Retry
          </button>
        </div>
      ) : (
        <div className="display px-4 py-6" style={{ color: 'var(--ink-faint)', fontSize: 14 }}>
          Load a file to analyse it.
        </div>
      )}
    </Panel>
  )
}
