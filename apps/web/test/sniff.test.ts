import { describe, it, expect } from 'vitest'
import { sniffSampleRate } from '../lib/audio/sniff'

function bytes(...parts: Array<number[] | string>): ArrayBuffer {
  const flat: number[] = []
  for (const p of parts) {
    if (typeof p === 'string') for (const c of p) flat.push(c.charCodeAt(0))
    else flat.push(...p)
  }
  return new Uint8Array(flat).buffer
}
const u32le = (n: number) => [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255]
const pad = (n: number) => new Array(n).fill(0)

describe('WAV', () => {
  it('reads the rate from the fmt chunk', () => {
    const buf = bytes('RIFF', u32le(1000), 'WAVE', 'fmt ', u32le(16), [1, 0, 2, 0], u32le(48000), pad(40))
    expect(sniffSampleRate(buf)).toBe(48000)
  })

  it('reads 44.1 kHz too, so the test is not passing on a constant', () => {
    const buf = bytes('RIFF', u32le(1000), 'WAVE', 'fmt ', u32le(16), [1, 0, 2, 0], u32le(44100), pad(40))
    expect(sniffSampleRate(buf)).toBe(44100)
  })

  it('skips a leading LIST chunk to find fmt', () => {
    const buf = bytes(
      'RIFF', u32le(1000), 'WAVE',
      'LIST', u32le(8), pad(8),
      'fmt ', u32le(16), [1, 0, 2, 0], u32le(96000), pad(40),
    )
    expect(sniffSampleRate(buf)).toBe(96000)
  })
})

describe('FLAC', () => {
  it('reads the 20-bit rate from STREAMINFO', () => {
    const rate = 48000
    const header = pad(18)
    const b = [(rate >> 12) & 0xff, (rate >> 4) & 0xff, (rate & 0x0f) << 4]
    expect(sniffSampleRate(bytes('fLaC', header.slice(4), b, pad(16)))).toBe(48000)
  })
})

describe('MP3', () => {
  it('reads MPEG-1 44.1 kHz', () => {
    // 0xFF 0xFB = MPEG1 Layer III; rate index 0 -> 44100
    expect(sniffSampleRate(bytes([0xff, 0xfb, 0x90, 0x00], pad(44)))).toBe(44100)
  })

  it('reads MPEG-1 48 kHz', () => {
    // rate index 1 -> 48000 (bits 3-2 of byte 2)
    expect(sniffSampleRate(bytes([0xff, 0xfb, 0x94, 0x00], pad(44)))).toBe(48000)
  })

  it('reads MPEG-2 22.05 kHz', () => {
    expect(sniffSampleRate(bytes([0xff, 0xf3, 0x90, 0x00], pad(44)))).toBe(22050)
  })

  it('skips an ID3v2 tag before the first frame', () => {
    const tagSize = 32
    const buf = bytes(
      'ID3', [3, 0, 0], [0, 0, 0, tagSize],
      pad(tagSize),
      [0xff, 0xfb, 0x94, 0x00], pad(40),
    )
    expect(sniffSampleRate(buf)).toBe(48000)
  })
})

describe('MP4 / M4A', () => {
  it('reads the rate from the mp4a sample entry', () => {
    // ftyp box, then an mp4a entry whose 16.16 rate begins 24 bytes into the body.
    const head = bytes(u32le(20), 'ftyp', 'M4A ', pad(8))
    const mp4aSize = [0, 0, 0, 36]
    const body = [...pad(24), 0xbb, 0x80, 0, 0] // 0xBB80 = 48000
    const buf = new Uint8Array([...new Uint8Array(head), ...mp4aSize, ...'mp4a'.split('').map((c) => c.charCodeAt(0)), ...body, ...pad(16)])
    expect(sniffSampleRate(buf.buffer)).toBe(48000)
  })
})

describe('Ogg', () => {
  it('reads FLAC carried inside Ogg, which is what ffmpeg writes to .ogg by default', () => {
    const rate = 48000
    const streaminfo = [...pad(10), (rate >> 12) & 0xff, (rate >> 4) & 0xff, (rate & 0x0f) << 4]
    const buf = bytes('OggS', pad(24), 'fLaC', pad(4), streaminfo, pad(16))
    expect(sniffSampleRate(buf)).toBe(48000)
  })

  it('reports 48 kHz for Opus, which always decodes at that rate', () => {
    expect(sniffSampleRate(bytes('OggS', pad(24), 'OpusHead', pad(40)))).toBe(48000)
  })

  it('returns null for an Ogg whose payload it cannot read, rather than guessing', () => {
    // Must NOT fall through to the MPEG scanner: a two-byte frame sync occurs
    // by chance in arbitrary binary data, and doing exactly this made a real
    // 48 kHz FLAC-in-Ogg file report 44100.
    const buf = bytes('OggS', [0xff, 0xfb, 0x90, 0x00], pad(120))
    expect(sniffSampleRate(buf)).toBeNull()
  })
})

describe('unknown input', () => {
  it('returns null rather than guessing', () => {
    expect(sniffSampleRate(new Uint8Array(64).buffer)).toBeNull()
    expect(sniffSampleRate(bytes('NOPE', pad(60)))).toBeNull()
  })

  it('returns null for a buffer too short to hold a header', () => {
    expect(sniffSampleRate(new Uint8Array(8).buffer)).toBeNull()
  })

  it('does not run the MPEG scanner on data with no MPEG signature', () => {
    const buf = bytes('XXXX', pad(8), [0xff, 0xfb, 0x90, 0x00], pad(60))
    expect(sniffSampleRate(buf)).toBeNull()
  })

  it('rejects an out-of-range rate rather than reporting it', () => {
    const buf = bytes('RIFF', u32le(1000), 'WAVE', 'fmt ', u32le(16), [1, 0, 2, 0], u32le(5), pad(40))
    expect(sniffSampleRate(buf)).toBeNull()
  })
})
