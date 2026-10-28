/**
 * WAV encoding.
 *
 * 32-bit float PCM (format 3) rather than 16-bit integer: the render pipeline is
 * float throughout, and quantising here would be a lossy step taken on the way
 * to a *lossless* export. It also avoids quantising twice when the result is
 * then encoded to MP3.
 */
export function encodeWav(buffer: AudioBuffer): Uint8Array {
  const channels = buffer.numberOfChannels
  const frames = buffer.length
  const sampleRate = buffer.sampleRate
  const bytesPerSample = 4
  const blockAlign = channels * bytesPerSample
  const dataBytes = frames * blockAlign

  const out = new ArrayBuffer(44 + dataBytes)
  const view = new DataView(out)

  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i))
  }

  ascii(0, 'RIFF')
  view.setUint32(4, 36 + dataBytes, true)
  ascii(8, 'WAVE')
  ascii(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 3, true) // 3 = IEEE float
  view.setUint16(22, channels, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * blockAlign, true)
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, bytesPerSample * 8, true)
  ascii(36, 'data')
  view.setUint32(40, dataBytes, true)

  const data = Array.from({ length: channels }, (_, ch) => buffer.getChannelData(ch))
  let offset = 44
  for (let i = 0; i < frames; i++) {
    for (let ch = 0; ch < channels; ch++) {
      view.setFloat32(offset, data[ch][i], true)
      offset += 4
    }
  }

  return new Uint8Array(out)
}
