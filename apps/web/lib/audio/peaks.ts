/** Default horizontal resolution of the waveform. Enough detail for an
 *  8-minute track at typical window widths without storing the whole file. */
export const PEAK_BUCKETS = 1600

/**
 * Reduce an AudioBuffer to interleaved [min, max] pairs per horizontal bucket.
 *
 * Min *and* max, not RMS or absolute peak: a waveform drawn from absolute
 * values loses asymmetry, and one drawn from RMS loses transients entirely --
 * which is exactly what someone looking for a downbeat is scanning for.
 *
 * Channels are reduced together so the drawn envelope is the true extent of the
 * signal rather than one channel's view of it.
 */
export function computePeaks(
  buffer: AudioBuffer,
  buckets: number = PEAK_BUCKETS,
  startSec = 0,
  endSec?: number,
): Float32Array {
  const out = new Float32Array(buckets * 2)
  const { length, numberOfChannels, sampleRate } = buffer
  if (length === 0 || buckets === 0) return out

  const channels: Float32Array[] = []
  for (let ch = 0; ch < numberOfChannels; ch++) channels.push(buffer.getChannelData(ch))

  // Peaks are computed over the visible window rather than the whole buffer.
  // That is what makes zooming show more detail instead of magnifying the same
  // 1600 buckets: at full view a bucket spans 0.32 s of an 8.5-minute track,
  // but across an 8-second loop it spans 5 ms.
  const rangeStart = Math.max(0, Math.min(length, Math.floor(startSec * sampleRate)))
  const rangeEnd =
    endSec === undefined
      ? length
      : Math.max(rangeStart + 1, Math.min(length, Math.ceil(endSec * sampleRate)))
  const rangeLength = rangeEnd - rangeStart

  const samplesPerBucket = rangeLength / buckets

  for (let b = 0; b < buckets; b++) {
    const start = rangeStart + Math.floor(b * samplesPerBucket)
    // Ranges shorter than the bucket count give sub-sample buckets; widening
    // to at least one sample keeps every bucket defined instead of NaN.
    const end = Math.max(start + 1, Math.min(rangeEnd, rangeStart + Math.floor((b + 1) * samplesPerBucket)))

    let min = Infinity
    let max = -Infinity
    for (const data of channels) {
      for (let i = start; i < end && i < rangeEnd; i++) {
        const v = data[i]
        if (v < min) min = v
        if (v > max) max = v
      }
    }

    if (!Number.isFinite(min) || !Number.isFinite(max)) {
      min = 0
      max = 0
    }
    out[b * 2] = min
    out[b * 2 + 1] = max
  }

  return out
}
