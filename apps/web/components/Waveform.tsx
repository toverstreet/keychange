'use client'

import { useCallback, useEffect, useRef } from 'react'
import { barLines } from '@/lib/audio/snap'

export type LoopRegion = { a: number; b: number } | null

/**
 * Waveform, playhead, beat grid and loop region on one canvas.
 *
 * Drawn from the precomputed min/max peak array rather than the AudioBuffer, so
 * a redraw costs the same for an eight-minute file as a ten-second one and the
 * playhead can animate at full frame rate.
 */
export function Waveform({
  peaks,
  durationSec,
  positionSec,
  loop,
  beatGrid,
  beatsPerBar = 4,
  showBars,
  onScrub,
  onSetLoopPoint,
  height = 148,
}: {
  peaks: Float32Array | null
  durationSec: number
  positionSec: number
  loop: LoopRegion
  beatGrid: number[]
  beatsPerBar?: number
  showBars: boolean
  onScrub: (sec: number) => void
  onSetLoopPoint?: (which: 'a' | 'b', sec: number) => void
  height?: number
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    const wrap = wrapRef.current
    if (!canvas || !wrap) return

    const dpr = Math.min(2, window.devicePixelRatio || 1)
    const w = wrap.clientWidth
    const h = height
    if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
      canvas.width = w * dpr
      canvas.height = h * dpr
      canvas.style.width = `${w}px`
      canvas.style.height = `${h}px`
    }

    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, w, h)

    const mid = h / 2
    const xOf = (sec: number) => (durationSec > 0 ? (sec / durationSec) * w : 0)

    // Loop region sits behind the waveform so it reads as highlighted tape.
    if (loop) {
      const x1 = xOf(loop.a)
      const x2 = xOf(loop.b)
      ctx.fillStyle = 'rgba(57, 208, 196, 0.13)'
      ctx.fillRect(x1, 0, Math.max(1, x2 - x1), h)
      ctx.fillStyle = 'rgba(57, 208, 196, 0.85)'
      ctx.fillRect(x1 - 1, 0, 2, h)
      ctx.fillRect(x2 - 1, 0, 2, h)
    }

    // Bar lines from the analysed grid. This is the visible payoff of the
    // worker returning beats rather than only a tempo.
    if (showBars && beatGrid.length > 1) {
      const lines = barLines(beatGrid, beatsPerBar)
      // Skip drawing when bars would be denser than a few pixels apart.
      const spacing = lines.length > 1 ? xOf(lines[1]) - xOf(lines[0]) : w
      if (spacing > 5) {
        ctx.strokeStyle = 'rgba(255, 182, 39, 0.16)'
        ctx.lineWidth = 1
        ctx.beginPath()
        for (const t of lines) {
          const x = Math.round(xOf(t)) + 0.5
          ctx.moveTo(x, 0)
          ctx.lineTo(x, h)
        }
        ctx.stroke()
      }
    }

    // Centre line
    ctx.strokeStyle = 'rgba(255,255,255,0.07)'
    ctx.beginPath()
    ctx.moveTo(0, mid + 0.5)
    ctx.lineTo(w, mid + 0.5)
    ctx.stroke()

    if (peaks && peaks.length >= 2) {
      const buckets = peaks.length / 2
      const playedX = xOf(positionSec)
      for (let i = 0; i < buckets; i++) {
        const x = (i / buckets) * w
        const min = peaks[i * 2]
        const max = peaks[i * 2 + 1]
        const y1 = mid - max * (h / 2 - 6)
        const y2 = mid - min * (h / 2 - 6)
        // Played portion in amber, unplayed in cool grey: position is readable
        // at a glance without hunting for the playhead.
        ctx.fillStyle = x <= playedX ? 'rgba(255, 182, 39, 0.92)' : 'rgba(150, 163, 174, 0.5)'
        ctx.fillRect(x, y1, Math.max(1, w / buckets - 0.5), Math.max(1, y2 - y1))
      }
    }

    // Playhead
    const px = Math.round(xOf(positionSec)) + 0.5
    ctx.strokeStyle = '#ff4b45'
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.moveTo(px, 0)
    ctx.lineTo(px, h)
    ctx.stroke()
    ctx.fillStyle = '#ff4b45'
    ctx.beginPath()
    ctx.moveTo(px - 5, 0)
    ctx.lineTo(px + 5, 0)
    ctx.lineTo(px, 7)
    ctx.closePath()
    ctx.fill()
  }, [peaks, durationSec, positionSec, loop, beatGrid, beatsPerBar, showBars, height])

  useEffect(() => {
    draw()
  }, [draw])

  useEffect(() => {
    const onResize = () => draw()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [draw])

  const secondsAt = (clientX: number): number => {
    const wrap = wrapRef.current
    if (!wrap || durationSec <= 0) return 0
    const rect = wrap.getBoundingClientRect()
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
    return ratio * durationSec
  }

  return (
    <div
      ref={wrapRef}
      className="display"
      style={{ height, cursor: 'crosshair', userSelect: 'none' }}
      onPointerDown={(e) => {
        const sec = secondsAt(e.clientX)
        // Shift/alt set loop ends in place rather than needing separate handles,
        // which matters when the point you want is a bar line you can see.
        if (e.shiftKey && onSetLoopPoint) onSetLoopPoint('a', sec)
        else if (e.altKey && onSetLoopPoint) onSetLoopPoint('b', sec)
        else onScrub(sec)
      }}
    >
      <canvas ref={canvasRef} style={{ display: 'block' }} />
    </div>
  )
}
