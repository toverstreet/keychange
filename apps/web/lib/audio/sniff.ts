/**
 * Read the sample rate out of a file's header, without decoding it.
 *
 * This exists because `decodeAudioData` always resamples to the decoding
 * context's rate, and a bare `new AudioContext()` adopts the *output device's*
 * rate. Decode a 48 kHz file on a machine whose output is 44.1 kHz and the
 * AudioBuffer is 44.1 kHz -- every "preserve the source rate" guarantee
 * downstream then faithfully preserves a rate that was already changed. The
 * only way out is to know the true rate first and decode into a context
 * created at it.
 *
 * Returns null when the format is not recognised; callers fall back to the
 * worker's ffprobe, and failing that must say the rate is unknown rather than
 * claim it was preserved.
 */

const MPEG1_RATES = [44100, 48000, 32000]
const MPEG2_RATES = [22050, 24000, 16000]
const MPEG25_RATES = [11025, 12000, 8000]

function ascii(view: DataView, offset: number, length: number): string {
  let out = ''
  for (let i = 0; i < length; i++) out += String.fromCharCode(view.getUint8(offset + i))
  return out
}

/** RIFF/WAVE: walk chunks to `fmt `, whose sample rate is 4 bytes in at +12. */
function sniffWav(view: DataView): number | null {
  if (ascii(view, 0, 4) !== 'RIFF' || ascii(view, 8, 4) !== 'WAVE') return null
  let offset = 12
  while (offset + 8 <= view.byteLength) {
    const id = ascii(view, offset, 4)
    const size = view.getUint32(offset + 4, true)
    if (id === 'fmt ' && offset + 12 <= view.byteLength) {
      return view.getUint32(offset + 12, true) || null
    }
    offset += 8 + size + (size % 2)
  }
  return null
}

/**
 * FLAC STREAMINFO, relative to the `fLaC` marker: 4 marker + 4 block header +
 * 10 bytes of block sizes, then a 20-bit sample rate.
 */
function flacRateAt(view: DataView, markerOffset: number): number | null {
  const at = markerOffset + 18
  if (at + 3 > view.byteLength) return null
  const rate = (view.getUint8(at) << 12) | (view.getUint8(at + 1) << 4) | (view.getUint8(at + 2) >> 4)
  return rate || null
}

function sniffFlac(view: DataView): number | null {
  return flacRateAt(view, 0)
}

/**
 * ISO-BMFF (mp4/m4a): find the `mp4a` sample entry. Its sample rate sits 24
 * bytes into the box body as 16.16 fixed point, of which only the integer half
 * is meaningful.
 */
function sniffMp4(view: DataView): number | null {
  if (view.byteLength < 12) return null
  const brand = ascii(view, 4, 4)
  if (brand !== 'ftyp' && brand !== 'styp') return null

  // A linear scan for the four-character code is enough and avoids walking the
  // whole box tree; `mp4a` does not occur as box data in practice.
  for (let i = 0; i + 36 <= view.byteLength; i++) {
    if (
      view.getUint8(i) === 0x6d && // m
      view.getUint8(i + 1) === 0x70 && // p
      view.getUint8(i + 2) === 0x34 && // 4
      view.getUint8(i + 3) === 0x61 // a
    ) {
      const boxStart = i - 4 // back up over the size field
      const rate = view.getUint16(boxStart + 32, false)
      // A rate above 16 bits is stored elsewhere (esds); report unknown rather
      // than a wrong value.
      if (rate >= 8000 && rate <= 65535) return rate
      return null
    }
  }
  return null
}

/** MPEG audio frame header, skipping an ID3v2 tag if present. */
function sniffMp3(view: DataView): number | null {
  let offset = 0
  if (view.byteLength > 10 && ascii(view, 0, 3) === 'ID3') {
    // ID3v2 size is four syncsafe bytes: 7 significant bits each.
    const size =
      (view.getUint8(6) << 21) | (view.getUint8(7) << 14) | (view.getUint8(8) << 7) | view.getUint8(9)
    offset = 10 + size
  }

  const limit = Math.min(view.byteLength - 4, offset + 200_000)
  for (let i = offset; i < limit; i++) {
    if (view.getUint8(i) !== 0xff) continue
    const b1 = view.getUint8(i + 1)
    if ((b1 & 0xe0) !== 0xe0) continue

    const versionBits = (b1 >> 3) & 0x03
    if (versionBits === 1) continue // reserved
    const layerBits = (b1 >> 1) & 0x03
    if (layerBits === 0) continue // reserved

    const rateIndex = (view.getUint8(i + 2) >> 2) & 0x03
    if (rateIndex === 3) continue // reserved

    const table = versionBits === 3 ? MPEG1_RATES : versionBits === 2 ? MPEG2_RATES : MPEG25_RATES
    return table[rateIndex]
  }
  return null
}

/**
 * Ogg, which is a container rather than a codec: the payload may be Vorbis,
 * Opus or FLAC, and each carries its rate differently. ffmpeg writes FLAC into
 * `.ogg` by default, so that case is not exotic.
 */
function sniffOgg(view: DataView): number | null {
  if (ascii(view, 0, 4) !== 'OggS') return null
  const limit = Math.min(view.byteLength - 20, 65536)
  for (let i = 0; i < limit; i++) {
    if (ascii(view, i, 6) === 'vorbis') {
      // identification header: type(1) 'vorbis'(6) version(4) channels(1) rate(4)
      return view.getUint32(i + 11, true) || null
    }
    if (ascii(view, i, 8) === 'OpusHead') {
      // Opus always decodes at 48 kHz; its original input rate is informational.
      return 48000
    }
    if (ascii(view, i, 4) === 'fLaC') {
      return flacRateAt(view, i)
    }
  }
  return null
}

/**
 * Pick the sniffer from the container's magic bytes rather than trying each in
 * turn.
 *
 * The MPEG scanner hunts for a two-byte frame sync, which occurs by chance in
 * arbitrary binary data -- running it as a fallback made a FLAC-in-Ogg file
 * report 44100 instead of 48000. A recognised container that cannot be read
 * must return null so the caller falls back to the worker, never leak into a
 * guess from a different format.
 */
export function sniffSampleRate(bytes: ArrayBuffer): number | null {
  if (bytes.byteLength < 32) return null
  const view = new DataView(bytes)

  const inRange = (rate: number | null) =>
    rate && rate >= 8000 && rate <= 192000 ? rate : null

  try {
    const magic4 = ascii(view, 0, 4)
    if (magic4 === 'RIFF') return inRange(sniffWav(view))
    if (magic4 === 'fLaC') return inRange(sniffFlac(view))
    if (magic4 === 'OggS') return inRange(sniffOgg(view))
    if (ascii(view, 4, 4) === 'ftyp' || ascii(view, 4, 4) === 'styp') return inRange(sniffMp4(view))

    // MPEG has no container magic. Require either an ID3 tag or a frame sync
    // in the first few bytes before trusting the scanner at all.
    const hasId3 = ascii(view, 0, 3) === 'ID3'
    const looksMpeg = view.getUint8(0) === 0xff && (view.getUint8(1) & 0xe0) === 0xe0
    if (hasId3 || looksMpeg) return inRange(sniffMp3(view))

    return null
  } catch {
    // A truncated or malformed header is a miss, not a crash.
    return null
  }
}
