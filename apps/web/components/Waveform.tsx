'use client'

import { useCallback, useEffect, useRef } from 'react'
import { barLines } from '@/lib/audio/snap'
import { spanOf, type View } from '@/lib/audio/viewport'

export type LoopRegion = { a: number; b: number } | null

/**
 * Waveform, playhead, beat grid and loop region on one canvas.
 *
 * Drawn from a precomputed min/max peak array covering the *visible window*, so
 * zooming in reveals real detail rather than magnifying the same buckets. The
 * static content is cached to an offscreen canvas and only the playhead is
 * repainted per frame.
 */
export function Waveform({
  peaks,
  view,
  durationSec,
  positionSec,
  loop,
  beatGrid,
  beatsPerBar = 4,
  showBars,
  onScrub,
  onSetLoopPoint,
  onZoom,
  onPan,
  height = 148,
}: {
  peaks: Float32Array | null
  /** Visible window in source seconds. */
  view: View
  durationSec: number
  positionSec: number
  loop: LoopRegion
  beatGrid: number[]
  beatsPerBar?: number
  showBars: boolean
  onScrub: (sec: number) => void
  onSetLoopPoint?: (which: 'a' | 'b', sec: number) => void
  onZoom?: (factor: number, anchorSec: number) => void
  onPan?: (deltaSec: number) => void
  height?: number
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const staticLayer = useRef<HTMLCanvasElement | null>(null)
  const staticKey = useRef<string>('')
  const drag = useRef<{ x: number; startView: number } | null>(null)

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
    const span = Math.max(1e-6, spanOf(view))
    const xOf = (sec: number) => ((sec - view.start) / span) * w

    const key = [w, h, dpr, view.start, view.end, loop?.a, loop?.b, showBars, beatsPerBar, beatGrid.length, peaks?.length].join('|')
    if (!staticLayer.current || staticKey.current !== key) {
      const layer = staticLayer.current ?? document.createElement('canvas')
      layer.width = canvas.width
      layer.height = canvas.height
      const lctx = layer.getContext('2d')
      if (lctx) {
        lctx.setTransform(dpr, 0, 0, dpr, 0, 0)
        lctx.clearRect(0, 0, w, h)
        paintStatic(lctx, w, h, mid, xOf)
      }
      staticLayer.current = layer
      staticKey.current = key
    }

    function paintStatic(
      ctx: CanvasRenderingContext2D,
      w: number,
      h: number,
      mid: number,
      xOf: (sec: number) => number,
    ) {
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

      // Beat and bar lines from the analysed grid. Zoomed in far enough,
      // individual beats become useful rather than noise, so they appear once
      // there is room for them.
      if (showBars && beatGrid.length > 1) {
        const bars = barLines(beatGrid, beatsPerBar)
        const barSpacing = bars.length > 1 ? xOf(bars[1]) - xOf(bars[0]) : w

        if (barSpacing > 90) {
          ctx.strokeStyle = 'rgba(255, 182, 39, 0.08)'
          ctx.lineWidth = 1
          ctx.beginPath()
          for (const t of beatGrid) {
            if (t < view.start || t > view.end) continue
            const x = Math.round(xOf(t)) + 0.5
            ctx.moveTo(x, h * 0.18)
            ctx.lineTo(x, h * 0.82)
          }
          ctx.stroke()
        }

        if (barSpacing > 5) {
          ctx.strokeStyle = 'rgba(255, 182, 39, 0.2)'
          ctx.lineWidth = 1
          ctx.beginPath()
          for (const t of bars) {
            if (t < view.start || t > view.end) continue
            const x = Math.round(xOf(t)) + 0.5
            ctx.moveTo(x, 0)
            ctx.lineTo(x, h)
          }
          ctx.stroke()
        }
      }

      ctx.strokeStyle = 'rgba(255,255,255,0.07)'
      ctx.beginPath()
      ctx.moveTo(0, mid + 0.5)
      ctx.lineTo(w, mid + 0.5)
      ctx.stroke()

      if (peaks && peaks.length >= 2) {
        const buckets = peaks.length / 2
        for (let i = 0; i < buckets; i++) {
          const x = (i / buckets) * w
          const min = peaks[i * 2]
          const max = peaks[i * 2 + 1]
          const y1 = mid - max * (h / 2 - 6)
          const y2 = mid - min * (h / 2 - 6)
          ctx.fillStyle = 'rgba(150, 163, 174, 0.5)'
          ctx.fillRect(x, y1, Math.max(1, w / buckets - 0.5), Math.max(1, y2 - y1))
        }
      }
    }

    ctx.drawImage(staticLayer.current, 0, 0, w, h)

    const playedX = xOf(positionSec)
    if (playedX > 0 && peaks && peaks.length >= 2) {
      ctx.save()
      ctx.beginPath()
      ctx.rect(0, 0, Math.min(playedX, w), h)
      ctx.clip()
      ctx.globalCompositeOperation = 'source-atop'
      ctx.fillStyle = 'rgba(255, 182, 39, 0.92)'
      ctx.fillRect(0, 0, Math.min(playedX, w), h)
      ctx.restore()
    }

    if (playedX >= -2 && playedX <= w + 2) {
      const px = Math.round(playedX) + 0.5
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
    }
  }, [peaks, view, positionSec, loop, beatGrid, beatsPerBar, showBars, height])

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
    if (!wrap) return 0
    const rect = wrap.getBoundingClientRect()
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
    return view.start + ratio * spanOf(view)
  }

  // Wheel zooms about the pointer. Registered manually and non-passive,
  // because React's synthetic wheel handler is passive and cannot
  // preventDefault, which would let the page scroll while zooming.
  useEffect(() => {
    const wrap = wrapRef.current
    if (!wrap || !onZoom) return
    const handler = (e: WheelEvent) => {
      e.preventDefault()
      const factor = Math.exp(e.deltaY * 0.0015)
      onZoom(factor, secondsAt(e.clientX))
    }
    wrap.addEventListener('wheel', handler, { passive: false })
    return () => wrap.removeEventListener('wheel', handler)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onZoom, view.start, view.end, durationSec])

  return (
    <div
      ref={wrapRef}
      className="display"
      style={{ height, cursor: drag.current ? 'grabbing' : 'crosshair', userSelect: 'none', touchAction: 'none' }}
      onPointerDown={(e) => {
        const sec = secondsAt(e.clientX)
        // Shift/alt set loop ends in place, which matters when the point you
        // want is a bar line you can see.
        if (e.shiftKey && onSetLoopPoint) return onSetLoopPoint('a', sec)
        if (e.altKey && onSetLoopPoint) return onSetLoopPoint('b', sec)
        if (e.metaKey || e.ctrlKey || e.button === 1) {
          drag.current = { x: e.clientX, startView: view.start }
          ;(e.target as Element).setPointerCapture?.(e.pointerId)
          return
        }
        onScrub(sec)
      }}
      onPointerMove={(e) => {
        if (!drag.current || !onPan) return
        const wrap = wrapRef.current
        if (!wrap) return
        const perPixel = spanOf(view) / wrap.clientWidth
        onPan(-(e.clientX - drag.current.x) * perPixel)
        drag.current = { ...drag.current, x: e.clientX }
      }}
      onPointerUp={() => {
        drag.current = null
      }}
      onPointerCancel={() => {
        drag.current = null
      }}
    >
      <canvas ref={canvasRef} style={{ display: 'block' }} />
    </div>
  )
}
