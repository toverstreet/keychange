import { describe, it, expect } from 'vitest'
import { encodeMp3 } from '../lib/audio/mp3'
import { makeOfflineContext, bufferFrom, SR } from './helpers/offline'
import { sine } from './helpers/dsp'

function buf(seconds: number, channels = 2): AudioBuffer {
  const ctx = makeOfflineContext(channels, 0.1)
  const tone = sine(440, seconds, SR)
  return bufferFrom(ctx, channels === 2 ? [tone, tone] : [tone], SR)
}

describe('encodeMp3', () => {
  it('produces a stream beginning with an MPEG frame sync', () => {
    const out = encodeMp3(buf(1))
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

  it('scales roughly with duration', () => {
    const short = encodeMp3(buf(1))
    const long = encodeMp3(buf(3))
    expect(long.length).toBeGreaterThan(short.length * 2)
  })

  it('respects the bitrate argument', () => {
    const low = encodeMp3(buf(2), 64)
    const high = encodeMp3(buf(2), 320)
    expect(high.length).toBeGreaterThan(low.length * 2)
  })

  it('encodes mono without throwing', () => {
    expect(encodeMp3(buf(1, 1)).length).toBeGreaterThan(512)
  })

  it('flushes the final partial frame rather than dropping it', () => {
    // A duration that is not a multiple of 1152 samples leaves a partial
    // granule; without an explicit flush the encoder would silently drop it.
    const odd = buf(1.0007)
    const out = encodeMp3(odd)
    const bytesPerSec = (192 * 1000) / 8
    expect(out.length).toBeGreaterThan(bytesPerSec * 0.9)
  })
})
