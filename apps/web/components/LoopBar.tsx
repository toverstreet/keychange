'use client'

import type { Params } from '@keychange/contract'
import { formatTime } from '@/lib/format'
import { Panel } from './Panel'
import { barLines } from '@/lib/audio/snap'

export function LoopBar({
  params,
  position,
  duration,
  beatGrid,
  snapBars,
  beatsPerBar,
  onChange,
  onToggleSnapBars,
  onSetBeatsPerBar,
  onLoopBars,
  disabled,
}: {
  params: Params
  position: number
  duration: number
  beatGrid: number[]
  snapBars: boolean
  beatsPerBar: number
  onChange: (p: Partial<Params>) => void
  onToggleSnapBars: () => void
  onSetBeatsPerBar: (n: number) => void
  onLoopBars: (bars: number) => void
  disabled?: boolean
}) {
  const loop = params.loop
  const hasGrid = beatGrid.length > 1
  const bars = hasGrid ? barLines(beatGrid, beatsPerBar).length : 0

  return (
    <Panel
      legend="A/B Loop"
      right={
        <div className="flex items-center gap-2">
          <span className={`lamp ${loop ? 'lamp-on' : ''}`} />
          <span className="legend">{loop ? `${formatTime(loop.b - loop.a)} long` : 'off'}</span>
        </div>
      }
    >
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <button className="btn" onClick={() => onChange({ loop: { a: position, b: loop?.b ?? Math.min(duration, position + 8) } })} disabled={disabled}>
          Set A here
        </button>
        <button className="btn" onClick={() => onChange({ loop: { a: loop?.a ?? 0, b: position } })} disabled={disabled}>
          Set B here
        </button>
        <button className="btn" onClick={() => onChange({ loop: null })} disabled={disabled || !loop}>
          Clear
        </button>

        <span className="legend" style={{ marginLeft: 8 }}>Loop from here:</span>
        {[1, 2, 4, 8].map((n) => (
          <button
            key={n}
            className="btn"
            style={{ padding: '6px 10px' }}
            onClick={() => onLoopBars(n)}
            disabled={disabled || !hasGrid}
            title={hasGrid ? `Loop ${n} bar${n > 1 ? 's' : ''} from the nearest bar line` : 'Needs analysis'}
          >
            {n} bar{n > 1 ? 's' : ''}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button className={`btn ${snapBars ? 'btn-on' : ''}`} onClick={onToggleSnapBars} disabled={disabled || !hasGrid}>
          Snap: {snapBars ? 'Bars' : 'Beats'}
        </button>

        <div className="flex items-center gap-1">
          <span className="legend">Beats / bar</span>
          {[3, 4, 6].map((n) => (
            <button
              key={n}
              className={`btn ${beatsPerBar === n ? 'btn-on' : ''}`}
              style={{ padding: '6px 10px' }}
              onClick={() => onSetBeatsPerBar(n)}
              disabled={disabled || !hasGrid}
            >
              {n}
            </button>
          ))}
        </div>

        {loop && (
          <span className="readout" style={{ fontSize: 15 }}>
            A {formatTime(loop.a)} → B {formatTime(loop.b)}
          </span>
        )}
      </div>

      <p style={{ color: 'var(--ink-faint)', fontSize: 13, marginTop: 12, lineHeight: 1.5 }}>
        {hasGrid
          ? `Loop points snap to the ${bars} detected bars, so a loop starts on a downbeat instead of near one. Shift-click the waveform to set A, alt-click to set B.`
          : 'Start the worker to snap loop points to the detected beat grid. Shift-click the waveform to set A, alt-click to set B.'}
      </p>
    </Panel>
  )
}
