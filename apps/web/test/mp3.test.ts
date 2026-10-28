import { describe, it, expect } from 'vitest'
import { encodeMp3, Mp3RateError } from '../lib/audio/mp3'
import { makeOfflineContext, bufferFrom, SR } from './helpers/offline'
import { sine } from './helpers/dsp'

function buf(seconds: number, channels = 2): AudioBuffer {
  const ctx = makeOfflineContext(channels, 0.1)
  const tone = sine(440, seconds, SR)
  return bufferFrom(ctx, channels === 2 ? [tone, tone] : [tone], SR)
}

describe('encodeMp3', () => {
  it('produces a stream beginning with an MPEG frame sync', async () => {
    const out = await encodeMp3(buf(1))
    expect(out.length).toBeGreaterThan(1024)
    // An ID3 tag is legal ahead of the first frame, so scan a little.
    let syncAt = -1
    for (let i = 0; i < Math.min(out.length - 1, 4096); i++) {
      if (out[i] === 0xff && (out[i + 1] & 0xe0) === 0xe0) {
        syncAt = i
        break
      }
    }
    expect(syncAt).toBeGreaterThanOrEqual(0)
  })

  it('scales roughly with duration', async () => {
    const short = await encodeMp3(buf(1))
    const long = await encodeMp3(buf(3))
    expect(long.length).toBeGreaterThan(short.length * 2)
  })

  it('respects the bitrate argument', async () => {
    const low = await encodeMp3(buf(2), 64)
    const high = await encodeMp3(buf(2), 320)
    expect(high.length).toBeGreaterThan(low.length * 2)
  })

  it('encodes mono without throwing', async () => {
    expect((await encodeMp3(buf(1, 1))).length).toBeGreaterThan(512)
  })

  it('flushes the final partial frame rather than dropping it', async () => {
    // A duration that is not a multiple of 1152 samples leaves a partial
    // granule; without an explicit flush the encoder would silently drop it.
    const odd = buf(1.0007)
    const out = await encodeMp3(odd)
    const bytesPerSec = (192 * 1000) / 8
    expect(out.length).toBeGreaterThan(bytesPerSec * 0.9)
  })

  it('reports progress ending at or near completion', async () => {
    const seen: number[] = []
    await encodeMp3(buf(3), 192, (f) => seen.push(f))
    expect(seen.length).toBeGreaterThan(1)
    for (let i = 1; i < seen.length; i++) expect(seen[i]).toBeGreaterThanOrEqual(seen[i - 1])
    expect(seen[seen.length - 1]).toBe(1)
  })

  it('refuses a sample rate MP3 cannot carry, rather than writing a file that plays at the wrong speed', async () => {
    const ctx = makeOfflineContext(2, 0.1, 96000)
    const tone = sine(440, 0.5, 96000)
    const hiRes = bufferFrom(ctx, [tone, tone], 96000)
    await expect(encodeMp3(hiRes)).rejects.toBeInstanceOf(Mp3RateError)
  })
})
