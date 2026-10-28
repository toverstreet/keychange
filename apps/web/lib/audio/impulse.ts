/**
 * A generated impulse response for the reverb convolver.
 *
 * Generated rather than shipped as an audio file: no binary asset in the repo,
 * no licensing question about someone else's room recording, and the length and
 * decay become parameters instead of fixed properties of a file.
 */
export function generateImpulse(
  ctx: BaseAudioContext,
  seconds = 2.4,
  decay = 3.2,
  seed = 1,
): AudioBuffer {
  const rate = ctx.sampleRate
  const length = Math.max(1, Math.floor(seconds * rate))
  const impulse = ctx.createBuffer(2, length, rate)

  // A seeded PRNG so the reverb is identical between the preview and the
  // export. Math.random here would make exports non-reproducible and would
  // quietly break the parity guarantee.
  let state = seed
  const rand = () => {
    state = (state * 1664525 + 1013904223) % 4294967296
    return state / 2147483648 - 1
  }

  for (let ch = 0; ch < 2; ch++) {
    const data = impulse.getChannelData(ch)
    for (let i = 0; i < length; i++) {
      // Exponentially decaying noise: the standard cheap approximation of a
      // diffuse room tail.
      data[i] = rand() * Math.pow(1 - i / length, decay)
    }
  }

  return impulse
}
