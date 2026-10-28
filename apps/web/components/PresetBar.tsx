'use client'

import { DEFAULT_PARAMS, STYLE_PRESETS, STYLE_PRESET_LABELS, type Params } from '@keypitch/contract'
import { Panel } from './Panel'

export function PresetBar({
  params,
  onChange,
  onShare,
  shareState,
  disabled,
}: {
  params: Params
  onChange: (p: Partial<Params>) => void
  onShare: () => void
  shareState: 'idle' | 'copied'
  disabled?: boolean
}) {
  const matches = (preset: Partial<Params>) =>
    Object.entries(preset).every(([k, v]) => {
      const current = params[k as keyof Params]
      return Array.isArray(v) ? JSON.stringify(v) === JSON.stringify(current) : v === current
    })

  return (
    <Panel
      legend="Styles"
      right={
        <button className="btn" onClick={onShare} disabled={disabled}>
          {shareState === 'copied' ? '✓ Link copied' : 'Copy settings link'}
        </button>
      }
    >
      <div className="flex flex-wrap gap-2">
        {Object.entries(STYLE_PRESETS).map(([key, preset]) => (
          <button
            key={key}
            className={`btn btn-lg ${matches(preset) ? 'btn-on' : ''}`}
            onClick={() => onChange(preset)}
            disabled={disabled}
          >
            {STYLE_PRESET_LABELS[key] ?? key}
          </button>
        ))}
        <button
          className="btn btn-lg"
          onClick={() => onChange({ ...DEFAULT_PARAMS, loop: params.loop })}
          disabled={disabled}
          title="Reset everything except the loop"
        >
          Reset all
        </button>
      </div>
    </Panel>
  )
}
