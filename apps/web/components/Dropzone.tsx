'use client'

import { useCallback, useRef, useState } from 'react'
import { formatBytes } from '@/lib/format'

export function Dropzone({
  onFile,
  busy,
  error,
}: {
  onFile: (file: File) => void
  busy?: string | null
  error?: string | null
}) {
  const [over, setOver] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const take = useCallback(
    (list: FileList | null) => {
      const file = list?.[0]
      if (file) onFile(file)
    },
    [onFile],
  )

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault()
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setOver(false)
        take(e.dataTransfer.files)
      }}
      className="rack rise"
      style={{ padding: 0 }}
    >
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={!!busy}
        className="w-full text-left"
        style={{
          padding: '56px 32px',
          background: over ? 'rgba(255,182,39,0.05)' : 'transparent',
          borderRadius: 'var(--radius)',
          cursor: busy ? 'wait' : 'pointer',
          transition: 'background 160ms ease',
        }}
      >
        <div className="flex items-center gap-5">
          <div
            className="display grid place-items-center"
            style={{ width: 68, height: 68, flex: 'none' }}
            aria-hidden
          >
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="var(--amber)" strokeWidth="1.6">
              <path d="M12 17V3M12 3l-4.5 4.5M12 3l4.5 4.5" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M3 15v4a2 2 0 002 2h14a2 2 0 002-2v-4" strokeLinecap="round" />
            </svg>
          </div>
          <div>
            <div style={{ fontSize: 22, fontWeight: 600, letterSpacing: '0.01em' }}>
              {busy ? busy : 'Load an audio file'}
            </div>
            <div style={{ color: 'var(--ink-faint)', fontSize: 14, marginTop: 4 }}>
              Drop it here or click to browse · mp3, wav, m4a, mp4, flac, aiff
            </div>
            <div style={{ color: 'var(--ink-faint)', fontSize: 13, marginTop: 10, lineHeight: 1.5 }}>
              No size or length limit. Your audio never leaves this machine.
            </div>
          </div>
        </div>
      </button>

      <input
        ref={inputRef}
        type="file"
        accept="audio/*,video/mp4,.m4a,.aiff,.flac"
        className="hidden"
        onChange={(e) => take(e.target.files)}
      />

      {error && (
        <div
          style={{
            margin: '0 16px 16px',
            padding: '10px 12px',
            borderRadius: 'var(--radius)',
            background: 'rgba(255,75,69,0.09)',
            border: '1px solid rgba(255,75,69,0.3)',
            color: '#ffb3b0',
            fontSize: 14,
          }}
        >
          {error}
        </div>
      )}
    </div>
  )
}

export function FileBadge({ name, size }: { name: string; size: number }) {
  return (
    <span style={{ color: 'var(--ink-faint)', fontSize: 13 }}>
      {name} · {formatBytes(size)}
    </span>
  )
}
