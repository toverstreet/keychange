'use client'

import { useState } from 'react'
import { formatTimeExact, parseTime } from '@/lib/audio/selection'

/**
 * An editable `m:ss.mmm`.
 *
 * Edits are held in a draft while typing -- committing on every keystroke would
 * move the loop to 0 the moment the field is cleared -- and applied on blur or
 * Enter. With no draft the field simply shows the loop, so dragging on the
 * waveform shows up here without an effect to sync it. Unreadable text reverts
 * rather than guessing, and Escape abandons.
 */
export function TimeField({
  seconds,
  label,
  onCommit,
  disabled,
}: {
  seconds: number
  label: string
  onCommit: (sec: number) => void
  disabled?: boolean
}) {
  const [draft, setDraft] = useState<string | null>(null)
  const text = draft ?? formatTimeExact(seconds)

  const commit = () => {
    setDraft(null)
    if (draft === null) return
    const parsed = parseTime(draft)
    if (parsed !== null) onCommit(parsed)
  }

  return (
    <label className="flex items-center gap-1">
      <span className="legend">{label}</span>
      <input
        className="readout"
        style={{ width: '9ch', fontSize: 15, padding: '4px 6px', textAlign: 'center' }}
        value={text}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') return e.currentTarget.blur()
          if (e.key === 'Escape') {
            setDraft(null)
            e.currentTarget.blur()
          }
        }}
        disabled={disabled}
        inputMode="decimal"
        aria-label={`${label} time`}
      />
    </label>
  )
}
