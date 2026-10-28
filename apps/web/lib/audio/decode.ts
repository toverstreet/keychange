import { workerUrl } from '../worker-client'

export class DecodeError extends Error {}

/**
 * Decode a file to an AudioBuffer, falling back to the worker's ffmpeg.
 *
 * Browsers decode a narrower set of codecs than ffmpeg does, and which ones
 * varies by browser and OS. Rather than sniff formats, try the fast native path
 * and treat a throw as the signal to transcode. The fallback preserves the
 * source sample rate, so taking it does not silently downgrade the audio.
 */
export async function decodeFile(file: File, ctx: BaseAudioContext): Promise<AudioBuffer> {
  const bytes = await file.arrayBuffer()

  try {
    // decodeAudioData detaches the buffer it is given, so hand it a copy and
    // keep the original for a possible fallback.
    return await ctx.decodeAudioData(bytes.slice(0))
  } catch {
    // fall through
  }

  let wav: ArrayBuffer
  try {
    const form = new FormData()
    form.append('file', file)
    const res = await fetch(`${workerUrl()}/decode`, { method: 'POST', body: form })
    if (!res.ok) {
      throw new DecodeError(
        `This file could not be decoded by the browser, and the worker rejected it (${res.status}).`,
      )
    }
    wav = await res.arrayBuffer()
  } catch (err) {
    if (err instanceof DecodeError) throw err
    throw new DecodeError(
      'This file could not be decoded by the browser. Start the worker (npm run worker) to enable the ffmpeg fallback.',
    )
  }

  try {
    return await ctx.decodeAudioData(wav)
  } catch {
    throw new DecodeError('The transcoded audio could not be decoded either.')
  }
}
