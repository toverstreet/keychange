'use client'

import { useCallback } from 'react'
import { pollSeparation, separate, stemUrl, WorkerUnreachableError } from '@/lib/worker-client'
import { Panel } from './Panel'

export type StemsState =
  | { kind: 'idle' }
  | { kind: 'working'; progress: number; id: string }
  | { kind: 'done'; id: string }
  | { kind: 'offline' }
  | { kind: 'error'; message: string }

export function StemsPanel({
  state,
  file,
  onState,
  onLoadStem,
  disabled,
}: {
  state: StemsState
  file: File | null
  onState: (s: StemsState) => void
  onLoadStem: (url: string, label: string) => void
  disabled?: boolean
}) {
  const run = useCallback(async () => {
    if (!file) return
    onState({ kind: 'working', progress: 0, id: '' })
    try {
      const job = await separate(file)
      onState({ kind: 'working', progress: 0, id: job.id })
      const finished = await pollSeparation(job.id, {
        onProgress: (p) => onState({ kind: 'working', progress: p, id: job.id }),
      })
      if (finished.status === 'error') {
        onState({ kind: 'error', message: finished.error ?? 'Separation failed.' })
      } else {
        onState({ kind: 'done', id: finished.id })
      }
    } catch (err) {
      if (err instanceof WorkerUnreachableError) onState({ kind: 'offline' })
      else onState({ kind: 'error', message: err instanceof Error ? err.message : 'Separation failed.' })
    }
  }, [file, onState])

  return (
    <Panel
      legend="Stems"
      right={
        <div className="flex items-center gap-2">
          <span
            className={`lamp ${
              state.kind === 'done' ? 'lamp-on' : state.kind === 'working' ? 'lamp-warn' : state.kind === 'idle' ? '' : 'lamp-err'
            } ${state.kind === 'working' ? 'pulsing' : ''}`}
          />
          <span className="legend">
            {state.kind === 'working' ? `${Math.round(state.progress * 100)}%` : state.kind === 'done' ? 'ready' : ''}
          </span>
        </div>
      }
    >
      {state.kind === 'done' ? (
        <div className="grid gap-3">
          {(['vocals', 'instrumental'] as const).map((stem) => (
            <div key={stem} className="display px-3 py-3 flex items-center justify-between gap-3 flex-wrap">
              <span className="readout" style={{ fontSize: 16, textTransform: 'capitalize' }}>
                {stem}
              </span>
              <div className="flex gap-2">
                <a className="btn" href={stemUrl(state.id, stem)} download={`${stem}.wav`}>
                  Download
                </a>
                <button className="btn" onClick={() => onLoadStem(stemUrl(state.id, stem), stem)}>
                  Open in editor
                </button>
              </div>
            </div>
          ))}
          <p style={{ color: 'var(--ink-faint)', fontSize: 13 }}>
            Opening a stem in the editor lets you pitch, slow and loop it like any other file.
          </p>
        </div>
      ) : state.kind === 'working' ? (
        <div>
          <div className="display" style={{ height: 10, padding: 0 }}>
            <div
              style={{
                height: '100%',
                width: `${Math.max(2, state.progress * 100)}%`,
                background: 'linear-gradient(90deg, var(--amber-dim), var(--amber))',
                boxShadow: '0 0 12px var(--amber-glow)',
                transition: 'width 300ms linear',
              }}
            />
          </div>
          <div className="legend pulsing" style={{ marginTop: 8, color: 'var(--amber)' }}>
            Separating — this takes a minute or two
          </div>
        </div>
      ) : state.kind === 'offline' ? (
        <div className="display px-4 py-4" style={{ color: 'var(--ink-faint)', fontSize: 14, lineHeight: 1.55 }}>
          Stem separation needs the worker running. Start it with{' '}
          <code style={{ color: 'var(--amber)', fontFamily: 'var(--font-azeret), monospace' }}>npm run worker</code>.
        </div>
      ) : (
        <div>
          <button className="btn btn-lg" onClick={run} disabled={disabled || !file}>
            Separate vocals &amp; instrumental
          </button>
          {state.kind === 'error' && (
            <div style={{ color: '#ffb3b0', fontSize: 14, marginTop: 10 }}>{state.message}</div>
          )}
          <p style={{ color: 'var(--ink-faint)', fontSize: 13, marginTop: 10, lineHeight: 1.5 }}>
            Runs Demucs locally on the GPU — roughly 10&times; faster than realtime. The result is cached, so
            separating the same file again is instant. Stems come back at 44.1&nbsp;kHz because that is the rate
            the model works at, so unlike export they are not kept at the source rate.
          </p>
        </div>
      )}
    </Panel>
  )
}
