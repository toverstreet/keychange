import {
  analysisResultSchema,
  separationJobSchema,
  type AnalysisResult,
  type SeparationJob,
} from '@keypitch/contract'

/**
 * The only module in the frontend that knows the worker exists.
 *
 * Everything else talks to these functions. That is what makes the hosted
 * deployment a configuration change: point WORKER_URL at a GPU host and no
 * other file moves. It is also why every response is validated here -- an
 * unvalidated response is precisely how that swap would turn into a silent
 * frontend bug months later.
 */

const DEFAULT_WORKER_URL = 'http://127.0.0.1:8008'

export function workerUrl(): string {
  return process.env.NEXT_PUBLIC_WORKER_URL?.replace(/\/$/, '') || DEFAULT_WORKER_URL
}

/** The worker could not be reached, or failed in a way that is about the
 *  worker rather than the file. The UI degrades instead of blocking. */
export class WorkerUnreachableError extends Error {
  constructor(message = 'The analysis worker is not reachable.') {
    super(message)
    this.name = 'WorkerUnreachableError'
  }
}

/** The worker answered, but not in the shape we require. */
export class WorkerProtocolError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'WorkerProtocolError'
  }
}

/** The worker rejected this particular file. Actionable by the user. */
export class WorkerRejectedFileError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'WorkerRejectedFileError'
  }
}

async function request(path: string, init?: RequestInit): Promise<Response> {
  let res: Response
  try {
    res = await fetch(`${workerUrl()}${path}`, init)
  } catch {
    throw new WorkerUnreachableError()
  }

  if (res.ok) return res

  // A 404 is about the worker's state, not the file: separation job ids live
  // in an in-process registry that dies with a worker restart. Reporting that
  // as a problem with the user's audio sends them looking in the wrong place.
  if (res.status === 404) {
    throw new WorkerUnreachableError('That job is no longer known to the worker; it may have restarted.')
  }

  // 4xx about the file is the user's problem and is reported as such; anything
  // else is the worker's problem and degrades the same way as being offline.
  if (res.status === 400 || res.status === 415) {
    let detail = `Request failed (${res.status})`
    try {
      const body = (await res.json()) as { detail?: string }
      if (body?.detail) detail = body.detail
    } catch {
      /* keep the generic message */
    }
    throw new WorkerRejectedFileError(detail)
  }

  throw new WorkerUnreachableError(`The worker returned ${res.status}.`)
}

function parseOr<T>(schema: { safeParse: (v: unknown) => { success: boolean; data?: T; error?: unknown } }, value: unknown, what: string): T {
  const parsed = schema.safeParse(value)
  if (!parsed.success) {
    throw new WorkerProtocolError(`The worker's ${what} response did not match the expected shape.`)
  }
  return parsed.data as T
}

export async function health(): Promise<boolean> {
  try {
    const res = await fetch(`${workerUrl()}/health`)
    if (!res.ok) return false
    const body = (await res.json()) as { ok?: boolean }
    return body?.ok === true
  } catch {
    return false
  }
}

export async function analyze(file: File): Promise<AnalysisResult> {
  const form = new FormData()
  form.append('file', file)
  const res = await request('/analyze', { method: 'POST', body: form })
  return parseOr<AnalysisResult>(analysisResultSchema, await res.json(), 'analysis')
}

/**
 * Transcode to WAV via the worker's ffmpeg, for codecs the browser refuses.
 *
 * Lives here rather than in decode.ts so that this module really is the only
 * place that knows the worker's routes exist -- a hosted worker with a
 * differently shaped decode endpoint should break in one file, not two.
 */
export async function decodeViaWorker(file: File): Promise<ArrayBuffer> {
  const form = new FormData()
  form.append('file', file)
  const res = await request('/decode', { method: 'POST', body: form })
  return res.arrayBuffer()
}

/** Source sample rate via the worker's ffprobe, when the header sniffer cannot
 *  determine it locally. */
export async function probeSampleRate(file: File): Promise<number | null> {
  try {
    const result = await analyze(file)
    return result.sampleRate
  } catch {
    return null
  }
}

export async function separate(file: File): Promise<SeparationJob> {
  const form = new FormData()
  form.append('file', file)
  const res = await request('/separate', { method: 'POST', body: form })
  return parseOr<SeparationJob>(separationJobSchema, await res.json(), 'separation')
}

export async function getSeparation(id: string): Promise<SeparationJob> {
  const res = await request(`/separate/${encodeURIComponent(id)}`)
  return parseOr<SeparationJob>(separationJobSchema, await res.json(), 'separation')
}

export function stemUrl(id: string, stem: 'vocals' | 'instrumental'): string {
  return `${workerUrl()}/separate/${encodeURIComponent(id)}/${stem}`
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export async function pollSeparation(
  id: string,
  opts: { intervalMs?: number; maxAttempts?: number; onProgress?: (p: number) => void; signal?: AbortSignal } = {},
): Promise<SeparationJob> {
  const { intervalMs = 1500, maxAttempts = 2400, onProgress, signal } = opts

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (signal?.aborted) throw new Error('Separation polling was cancelled.')
    const job = await getSeparation(id)
    onProgress?.(job.progress)
    if (job.status === 'done' || job.status === 'error') return job
    await sleep(intervalMs)
  }

  // A bounded budget rather than an unbounded loop: a wedged job should surface
  // as a clear failure, not a spinner that never resolves.
  throw new Error('Separation gave up waiting for the worker to finish.')
}
