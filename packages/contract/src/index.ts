import { z } from 'zod'

export * from './params'
import { EQ_BAND_COUNT } from './params'

/**
 * Worker -> frontend contract.
 *
 * Every worker response is parsed through these schemas before it reaches the
 * UI. That matters more than it looks: the whole point of the single
 * `worker-client` seam is that a hosted worker can replace the local one, and
 * an unvalidated response is how that swap turns into a silent frontend bug.
 */

export const analysisResultSchema = z.object({
  /** Pitch class, e.g. "G", "C#". */
  key: z.string().min(1),
  scale: z.enum(['major', 'minor']),
  /** Margin between the best and runner-up key, not a raw correlation. */
  keyConfidence: z.number().min(0).max(1),
  bpm: z.number().positive(),
  bpmConfidence: z.number().min(0).max(1),
  /** Beat onsets in seconds. Loop snapping needs these, not just the BPM. */
  beatGrid: z.array(z.number().nonnegative()),
  /** Median voiced fundamental, the reference-pitch figure keypitch.app shows. */
  pitchHz: z.number().nonnegative(),
  durationSec: z.number().positive(),
  /** The *source* sample rate, not the rate analysis ran at. */
  sampleRate: z.number().positive(),
})
export type AnalysisResult = z.infer<typeof analysisResultSchema>

export const separationJobSchema = z.object({
  id: z.string().min(1),
  status: z.enum(['queued', 'running', 'done', 'error']),
  progress: z.number().min(0).max(1),
  error: z.string().nullable(),
  stems: z
    .object({ vocals: z.string(), instrumental: z.string() })
    .nullable(),
})
export type SeparationJob = z.infer<typeof separationJobSchema>

export const healthSchema = z.object({ ok: z.literal(true) })

/** Shape used by the shareable-link encoder. Validated on decode because the
 *  payload arrives from a URL. */
export const paramsSchema = z.object({
  pitchSemitones: z.number(),
  speed: z.number(),
  reverbMix: z.number(),
  eqGainsDb: z.array(z.number()).length(EQ_BAND_COUNT),
  eightD: z.boolean(),
  loop: z.object({ a: z.number(), b: z.number() }).nullable(),
})

/** Low-confidence answers are shown qualified rather than asserted. A
 *  confidently wrong key is worse than an uncertain one when tuning to it. */
export const LOW_CONFIDENCE_THRESHOLD = 0.4
