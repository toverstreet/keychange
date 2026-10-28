/**
 * TypeScript 5.7 parameterised TypedArray by its backing buffer, so a
 * `Float32Array` produced by `.slice()` (`ArrayBufferLike`) no longer satisfies
 * the `Float32Array<ArrayBuffer>` that `copyToChannel` asks for -- even though
 * the two are identical at runtime and a SharedArrayBuffer never appears here.
 *
 * Confining the assertion to this one helper keeps it out of the audio code,
 * where a stray cast would be easy to mistake for something meaningful.
 */
export type Samples = Float32Array<ArrayBuffer>

export function writeChannel(buffer: AudioBuffer, data: Float32Array, channel: number): void {
  buffer.copyToChannel(data as Samples, channel)
}
