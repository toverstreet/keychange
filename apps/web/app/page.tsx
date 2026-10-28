'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { DEFAULT_PARAMS, type AnalysisResult, type Params } from '@keypitch/contract'
import { AudioEngine } from '@/lib/audio/engine'
import { computePeaks } from '@/lib/audio/peaks'
import { DecodeError, decodeFile } from '@/lib/audio/decode'
import { exportFilename, renderToBuffer } from '@/lib/audio/render'
import { encodeWav } from '@/lib/audio/wav'
import { encodeMp3 } from '@/lib/audio/mp3'
import { barLines, snapToGrid } from '@/lib/audio/snap'
import { analyze, WorkerRejectedFileError, WorkerUnreachableError } from '@/lib/worker-client'
import { paramsFromHash, shareUrl } from '@/lib/share'
import { AnalysisPanel, type AnalysisState } from '@/components/AnalysisPanel'
import { Dropzone } from '@/components/Dropzone'
import { EqPanel } from '@/components/EqPanel'
import { ExportPanel, type ExportState } from '@/components/ExportPanel'
import { LoopBar } from '@/components/LoopBar'
import { PitchSpeed } from '@/components/PitchSpeed'
import { PresetBar } from '@/components/PresetBar'
import { ReverbPanel } from '@/components/ReverbPanel'
import { StemsPanel, type StemsState } from '@/components/StemsPanel'
import { Transport } from '@/components/Transport'
import { Waveform } from '@/components/Waveform'
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
  const [snapBars, setSnapBars] = useState(true)
  const [beatsPerBar, setBeatsPerBar] = useState(4)
  const [shareState, setShareState] = useState<'idle' | 'copied'>('idle')

  const engineRef = useRef<AudioEngine | null>(null)
  const sourceRef = useRef<AudioBuffer | null>(null)
  const rafRef = useRef<number | null>(null)

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

    engineRef.current?.dispose()
    engineRef.current = null

    try {
      const probeCtx = new AudioContext()
      const buffer = await decodeFile(f, probeCtx)
      void probeCtx.close()

      sourceRef.current = buffer
      setFile(f)
      setDuration(buffer.duration)
      setPeaks(computePeaks(buffer))

      const engine = new AudioEngine(buffer, undefined, params)
      engineRef.current = engine
      engine.subscribe((s) => {
        setPlaying(s.playing)
        setRendering(s.rendering)
      })
      setLoading(null)
    } catch (err) {
      setLoading(null)
      setLoadError(err instanceof DecodeError ? err.message : 'That file could not be loaded.')
      return
    }

    // Analysis runs alongside playback rather than gating it: the file is
    // playable immediately and the readouts fill in when they are ready.
    setAnalysis({ kind: 'running' })
    try {
      const result: AnalysisResult = await analyze(f)
      setAnalysis({ kind: 'done', result })
    } catch (err) {
      if (err instanceof WorkerUnreachableError) setAnalysis({ kind: 'offline' })
      else if (err instanceof WorkerRejectedFileError) setAnalysis({ kind: 'error', message: err.message })
      else setAnalysis({ kind: 'error', message: 'Analysis failed.' })
    }
  }, [params])

  const retryAnalysis = useCallback(async () => {
    if (!file) return
    setAnalysis({ kind: 'running' })
    try {
      setAnalysis({ kind: 'done', result: await analyze(file) })
    } catch (err) {
      if (err instanceof WorkerUnreachableError) setAnalysis({ kind: 'offline' })
      else setAnalysis({ kind: 'error', message: err instanceof Error ? err.message : 'Analysis failed.' })
    }
  }, [file])

  // --- playhead ---------------------------------------------------------

  useEffect(() => {
    const tick = () => {
      const engine = engineRef.current
      if (engine) setPosition(engine.positionSec)
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [])

  useEffect(() => () => engineRef.current?.dispose(), [])

  // --- parameters -------------------------------------------------------

  const update = useCallback((partial: Partial<Params>) => {
    setParams((prev) => {
      const next = { ...prev, ...partial }
      engineRef.current?.setParams(partial)
      return next
    })
    setShareState('idle')
  }, [])

  const setLoopPoint = useCallback(
    (which: 'a' | 'b', rawSeconds: number) => {
      const snapped = snapToGrid(rawSeconds, beatGrid, { bars: snapBars, beatsPerBar })
      const current = params.loop ?? { a: 0, b: duration }
      const next = which === 'a' ? { a: snapped, b: current.b } : { a: current.a, b: snapped }
      if (next.b <= next.a) return
      update({ loop: next })
    },
    [beatGrid, snapBars, beatsPerBar, params.loop, duration, update],
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

  // --- transport --------------------------------------------------------

  const toggle = useCallback(() => void engineRef.current?.toggle(), [])
  const seek = useCallback((sec: number) => engineRef.current?.seek(sec), [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return
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

      setExportState({ kind: 'working', label: 'Stretching…', progress: 0 })
      try {
        // Yield once so the progress bar paints before the main-thread render
        // begins, rather than appearing only after it finishes.
        await new Promise((r) => setTimeout(r, 30))

        const rendered = await renderToBuffer(source, params, (f, stage) => {
          setExportState({
            kind: 'working',
            label: stage === 'stretch' ? 'Stretching…' : 'Applying effects…',
            progress: f * 0.85,
          })
        })

        setExportState({ kind: 'working', label: `Encoding ${format.toUpperCase()}…`, progress: 0.88 })
        await new Promise((r) => setTimeout(r, 30))

        const bytes = format === 'wav' ? encodeWav(rendered) : encodeMp3(rendered)
        const filename = exportFilename(file.name, params, format)
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
    [file, params],
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
            Key<span style={{ color: 'var(--amber)' }}>Pitch</span>
          </h1>
          <p className="legend" style={{ marginTop: 8 }}>
            Local audio studio · nothing leaves this machine
          </p>
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
              durationSec={duration}
              positionSec={position}
              loop={params.loop}
              beatGrid={beatGrid}
              beatsPerBar={beatsPerBar}
              showBars={snapBars}
              onScrub={seek}
              onSetLoopPoint={setLoopPoint}
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

          <AnalysisPanel state={analysis} onRetry={retryAnalysis} />
          <PitchSpeed params={params} onChange={update} disabled={!ready} />
          <LoopBar
            params={params}
            position={position}
            duration={duration}
            beatGrid={beatGrid}
            snapBars={snapBars}
            beatsPerBar={beatsPerBar}
            onChange={update}
            onToggleSnapBars={() => setSnapBars((v) => !v)}
            onSetBeatsPerBar={setBeatsPerBar}
            onLoopBars={loopBarsFromHere}
            disabled={!ready}
          />
          <ExportPanel state={exportState} onExport={runExport} disabled={!ready} />
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
