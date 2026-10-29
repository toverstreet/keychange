'use client'

import { PARAM_RANGES, type Params } from '@keychange/contract'
import { Panel } from './Panel'

export function ReverbPanel({
  params,
  onChange,
  disabled,
}: {
  params: Params
  onChange: (p: Partial<Params>) => void
  disabled?: boolean
}) {
  return (
    <Panel legend="Space">
      <div className="grid gap-5" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
        <div>
          <div className="flex items-baseline justify-between mb-2">
            <span className="legend">Reverb</span>
            <span className="readout" style={{ fontSize: 19 }}>
              {Math.round(params.reverbMix * 100)}%
            </span>
          </div>
          <input
            type="range"
            min={PARAM_RANGES.reverbMix.min}
            max={PARAM_RANGES.reverbMix.max}
            step={PARAM_RANGES.reverbMix.step}
            value={params.reverbMix}
            disabled={disabled}
            onChange={(e) => onChange({ reverbMix: Number(e.target.value) })}
            aria-label="Reverb mix"
          />
          <div style={{ color: 'var(--ink-faint)', fontSize: 13, marginTop: 8 }}>equal-power dry/wet</div>
        </div>

        <div>
          <div className="legend mb-2">8D rotation</div>
          <button
            className={`btn btn-lg ${params.eightD ? 'btn-on' : ''}`}
            onClick={() => onChange({ eightD: !params.eightD })}
            disabled={disabled}
          >
            {params.eightD ? '● Rotating' : 'Engage 8D'}
          </button>
          <div style={{ color: 'var(--ink-faint)', fontSize: 13, marginTop: 8 }}>
            one rotation every 10 seconds
          </div>
        </div>
      </div>
    </Panel>
  )
}
