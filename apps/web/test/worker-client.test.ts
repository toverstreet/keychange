import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { analyze, health, pollSeparation, separate, WorkerUnreachableError, WorkerProtocolError } from '../lib/worker-client'

const validAnalysis = {
  key: 'A', scale: 'major', keyConfidence: 0.735,
  bpm: 135.3, bpmConfidence: 1, beatGrid: [1.81, 2.27],
  pitchHz: 110, durationSec: 509.333, sampleRate: 48000,
}

const file = new File([new Uint8Array([1, 2, 3])], 'x.m4a', { type: 'audio/mp4' })

function mockFetch(impl: (url: string, init?: RequestInit) => Promise<Response> | Response) {
  vi.stubGlobal('fetch', vi.fn(impl as unknown as typeof fetch))
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }))
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

describe('analyze', () => {
  it('parses a valid response', async () => {
    mockFetch(() => json(validAnalysis))
    await expect(analyze(file)).resolves.toEqual(validAnalysis)
  })

  it('rejects a response missing the beat grid, since loop snapping needs it', async () => {
    const { beatGrid, ...rest } = validAnalysis
    mockFetch(() => json(rest))
    await expect(analyze(file)).rejects.toBeInstanceOf(WorkerProtocolError)
  })

  it('rejects a response with an out-of-range confidence', async () => {
    mockFetch(() => json({ ...validAnalysis, keyConfidence: 4 }))
    await expect(analyze(file)).rejects.toBeInstanceOf(WorkerProtocolError)
  })

  it('surfaces a network failure as WorkerUnreachableError', async () => {
    mockFetch(() => Promise.reject(new TypeError('fetch failed')))
    await expect(analyze(file)).rejects.toBeInstanceOf(WorkerUnreachableError)
  })

  it('treats a 5xx as unreachable rather than a protocol error', async () => {
    mockFetch(() => json({ detail: 'boom' }, 500))
    await expect(analyze(file)).rejects.toBeInstanceOf(WorkerUnreachableError)
  })

  it('reports a 415 as a usable message about the file, not the worker', async () => {
    mockFetch(() => json({ detail: 'no audio stream found' }, 415))
    await expect(analyze(file)).rejects.toThrow(/no audio stream found/)
  })
})

describe('health', () => {
  it('is false rather than throwing when the worker is down', async () => {
    mockFetch(() => Promise.reject(new TypeError('fetch failed')))
    await expect(health()).resolves.toBe(false)
  })

  it('is true when the worker answers', async () => {
    mockFetch(() => json({ ok: true }))
    await expect(health()).resolves.toBe(true)
  })
})

describe('pollSeparation', () => {
  const job = (status: string, progress = 0, stems: unknown = null, error: string | null = null) =>
    ({ id: 'j1', status, progress, error, stems })

  it('stops on done and returns the finished job', async () => {
    const seq = [job('queued'), job('running', 0.5), job('done', 1, { vocals: '/v', instrumental: '/i' })]
    let i = 0
    mockFetch(() => json(seq[Math.min(i++, seq.length - 1)]))
    const result = await pollSeparation('j1', { intervalMs: 1 })
    expect(result.status).toBe('done')
    expect(result.stems?.vocals).toBe('/v')
  })

  it('stops on error and surfaces the message', async () => {
    mockFetch(() => json(job('error', 0, null, 'out of memory')))
    const result = await pollSeparation('j1', { intervalMs: 1 })
    expect(result.status).toBe('error')
    expect(result.error).toBe('out of memory')
  })

  it('reports progress while running', async () => {
    const seq = [job('running', 0.25), job('running', 0.75), job('done', 1, { vocals: '/v', instrumental: '/i' })]
    let i = 0
    mockFetch(() => json(seq[Math.min(i++, seq.length - 1)]))
    const seen: number[] = []
    await pollSeparation('j1', { intervalMs: 1, onProgress: (p) => seen.push(p) })
    expect(seen).toContain(0.25)
    expect(seen).toContain(0.75)
  })

  it('gives up after the attempt budget instead of polling forever', async () => {
    mockFetch(() => json(job('running', 0.1)))
    await expect(pollSeparation('j1', { intervalMs: 1, maxAttempts: 3 })).rejects.toThrow(/gave up/i)
  })
})

describe('separate', () => {
  it('parses the initial job', async () => {
    mockFetch(() => json({ id: 'j1', status: 'queued', progress: 0, error: null, stems: null }))
    await expect(separate(file)).resolves.toMatchObject({ id: 'j1', status: 'queued' })
  })
})
