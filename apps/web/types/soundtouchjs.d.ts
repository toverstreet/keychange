/** soundtouchjs 0.3.0 ships no type declarations. Only the synchronous buffer
 *  path is used by this project, so only that surface is declared. */
declare module 'soundtouchjs' {
  export class SoundTouch {
    pitchSemitones: number
    tempo: number
    rate: number
  }

  /** A source the filter pulls from: fills `target` with interleaved stereo
   *  frames starting at `position` and returns how many frames it wrote. */
  export interface SoundTouchSource {
    extract(target: Float32Array, numFrames: number, position: number): number
  }

  export class SimpleFilter {
    constructor(source: SoundTouchSource, pipe: SoundTouch)
    extract(target: Float32Array, numFrames: number): number
    clear(): void
  }
}
