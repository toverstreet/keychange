/** Minimal AudioBuffer stand-in. Node has no Web Audio, and the peak reducer
 *  only needs length, numberOfChannels and getChannelData. */
export function makeBuffer(opts: {
  length: number
  channels: number
  sampleRate?: number
  fill: (i: number, channel: number) => number
}): AudioBuffer {
  const { length, channels, sampleRate = 48000, fill } = opts
  const data = Array.from({ length: channels }, (_, ch) =>
    Float32Array.from({ length }, (_, i) => fill(i, ch)),
  )
  return {
    length,
    duration: length / sampleRate,
    sampleRate,
    numberOfChannels: channels,
    getChannelData: (ch: number) => data[ch],
  } as unknown as AudioBuffer
}
