import { sniffSampleRate } from './sniff'
import { decodeViaWorker } from '../worker-client'

export class DecodeError extends Error {}

export type DecodeResult = {
  buffer: AudioBuffer
  /**
   * Whether the buffer is genuinely at the file's own sample rate.
   *
   * False means the rate could not be determined before decoding, so the audio
   * was decoded at the output device's rate and has been resampled. The UI must
   * not claim the rate was preserved in that case.
   */
  rateConfirmed: boolean
  /** Whether the worker's ffmpeg was needed to decode this file at all. */
  usedWorkerFallback: boolean
}

/**
 * Decode a file to an AudioBuffer at its *own* sample rate.
 *
 * `decodeAudioData` always resamples to the decoding context's rate, and a bare
 * `new AudioContext()` adopts the output device's rate -- so decoding a 48 kHz
 * file on a machine whose output runs at 44.1 kHz silently produces a 44.1 kHz
 * buffer, and every "preserve the source rate" guarantee downstream then
 * faithfully preserves the wrong rate. That is precisely the downgrade this
 * project exists to avoid, so the rate is read from the file's header first and
 * the decode happens in a context created at it.
 */
export async function decodeFile(file: File): Promise<DecodeResult> {
  const bytes = await file.arrayBuffer()
  const sniffed = sniffSampleRate(bytes)

  // decodeAudioData detaches the buffer it is handed, so every attempt gets
  // its own copy and the original stays available for the fallback.
  if (sniffed) {
    try {
      const ctx = new OfflineAudioContext(2, 1, sniffed)
      const buffer = await ctx.decodeAudioData(bytes.slice(0))
      return { buffer, rateConfirmed: buffer.sampleRate === sniffed, usedWorkerFallback: false }
    } catch {
      // Recognised container, unsupported codec: fall through to the worker.
    }
  } else {
    try {
      const ctx = new AudioContext()
      const buffer = await ctx.decodeAudioData(bytes.slice(0))
      void ctx.close()
      // Decoded, but at the device's rate, and we cannot prove it matches.
      return { buffer, rateConfirmed: false, usedWorkerFallback: false }
    } catch {
      // fall through
    }
  }

  let wav: ArrayBuffer
  try {
    wav = await decodeViaWorker(file)
  } catch {
    throw new DecodeError(
      'This file could not be decoded by the browser. Start the worker (npm run worker) to enable the ffmpeg fallback.',
    )
  }

  // The worker's WAV preserves the source rate, and a WAV header always sniffs,
  // so this path ends up rate-correct even when the original container did not.
  const wavRate = sniffSampleRate(wav)
  try {
    const ctx = wavRate ? new OfflineAudioContext(2, 1, wavRate) : new AudioContext()
    const buffer = await ctx.decodeAudioData(wav)
    if (!wavRate) void (ctx as AudioContext).close()
    return {
      buffer,
      rateConfirmed: !!wavRate && buffer.sampleRate === wavRate,
      usedWorkerFallback: true,
    }
  } catch {
    throw new DecodeError('The transcoded audio could not be decoded either.')
  }
}
