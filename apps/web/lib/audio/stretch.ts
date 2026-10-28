import { SimpleFilter, SoundTouch } from 'soundtouchjs'

/**
 * Independent pitch and time stretching.
 *
 * This is the single stretch implementation in the project. Both live playback
 * and export go through it, which is what makes "what you download is what you
 * heard" structural rather than merely tested. Measured cost on the 8.5-minute
 * reference file is ~0.5 s for the whole track, which is why re-rendering on a
 * parameter change is affordable and no real-time (ScriptProcessor or
 * AudioWorklet) path is needed at all.
 */

/**
 * Silence appended to the source before processing, to push the pipeline tail
 * out of SoundTouch's internal FIFO.
 *
 * Without it, extracting until the source runs dry loses 170-500 ms off the end
 * -- and the shortfall does not grow with input length, so it is a latency tail
 * rather than a rate error. On the full reference file it cost 10,762 frames.
 * Unhandled this clips the end of every export, which is invisible to any
 * "does it sound right?" check because nobody listens to the last half-second.
 * 1.0 s is comfortably past the 0.5 s worst case measured. See spike/README.md.
 */
export const FLUSH_PAD_SEC = 1.0

const CHUNK_FRAMES = 16384

export type StretchParams = {
  pitchSemitones: number
  speed: number
}

/** Output length for a given source length and speed. Exact, not approximate --
 *  callers allocate against this and the result is trimmed to match. */
export function stretchedLength(sourceFrames: number, speed: number): number {
  return Math.round(sourceFrames / speed)
}

export function isNeutral(params: StretchParams): boolean {
  return params.pitchSemitones === 0 && params.speed === 1
}

/**
 * Stretch per-channel Float32Arrays. Channels are processed together through one
 * interleaved pipeline so they stay phase-aligned; processing them separately
 * would let their windowing drift apart and smear the stereo image.
 */
export function stretchChannels(
  channels: Float32Array[],
  sampleRate: number,
  params: StretchParams,
  onProgress?: (fraction: number) => void,
): Float32Array[] {
  const sourceFrames = channels[0]?.length ?? 0
  const channelCount = channels.length

  if (sourceFrames === 0) {
    onProgress?.(1)
    return channels.map(() => new Float32Array(0))
  }

  if (isNeutral(params)) {
    onProgress?.(1)
    // A copy, not the same reference: callers treat the result as theirs.
    return channels.map((c) => c.slice())
  }

  const expected = stretchedLength(sourceFrames, params.speed)
  const padFrames = Math.floor(FLUSH_PAD_SEC * sampleRate)
  const paddedFrames = sourceFrames + padFrames

  // SoundTouchJS's pipeline is fixed at two interleaved channels.
  const source = {
    extract(target: Float32Array, numFrames: number, position: number): number {
      const available = Math.max(0, Math.min(numFrames, paddedFrames - position))
      for (let i = 0; i < available; i++) {
        const idx = position + i
        if (idx < sourceFrames) {
          target[i * 2] = channels[0][idx]
          target[i * 2 + 1] = channelCount > 1 ? channels[1][idx] : channels[0][idx]
        } else {
          target[i * 2] = 0
          target[i * 2 + 1] = 0
        }
      }
      return available
    },
  }

  const soundTouch = new SoundTouch()
  soundTouch.pitchSemitones = params.pitchSemitones
  soundTouch.tempo = params.speed
  const filter = new SimpleFilter(source, soundTouch)

  const out = channels.map(() => new Float32Array(expected))
  const scratch = new Float32Array(CHUNK_FRAMES * 2)

  let written = 0
  let extracted = 0
  // A bounded loop: a filter that stops producing must not hang the worker.
  let guard = Math.ceil((paddedFrames / CHUNK_FRAMES) * 8) + 256

  while (written < expected && guard-- > 0) {
    extracted = filter.extract(scratch, CHUNK_FRAMES)
    if (extracted <= 0) break
    const take = Math.min(extracted, expected - written)
    for (let i = 0; i < take; i++) {
      out[0][written + i] = scratch[i * 2]
      if (channelCount > 1) out[1][written + i] = scratch[i * 2 + 1]
    }
    written += take
    onProgress?.(Math.min(1, written / expected))
  }

  // Shouldn't happen now that the source is padded, but if the pipeline still
  // comes up short, hold the last sample rather than ending on a step to zero,
  // which would read as a click.
  if (written > 0 && written < expected) {
    for (let ch = 0; ch < channelCount; ch++) {
      out[ch].fill(out[ch][written - 1], written)
    }
  }

  onProgress?.(1)
  return out
}
