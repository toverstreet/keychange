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

  if (sourceFrames === 0) {
    onProgress?.(1)
    return channels.map(() => new Float32Array(0))
  }

  if (isNeutral(params)) {
    onProgress?.(1)
    // A copy, not the same reference: callers treat the result as theirs.
    return channels.map((c) => c.slice())
  }

  // SoundTouchJS's pipeline is fixed at two interleaved channels, so anything
  // wider is processed as successive pairs. Handling only the first two would
  // export a 5.1 file with channels 2..n silent but present in the header --
  // broken in a way that looks fine until someone plays it on a surround rig.
  const out: Float32Array[] = []
  const pairs = Math.ceil(channels.length / 2)

  for (let pair = 0; pair < pairs; pair++) {
    const left = channels[pair * 2]
    const right = channels[pair * 2 + 1] ?? left
    const [l, r] = stretchPair(left, right, sampleRate, params, (f) =>
      onProgress?.((pair + f) / pairs),
    )
    out.push(l)
    if (channels[pair * 2 + 1]) out.push(r)
  }

  onProgress?.(1)
  return out
}

/** Stretch one stereo pair through a single SoundTouch pipeline, so the two
 *  channels stay phase-aligned rather than drifting apart. */
function stretchPair(
  left: Float32Array,
  right: Float32Array,
  sampleRate: number,
  params: StretchParams,
  onProgress?: (fraction: number) => void,
): [Float32Array, Float32Array] {
  const sourceFrames = left.length
  const expected = stretchedLength(sourceFrames, params.speed)
  const padFrames = Math.floor(FLUSH_PAD_SEC * sampleRate)
  const paddedFrames = sourceFrames + padFrames

  const source = {
    extract(target: Float32Array, numFrames: number, position: number): number {
      const available = Math.max(0, Math.min(numFrames, paddedFrames - position))
      for (let i = 0; i < available; i++) {
        const idx = position + i
        if (idx < sourceFrames) {
          target[i * 2] = left[idx]
          target[i * 2 + 1] = right[idx]
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

  const outL = new Float32Array(expected)
  const outR = new Float32Array(expected)
  const scratch = new Float32Array(CHUNK_FRAMES * 2)

  let written = 0
  // A bounded loop: a filter that stops producing must not hang the caller.
  let guard = Math.ceil((paddedFrames / CHUNK_FRAMES) * 8) + 256

  while (written < expected && guard-- > 0) {
    const extracted = filter.extract(scratch, CHUNK_FRAMES)
    if (extracted <= 0) break
    const take = Math.min(extracted, expected - written)
    for (let i = 0; i < take; i++) {
      outL[written + i] = scratch[i * 2]
      outR[written + i] = scratch[i * 2 + 1]
    }
    written += take
    onProgress?.(Math.min(1, written / expected))
  }

  // Shouldn't happen now the source is padded, but if the pipeline still comes
  // up short, hold the last sample rather than ending on a step to zero, which
  // would read as a click.
  if (written > 0 && written < expected) {
    outL.fill(outL[written - 1], written)
    outR.fill(outR[written - 1], written)
  }

  onProgress?.(1)
  return [outL, outR]
}
