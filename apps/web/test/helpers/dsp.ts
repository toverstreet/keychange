/** Goertzel magnitude at one frequency. Cheaper and more precise for probing a
 *  known frequency than a full FFT, and needs no dependency. */
export function magnitudeAt(x: Float32Array, freq: number, sampleRate: number): number {
  const n = x.length
  if (n === 0) return 0
  const w = (2 * Math.PI * freq) / sampleRate
  const coeff = 2 * Math.cos(w)
  let s1 = 0
  let s2 = 0
  for (let i = 0; i < n; i++) {
    const s0 = x[i] + coeff * s1 - s2
    s2 = s1
    s1 = s0
  }
  return Math.sqrt(s1 * s1 + s2 * s2 - coeff * s1 * s2) / (n / 2)
}

/** Dominant frequency by scanning candidate bins around the audible range.
 *  Coarse then refined, which is accurate to well under a semitone. */
export function dominantFreq(x: Float32Array, sampleRate: number, lo = 60, hi = 4000): number {
  const stable = x.subarray(Math.floor(x.length * 0.25), Math.floor(x.length * 0.75))
  let best = lo
  let bestMag = -1
  for (let f = lo; f <= hi; f += 1) {
    const m = magnitudeAt(stable, f, sampleRate)
    if (m > bestMag) {
      bestMag = m
      best = f
    }
  }
  for (let f = best - 1; f <= best + 1; f += 0.05) {
    const m = magnitudeAt(stable, f, sampleRate)
    if (m > bestMag) {
      bestMag = m
      best = f
    }
  }
  return best
}

export function rms(x: Float32Array): number {
  let sum = 0
  for (const v of x) sum += v * v
  return Math.sqrt(sum / Math.max(1, x.length))
}

/** RMS of a one-third-octave band around `freq`, via a naive biquad sweep-free
 *  approach: Goertzel magnitude is enough to compare two renders band by band. */
export function bandLevelDb(x: Float32Array, freq: number, sampleRate: number): number {
  const m = magnitudeAt(x.subarray(Math.floor(x.length * 0.1), Math.floor(x.length * 0.9)), freq, sampleRate)
  return 20 * Math.log10(Math.max(m, 1e-12))
}

export function sine(freq: number, seconds: number, sampleRate: number): Float32Array {
  const out = new Float32Array(Math.floor(seconds * sampleRate))
  for (let i = 0; i < out.length; i++) out[i] = Math.sin((2 * Math.PI * freq * i) / sampleRate)
  return out
}

export function whiteNoise(seconds: number, sampleRate: number, seed = 1): Float32Array {
  const out = new Float32Array(Math.floor(seconds * sampleRate))
  let s = seed
  for (let i = 0; i < out.length; i++) {
    s = (s * 1664525 + 1013904223) % 4294967296
    out[i] = (s / 2147483648 - 1) * 0.5
  }
  return out
}
