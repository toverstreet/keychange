import { clampParams, DEFAULT_PARAMS, paramsSchema, type Params } from '@keypitch/contract'

/**
 * Shareable settings links.
 *
 * Settings travel; audio does not. The link carries parameters only, which is
 * what keypitch.app does and the only thing that makes sense -- the recipient
 * already has, or does not have, the file.
 */

function toBase64Url(json: string): string {
  const bytes = new TextEncoder().encode(json)
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  const b64 = typeof btoa === 'function' ? btoa(binary) : Buffer.from(bytes).toString('base64')
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(encoded: string): string | null {
  try {
    const b64 = encoded.replace(/-/g, '+').replace(/_/g, '/')
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4)
    if (typeof atob === 'function') {
      const binary = atob(padded)
      const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0))
      return new TextDecoder().decode(bytes)
    }
    return Buffer.from(padded, 'base64').toString('utf8')
  } catch {
    return null
  }
}

export function encodeParams(params: Params): string {
  // Round-tripped through a compact shape: full precision on the sliders would
  // double the link length for digits nobody can hear.
  const compact = {
    p: Number(params.pitchSemitones.toFixed(2)),
    s: Number(params.speed.toFixed(3)),
    r: Number(params.reverbMix.toFixed(3)),
    e: params.eqGainsDb.map((g) => Number(g.toFixed(1))),
    d: params.eightD ? 1 : 0,
    l: params.loop ? [Number(params.loop.a.toFixed(3)), Number(params.loop.b.toFixed(3))] : null,
  }
  return toBase64Url(JSON.stringify(compact))
}

export function decodeParams(encoded: string): Params | null {
  const json = fromBase64Url(encoded)
  if (!json) return null

  let raw: unknown
  try {
    raw = JSON.parse(json)
  } catch {
    return null
  }

  const c = raw as { p?: number; s?: number; r?: number; e?: number[]; d?: number; l?: [number, number] | null }
  const candidate: Params = {
    pitchSemitones: typeof c.p === 'number' ? c.p : DEFAULT_PARAMS.pitchSemitones,
    speed: typeof c.s === 'number' ? c.s : DEFAULT_PARAMS.speed,
    reverbMix: typeof c.r === 'number' ? c.r : DEFAULT_PARAMS.reverbMix,
    eqGainsDb: Array.isArray(c.e) ? c.e : [...DEFAULT_PARAMS.eqGainsDb],
    eightD: c.d === 1,
    loop: Array.isArray(c.l) && c.l.length === 2 ? { a: c.l[0], b: c.l[1] } : null,
  }

  // The payload came from a URL, so validate rather than trust -- a wrong-length
  // EQ array would otherwise desynchronise every band from its frequency.
  const parsed = paramsSchema.safeParse(candidate)
  if (!parsed.success) return null

  return clampParams(candidate)
}

export function shareUrl(params: Params, base?: string): string {
  const origin = base ?? (typeof location !== 'undefined' ? `${location.origin}${location.pathname}` : '')
  return `${origin}#s=${encodeParams(params)}`
}

export function paramsFromHash(hash: string): Params | null {
  const match = /[#&]s=([^&]+)/.exec(hash)
  return match ? decodeParams(match[1]) : null
}
