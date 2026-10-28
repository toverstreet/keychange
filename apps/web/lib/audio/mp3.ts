import { Mp3Encoder } from '@breezystack/lamejs'

/**
 * MP3 encoding.
 *
 * @breezystack/lamejs rather than the original `lamejs`: that package's module
 * entry point is broken outside a browser global scope (it throws
 * "MPEGMode is not defined" because its classes are only wired together by its
 * concatenated bundle). The fork is the same encoder with working packaging.
 */
export const DEFAULT_MP3_KBPS = 192

/** Float samples to 16-bit, clamped. The quantisation costs nothing the lossy
 *  codec does not already cost. */
function toInt16(input: Float32Array): Int16Array {
  const out = new Int16Array(input.length)
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i]))
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff
  }
  return out
}

/** Rates lamejs can encode (MPEG-1, 2 and 2.5). */
const SUPPORTED_RATES = [8000, 11025, 12000, 16000, 22050, 24000, 32000, 44100, 48000]

export class Mp3RateError extends Error {}

/**
 * Encode to MP3, yielding to the event loop periodically.
 *
 * Async because encoding the 8.5-minute reference file runs ~21,000 blocks; done
 * synchronously that freezes the tab for several seconds with a progress bar
 * that cannot move. The yields cost almost nothing and keep the UI alive.
 */
export async function encodeMp3(
  buffer: AudioBuffer,
  kbps: number = DEFAULT_MP3_KBPS,
  onProgress?: (fraction: number) => void,
): Promise<Uint8Array> {
  if (!SUPPORTED_RATES.includes(buffer.sampleRate)) {
    // Encoding anyway produces a file that plays at the wrong speed rather
    // than failing, which is far worse than refusing.
    throw new Mp3RateError(
      `MP3 cannot carry ${buffer.sampleRate} Hz audio. Export WAV instead, which preserves it exactly.`,
    )
  }

  const channels = Math.min(2, buffer.numberOfChannels)
  const encoder = new Mp3Encoder(channels, buffer.sampleRate, kbps)

  const left = toInt16(buffer.getChannelData(0))
  const right = channels > 1 ? toInt16(buffer.getChannelData(1)) : null

  // 1152 samples is one MPEG-1 Layer III granule pair, the unit the encoder
  // expects. Chunking on anything else leaves a partial frame at every boundary.
  const BLOCK = 1152
  const YIELD_EVERY = 256
  const chunks: Uint8Array[] = []

  let block = 0
  for (let i = 0; i < left.length; i += BLOCK, block++) {
    const l = left.subarray(i, i + BLOCK)
    const encoded = right
      ? encoder.encodeBuffer(l, right.subarray(i, i + BLOCK))
      : encoder.encodeBuffer(l)
    if (encoded.length > 0) chunks.push(new Uint8Array(encoded))

    if (block % YIELD_EVERY === 0) {
      onProgress?.(i / left.length)
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
  }

  // Without the explicit flush the encoder's final partial granule is dropped,
  // taking the last fraction of a second of audio with it.
  const flushed = encoder.flush()
  if (flushed.length > 0) chunks.push(new Uint8Array(flushed))

  const total = chunks.reduce((n, c) => n + c.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const c of chunks) {
    out.set(c, offset)
    offset += c.length
  }
  onProgress?.(1)
  return out
}
