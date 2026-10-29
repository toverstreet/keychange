'use client'

import { PARAM_RANGES, type Params } from '@keychange/contract'
import { formatSemitones } from '@/lib/format'
import { Panel } from './Panel'

const SEMITONE_NAMES = ['unison', 'half step', 'whole step', 'minor 3rd', 'major 3rd', 'perfect 4th', 'tritone', 'perfect 5th']

function intervalName(n: number): string {
  const abs = Math.abs(Math.round(n))
  if (abs === 0) return 'original key'
  const name = SEMITONE_NAMES[abs] ?? `${abs} semitones`
  return `${name} ${n > 0 ? 'up' : 'down'}`
}

export function PitchSpeed({
  params,
  onChange,
  disabled,
}: {
  params: Params
  onChange: (p: Partial<Params>) => void
  disabled?: boolean
}) {
  return (
    <Panel legend="Pitch & Speed">
      <div className="grid gap-5" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
        <div>
          <div className="flex items-baseline justify-between mb-2">
            <span className="legend">Transpose</span>
            <span className="readout" style={{ fontSize: 19 }}>
              {formatSemitones(params.pitchSemitones)} st
            </span>
          </div>
          <input
            type="range"
            min={PARAM_RANGES.pitchSemitones.min}
            max={PARAM_RANGES.pitchSemitones.max}
            step={PARAM_RANGES.pitchSemitones.step}
            value={params.pitchSemitones}
            disabled={disabled}
            onChange={(e) => onChange({ pitchSemitones: Number(e.target.value) })}
            aria-label="Transpose in semitones"
          />
          <div className="flex items-center justify-between mt-2">
            <span style={{ color: 'var(--ink-faint)', fontSize: 13 }}>{intervalName(params.pitchSemitones)}</span>
            <button className="btn" style={{ padding: '4px 9px' }} onClick={() => onChange({ pitchSemitones: 0 })} disabled={disabled}>
              Reset
            </button>
          </div>
        </div>

        <div>
          <div className="flex items-baseline justify-between mb-2">
            <span className="legend">Speed</span>
            <span className="readout" style={{ fontSize: 19 }}>
              {params.speed.toFixed(2)}×
            </span>
          </div>
          <input
            type="range"
            min={PARAM_RANGES.speed.min}
            max={PARAM_RANGES.speed.max}
            step={PARAM_RANGES.speed.step}
            value={params.speed}
            disabled={disabled}
            onChange={(e) => onChange({ speed: Number(e.target.value) })}
            aria-label="Playback speed"
          />
          <div className="flex items-center justify-between mt-2">
            <span style={{ color: 'var(--ink-faint)', fontSize: 13 }}>pitch unaffected</span>
            <div className="flex gap-1">
              {[0.75, 0.85, 1].map((s) => (
                <button
                  key={s}
                  className={`btn ${params.speed === s ? 'btn-on' : ''}`}
                  style={{ padding: '4px 9px' }}
                  onClick={() => onChange({ speed: s })}
                  disabled={disabled}
                >
                  {s === 1 ? '1×' : `${s}×`}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </Panel>
  )
}
