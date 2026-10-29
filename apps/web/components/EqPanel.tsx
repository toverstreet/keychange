'use client'

import { EQ_BANDS, PARAM_RANGES, TONE_PRESETS, type Params } from '@keychange/contract'
import { Panel } from './Panel'

const PRESET_LABELS: Record<string, string> = {
  flat: 'Flat',
  bass: 'Bass',
  vocals: 'Vocals',
  treble: 'Treble',
  warm: 'Warm',
  bright: 'Bright',
  loudness: 'Loudness',
}

function bandLabel(hz: number): string {
  return hz >= 1000 ? `${hz / 1000}k` : String(hz)
}

export function EqPanel({
  params,
  onChange,
  disabled,
}: {
  params: Params
  onChange: (p: Partial<Params>) => void
  disabled?: boolean
}) {
  const setBand = (index: number, value: number) => {
    const next = [...params.eqGainsDb]
    next[index] = value
    onChange({ eqGainsDb: next })
  }

  const activePreset = Object.entries(TONE_PRESETS).find(([, gains]) =>
    gains.every((g, i) => g === params.eqGainsDb[i]),
  )?.[0]

  return (
    <Panel
      legend="Equaliser"
      right={
        <div className="flex gap-1 flex-wrap">
          {Object.keys(TONE_PRESETS).map((name) => (
            <button
              key={name}
              className={`btn ${activePreset === name ? 'btn-on' : ''}`}
              style={{ padding: '5px 9px', letterSpacing: '0.1em' }}
              onClick={() => onChange({ eqGainsDb: [...TONE_PRESETS[name]] })}
              disabled={disabled}
            >
              {PRESET_LABELS[name] ?? name}
            </button>
          ))}
        </div>
      }
    >
      <div className="display px-3 py-4">
        <div className="flex justify-between gap-1">
          {EQ_BANDS.map((hz, i) => (
            <div key={hz} className="flex flex-col items-center gap-2" style={{ flex: 1 }}>
              <span className="readout" style={{ fontSize: 11 }}>
                {params.eqGainsDb[i] > 0 ? '+' : ''}
                {params.eqGainsDb[i].toFixed(0)}
              </span>
              <div className="fader">
                <input
                  type="range"
                  className="vertical"
                  min={PARAM_RANGES.eqGainDb.min}
                  max={PARAM_RANGES.eqGainDb.max}
                  step={PARAM_RANGES.eqGainDb.step}
                  value={params.eqGainsDb[i]}
                  disabled={disabled}
                  onChange={(e) => setBand(i, Number(e.target.value))}
                  onDoubleClick={() => setBand(i, 0)}
                  title="Double-click to reset this band"
                  aria-label={`${bandLabel(hz)} hertz gain`}
                />
              </div>
              <span style={{ color: 'var(--ink-faint)', fontSize: 11, letterSpacing: '0.04em' }}>{bandLabel(hz)}</span>
            </div>
          ))}
        </div>
      </div>
    </Panel>
  )
}
