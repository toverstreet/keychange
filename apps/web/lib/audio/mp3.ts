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

export function encodeMp3(
  buffer: AudioBuffer,
  kbps: number = DEFAULT_MP3_KBPS,
  onProgress?: (fraction: number) => void,
): Uint8Array {
  const channels = Math.min(2, buffer.numberOfChannels)
  const encoder = new Mp3Encoder(channels, buffer.sampleRate, kbps)

  const left = toInt16(buffer.getChannelData(0))
  const right = channels > 1 ? toInt16(buffer.getChannelData(1)) : null

  // 1152 samples is one MPEG-1 Layer III granule pair, the unit the encoder
  // expects. Chunking on anything else leaves a partial frame at every boundary.
  const BLOCK = 1152
  const chunks: Uint8Array[] = []

  for (let i = 0; i < left.length; i += BLOCK) {
    const l = left.subarray(i, i + BLOCK)
    const encoded = right
      ? encoder.encodeBuffer(l, right.subarray(i, i + BLOCK))
      : encoder.encodeBuffer(l)
    if (encoded.length > 0) chunks.push(new Uint8Array(encoded))
    if (onProgress && i % (BLOCK * 256) === 0) onProgress(i / left.length)
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
