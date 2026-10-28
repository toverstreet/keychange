import { OfflineAudioContext } from 'node-web-audio-api'

export const SR = 48000

/** node-web-audio-api is a real Web Audio implementation, so these tests render
 *  through the same node graph the browser will, not a mock of it. */
export function makeOfflineContext(channels: number, seconds: number, sampleRate = SR) {
  return new OfflineAudioContext(channels, Math.ceil(seconds * sampleRate), sampleRate) as unknown as OfflineAudioContext
}

export function bufferFrom(
  ctx: BaseAudioContext,
  channelData: Float32Array[],
  sampleRate = SR,
): AudioBuffer {
  const buf = ctx.createBuffer(channelData.length, channelData[0].length, sampleRate)
  channelData.forEach((data, ch) => buf.copyToChannel(data as Float32Array<ArrayBuffer>, ch))
  return buf
}
