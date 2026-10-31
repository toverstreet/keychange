'use client'

import type { Params } from '@keychange/contract'
import { formatSpan } from '@/lib/format'
import { Panel } from './Panel'
import { barLines } from '@/lib/audio/snap'
import { snapLabel, type SnapMode } from '@/lib/audio/selection'
import { TimeField } from './TimeField'

export function LoopBar({
  params,
  position,
  duration,
  beatGrid,
  snapMode,
  beatsPerBar,
  onChange,
  onCycleSnap,
  onSetLoopEnd,
  onSetBeatsPerBar,
  onLoopBars,
  disabled,
}: {
  params: Params
  position: number
  duration: number
  beatGrid: number[]
  snapMode: SnapMode
  beatsPerBar: number
  onChange: (p: Partial<Params>) => void
  onCycleSnap: () => void
  /** Set one end to an exact time, unsnapped. */
  onSetLoopEnd: (which: 'a' | 'b', sec: number) => void
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
          <span className="legend">{loop ? `${formatSpan(loop.b - loop.a)} long` : 'off'}</span>
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
        <button
          className={`btn ${snapMode !== 'off' ? 'btn-on' : ''}`}
          onClick={onCycleSnap}
          disabled={disabled || !hasGrid}
          title="Off lets a selection start and end anywhere, not only on the grid"
        >
          Snap: {snapLabel(snapMode)}
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
          <div className="flex items-center gap-2">
            <TimeField label="A" seconds={loop.a} onCommit={(sec) => onSetLoopEnd('a', sec)} disabled={disabled} />
            <span style={{ color: 'var(--ink-faint)' }}>→</span>
            <TimeField label="B" seconds={loop.b} onCommit={(sec) => onSetLoopEnd('b', sec)} disabled={disabled} />
          </div>
        )}
      </div>

      <p style={{ color: 'var(--ink-faint)', fontSize: 13, marginTop: 12, lineHeight: 1.5 }}>
        Drag across the waveform to select any section, of any length; the selection is the loop, and Export can
        write just that section.{' '}
        {hasGrid
          ? snapMode === 'off'
            ? `Snapping is off, so a boundary sits exactly where you put it. Turn it back on to land on the ${bars} detected bars.`
            : `Ends snap to the ${bars} detected bars, so a loop starts on a downbeat instead of near one -- hold Alt while dragging, or set Snap to Off, to place one between beats.`
          : 'Start the worker to snap loop ends to the detected beat grid.'}{' '}
        Shift-click sets A, alt-click sets B, and the A/B fields take an exact time.
      </p>
    </Panel>
  )
}
