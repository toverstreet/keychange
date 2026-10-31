'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { DEFAULT_PARAMS, type AnalysisResult, type Params } from '@keychange/contract'
import { AudioEngine } from '@/lib/audio/engine'
import { computePeaks } from '@/lib/audio/peaks'
import { DecodeError, decodeFile } from '@/lib/audio/decode'
import { exportFilename, renderToBuffer } from '@/lib/audio/render'
import { encodeWav } from '@/lib/audio/wav'
import { encodeMp3 } from '@/lib/audio/mp3'
import { barLines } from '@/lib/audio/snap'
import {
  nextSnapMode,
  normalizeRegion,
  regionFromDrag,
  snapWithMode,
  type SnapMode,
} from '@/lib/audio/selection'
import { analyze, health, WorkerRejectedFileError, WorkerUnreachableError } from '@/lib/worker-client'
import { paramsFromHash, shareUrl } from '@/lib/share'
import { clampView, fitRegion, followPlayhead, spanOf, zoomAt, type View } from '@/lib/audio/viewport'
import { AnalysisPanel, type AnalysisState } from '@/components/AnalysisPanel'
import { Dropzone } from '@/components/Dropzone'
import { EqPanel } from '@/components/EqPanel'
import { ExportPanel, type ExportScope, type ExportState } from '@/components/ExportPanel'
import { LoopBar } from '@/components/LoopBar'
import { PitchSpeed } from '@/components/PitchSpeed'
import { PresetBar } from '@/components/PresetBar'
import { ReverbPanel } from '@/components/ReverbPanel'
import { StemsPanel, type StemsState } from '@/components/StemsPanel'
import { Transport } from '@/components/Transport'
import { Waveform } from '@/components/Waveform'
import { ZoomBar } from '@/components/ZoomBar'
import { PoweredBy } from '@/components/PoweredBy'
import { formatBytes } from '@/lib/format'

export default function Page() {
  const [file, setFile] = useState<File | null>(null)
  const [loading, setLoading] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [peaks, setPeaks] = useState<Float32Array | null>(null)
  const [params, setParams] = useState<Params>(DEFAULT_PARAMS)
  const [playing, setPlaying] = useState(false)
  const [position, setPosition] = useState(0)
  const [duration, setDuration] = useState(0)
  const [rendering, setRendering] = useState(false)

  const [analysis, setAnalysis] = useState<AnalysisState>({ kind: 'idle' })
  const [exportState, setExportState] = useState<ExportState>({ kind: 'idle' })
  const [stems, setStems] = useState<StemsState>({ kind: 'idle' })
  const [snapMode, setSnapMode] = useState<SnapMode>('bars')
  const [beatsPerBar, setBeatsPerBar] = useState(4)
  const [shareState, setShareState] = useState<'idle' | 'copied'>('idle')

  const [rateConfirmed, setRateConfirmed] = useState(true)
  const [view, setView] = useState<View>({ start: 0, end: 0 })
  const [exportScope, setExportScope] = useState<ExportScope>('loop')
  const [followPlay, setFollowPlay] = useState(true)

  const engineRef = useRef<AudioEngine | null>(null)
  const sourceRef = useRef<AudioBuffer | null>(null)
  const rafRef = useRef<number | null>(null)
  /** Increments on every load. A load that finishes after a newer one started
   *  must not install its engine, or the loser's AudioContext stays alive and
   *  audible. Reachable by opening a stem while a load is still in flight. */
  const loadGeneration = useRef(0)
  const workerWaitTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Settings arriving from a shared link are applied before any file is
  // loaded, so opening a link and then dropping the file lands in the shared
  // state rather than resetting it.
  useEffect(() => {
    const fromHash = paramsFromHash(window.location.hash)
    if (fromHash) setParams(fromHash)
  }, [])

  const beatGrid = analysis.kind === 'done' ? analysis.result.beatGrid : []

  // --- loading ----------------------------------------------------------

  const load = useCallback(async (f: File) => {
    setLoadError(null)
    setLoading('Decoding…')
    setStems({ kind: 'idle' })
    setExportState({ kind: 'idle' })

    const generation = ++loadGeneration.current
    engineRef.current?.dispose()
    engineRef.current = null

    try {
      const { buffer, rateConfirmed: confirmed } = await decodeFile(f)
      if (generation !== loadGeneration.current) return // superseded

      sourceRef.current = buffer
      setFile(f)
      setDuration(buffer.duration)
      setView({ start: 0, end: buffer.duration })
      setRateConfirmed(confirmed)

      const engine = new AudioEngine(buffer, undefined, params)
      engineRef.current = engine
      engine.subscribe((s) => {
        setPlaying(s.playing)
        setRendering(s.rendering)
      })
      setLoading(null)
    } catch (err) {
      if (generation !== loadGeneration.current) return
      setLoading(null)
      setLoadError(err instanceof DecodeError ? err.message : 'That file could not be loaded.')
      return
    }

    if (generation !== loadGeneration.current) return

    // Analysis runs alongside playback rather than gating it: the file is
    // playable immediately and the readouts fill in when they are ready.
    await runAnalysis(f, generation)
  }, [params])

  /**
   * Analyse, waiting for the worker if it is still starting.
   *
   * Polls /health rather than retrying analyze(): a retry loop on analyze
   * would re-upload the whole file -- twelve megabytes for the reference
   * track -- on every attempt, for a request that cannot succeed until the
   * worker is listening anyway.
   */
  const runAnalysis = useCallback(async (f: File, generation: number) => {
    if (workerWaitTimer.current) clearTimeout(workerWaitTimer.current)

    setAnalysis({ kind: 'running' })

    if (!(await health())) {
      if (generation !== loadGeneration.current) return
      setAnalysis({ kind: 'offline', retrying: true })

      // Roughly thirty seconds in total, which covers the worker's own
      // startup when the desktop app launches both at once.
      const delays = [1500, 2000, 3000, 4000, 6000, 6000, 8000]
      for (const delay of delays) {
        const slept = await new Promise<boolean>((resolve) => {
          workerWaitTimer.current = setTimeout(() => resolve(true), delay)
        })
        if (!slept || generation !== loadGeneration.current) return
        if (await health()) break
      }

      if (generation !== loadGeneration.current) return
      if (!(await health())) {
        setAnalysis({ kind: 'offline', retrying: false })
        return
      }
      setAnalysis({ kind: 'running' })
    }

    try {
      const result: AnalysisResult = await analyze(f)
      if (generation !== loadGeneration.current) return
      setAnalysis({ kind: 'done', result })
    } catch (err) {
      if (generation !== loadGeneration.current) return
      if (err instanceof WorkerUnreachableError) setAnalysis({ kind: 'offline', retrying: false })
      else if (err instanceof WorkerRejectedFileError) setAnalysis({ kind: 'error', message: err.message })
      else setAnalysis({ kind: 'error', message: 'Analysis failed.' })
    }
  }, [])

  const retryAnalysis = useCallback(async () => {
    if (!file) return
    await runAnalysis(file, loadGeneration.current)
  }, [file, runAnalysis])

  // Peaks follow the visible window, which is what makes zooming reveal real
  // detail rather than magnifying the same buckets.
  useEffect(() => {
    const buffer = sourceRef.current
    if (!buffer || spanOf(view) <= 0) return
    setPeaks(computePeaks(buffer, undefined, view.start, view.end))
  }, [view])

  // --- playhead ---------------------------------------------------------

  useEffect(() => {
    const tick = () => {
      const engine = engineRef.current
      if (engine) {
        const pos = engine.positionSec
        setPosition(pos)
        if (engine.state().playing) {
          setView((v) => (followPlay && spanOf(v) > 0 ? followPlayhead(v, pos, engine.durationSec) : v))
        }
      }
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [followPlay])

  useEffect(() => () => engineRef.current?.dispose(), [])
  useEffect(() => () => { if (workerWaitTimer.current) clearTimeout(workerWaitTimer.current) }, [])

  // --- parameters -------------------------------------------------------

  const update = useCallback((partial: Partial<Params>) => {
    // The engine call stays outside the updater. React treats updater
    // functions as pure and may run them more than once -- React 19 StrictMode
    // double-invokes them in development -- which would double every graph
    // update. It is harmless only while every partial is an absolute value.
    engineRef.current?.setParams(partial)
    setParams((prev) => ({ ...prev, ...partial }))
    setShareState('idle')
  }, [])

  const setLoopPoint = useCallback(
    (which: 'a' | 'b', rawSeconds: number, snap: SnapMode = snapMode) => {
      const at = snapWithMode(rawSeconds, snap, beatGrid, beatsPerBar)
      const current = params.loop ?? { a: 0, b: duration }
      // Moving one end past the other re-orders them rather than refusing the
      // edit, so dragging B back behind A selects the span you drew instead of
      // doing nothing.
      const next = normalizeRegion(
        which === 'a' ? at : current.a,
        which === 'a' ? current.b : at,
        duration,
      )
      if (next) update({ loop: next })
    },
    [beatGrid, snapMode, beatsPerBar, params.loop, duration, update],
  )

  /** A drag across the waveform: one selection, of any length, which *is* the
   *  loop. Alt held during the drag places the ends exactly. */
  const selectRegion = useCallback(
    (fromSec: number, toSec: number, bypassSnap: boolean) => {
      const region = regionFromDrag(fromSec, toSec, duration, {
        mode: bypassSnap ? 'off' : snapMode,
        grid: beatGrid,
        beatsPerBar,
      })
      if (region) update({ loop: region })
    },
    [beatGrid, snapMode, beatsPerBar, duration, update],
  )

  const loopBarsFromHere = useCallback(
    (bars: number) => {
      const lines = barLines(beatGrid, beatsPerBar)
      if (lines.length < 2) return
      let startIndex = 0
      for (let i = 0; i < lines.length; i++) {
        if (Math.abs(lines[i] - position) < Math.abs(lines[startIndex] - position)) startIndex = i
      }
      const a = lines[startIndex]
      const b = lines[Math.min(lines.length - 1, startIndex + bars)]
      if (b <= a) return
      update({ loop: { a, b } })
      engineRef.current?.seek(a)
    },
    [beatGrid, beatsPerBar, position, update],
  )

  // --- zoom -------------------------------------------------------------

  const zoom = useCallback(
    (factor: number, anchorSec: number) => setView((v) => zoomAt(v, factor, anchorSec, duration)),
    [duration],
  )
  const pan = useCallback(
    (deltaSec: number) =>
      setView((v) => clampView({ start: v.start + deltaSec, end: v.end + deltaSec }, duration)),
    [duration],
  )
  const fitLoop = useCallback(() => {
    if (params.loop) setView(fitRegion(params.loop.a, params.loop.b, duration))
  }, [params.loop, duration])
  const fitAll = useCallback(() => setView({ start: 0, end: duration }), [duration])

  // --- transport --------------------------------------------------------

  const toggle = useCallback(() => void engineRef.current?.toggle(), [])
  const seek = useCallback((sec: number) => engineRef.current?.seek(sec), [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Space also activates a focused button, which is where focus lands
      // after any preset or transport click -- without this it would both
      // press the button and toggle the transport.
      const el = e.target as HTMLElement | null
      if (el?.closest?.('input, button, select, textarea, [contenteditable]')) return
      if (e.code === 'Space') {
        e.preventDefault()
        toggle()
      }
      if (e.code === 'ArrowLeft') seek(Math.max(0, (engineRef.current?.positionSec ?? 0) - 5))
      if (e.code === 'ArrowRight') seek((engineRef.current?.positionSec ?? 0) + 5)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [toggle, seek])

  // --- export -----------------------------------------------------------

  const runExport = useCallback(
    async (format: 'wav' | 'mp3') => {
      const source = sourceRef.current
      if (!source || !file) return

      const region = exportScope === 'loop' && params.loop ? params.loop : null

      setExportState({ kind: 'working', label: 'Stretching…', progress: 0 })
      try {
        // Yield once so the progress bar paints before the main-thread render
        // begins, rather than appearing only after it finishes.
        await new Promise((r) => setTimeout(r, 30))

        const rendered = await renderToBuffer(
          source,
          params,
          (f, stage) => {
            setExportState({
              kind: 'working',
              label: stage === 'stretch' ? 'Stretching…' : 'Applying effects…',
              progress: f * 0.85,
            })
          },
          undefined,
          region,
        )

        setExportState({ kind: 'working', label: `Encoding ${format.toUpperCase()}…`, progress: 0.88 })
        await new Promise((r) => setTimeout(r, 30))

        const bytes =
          format === 'wav'
            ? encodeWav(rendered)
            : await encodeMp3(rendered, undefined, (f) =>
                // Real encode progress rather than a bar pinned at 88% while
                // the tab is busy.
                setExportState({ kind: 'working', label: 'Encoding MP3…', progress: 0.88 + f * 0.12 }),
              )
        const filename = exportFilename(file.name, params, format, region)
        const blob = new Blob([bytes as unknown as BlobPart], {
          type: format === 'wav' ? 'audio/wav' : 'audio/mpeg',
        })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = filename
        a.click()
        setTimeout(() => URL.revokeObjectURL(url), 10_000)

        setExportState({ kind: 'done', filename })
      } catch (err) {
        setExportState({ kind: 'error', message: err instanceof Error ? err.message : 'Export failed.' })
      }
    },
    [file, params, exportScope],
  )

  // --- sharing ----------------------------------------------------------

  const share = useCallback(async () => {
    const url = shareUrl(params)
    history.replaceState(null, '', `#s=${url.split('#s=')[1]}`)
    try {
      await navigator.clipboard.writeText(url)
      setShareState('copied')
      setTimeout(() => setShareState('idle'), 2000)
    } catch {
      setShareState('idle')
    }
  }, [params])

  // --- stems ------------------------------------------------------------

  const loadStemIntoEditor = useCallback(
    async (url: string, label: string) => {
      setLoading(`Loading ${label}…`)
      try {
        const res = await fetch(url)
        const blob = await res.blob()
        await load(new File([blob], `${label}.wav`, { type: 'audio/wav' }))
      } catch {
        setLoading(null)
        setLoadError(`Could not load the ${label} stem.`)
      }
    },
    [load],
  )

  const ready = !!file && !loading

  const header = useMemo(
    () => (
      <header className="flex items-end justify-between gap-4 flex-wrap mb-6">
        <div className="flex items-center gap-5 flex-wrap">
          <div>
            <h1
              style={{
                fontSize: 40,
                fontWeight: 700,
                letterSpacing: '0.16em',
                textTransform: 'uppercase',
                lineHeight: 1,
              }}
            >
              Key<span style={{ color: 'var(--amber)' }}>Change</span>
            </h1>
            <p className="legend" style={{ marginTop: 8 }}>
              Local audio studio · nothing leaves this machine
            </p>
          </div>
          <PoweredBy />
        </div>
        {file && (
          <div className="display px-3 py-2" style={{ maxWidth: 440 }}>
            <div
              style={{
                fontSize: 14,
                color: 'var(--ink)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {file.name}
            </div>
            <div style={{ color: 'var(--ink-faint)', fontSize: 12 }}>{formatBytes(file.size)}</div>
          </div>
        )}
      </header>
    ),
    [file],
  )

  return (
    <main style={{ maxWidth: 1180, margin: '0 auto', padding: '40px 24px 80px' }}>
      {header}

      {!file ? (
        <Dropzone onFile={load} busy={loading} error={loadError} />
      ) : (
        <div className="grid gap-4">
          <section className="rack p-4 rise">
            <Waveform
              peaks={peaks}
              view={view}
              durationSec={duration}
              positionSec={position}
              loop={params.loop}
              beatGrid={beatGrid}
              beatsPerBar={beatsPerBar}
              showBars={snapMode === 'bars'}
              onScrub={seek}
              onSetLoopPoint={setLoopPoint}
              onSelectRegion={selectRegion}
              onZoom={zoom}
              onPan={pan}
            />
            <ZoomBar
              view={view}
              duration={duration}
              hasLoop={!!params.loop}
              following={followPlay}
              onZoom={(f) => zoom(f, position)}
              onFitLoop={fitLoop}
              onFitAll={fitAll}
              onToggleFollow={() => setFollowPlay((v) => !v)}
            />
            <div className="mt-4">
              <Transport
                playing={playing}
                position={position}
                duration={duration}
                rendering={rendering}
                onToggle={toggle}
                onSeek={seek}
                onBack={() => seek(0)}
              />
            </div>
          </section>

          <AnalysisPanel state={analysis} onRetry={retryAnalysis} rateConfirmed={rateConfirmed} />
          <PitchSpeed params={params} onChange={update} disabled={!ready} />
          <LoopBar
            params={params}
            position={position}
            duration={duration}
            beatGrid={beatGrid}
            snapMode={snapMode}
            beatsPerBar={beatsPerBar}
            onChange={update}
            onCycleSnap={() => setSnapMode(nextSnapMode)}
            onSetLoopEnd={(which, sec) => setLoopPoint(which, sec, 'off')}
            onSetBeatsPerBar={setBeatsPerBar}
            onLoopBars={loopBarsFromHere}
            disabled={!ready}
          />
          <ExportPanel
            state={exportState}
            onExport={runExport}
            disabled={!ready}
            scope={exportScope}
            onScope={setExportScope}
            loopSeconds={params.loop ? params.loop.b - params.loop.a : null}
            fullSeconds={duration}
          />
          <EqPanel params={params} onChange={update} disabled={!ready} />
          <ReverbPanel params={params} onChange={update} disabled={!ready} />
          <PresetBar params={params} onChange={update} onShare={share} shareState={shareState} disabled={!ready} />
          <StemsPanel
            state={stems}
            file={file}
            onState={setStems}
            onLoadStem={loadStemIntoEditor}
            disabled={!ready}
          />

          <div className="flex justify-center mt-2">
            <button
              className="btn"
              onClick={() => {
                engineRef.current?.dispose()
                engineRef.current = null
                sourceRef.current = null
                setFile(null)
                setPeaks(null)
                setAnalysis({ kind: 'idle' })
                setPosition(0)
              }}
            >
              Load a different file
            </button>
          </div>
        </div>
      )}
    </main>
  )
}
