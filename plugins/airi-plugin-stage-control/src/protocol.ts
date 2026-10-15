import type { StageControlCommand } from '@proj-airi/stage-shared/stage-command'

import * as v from 'valibot'

const finiteNumber = v.pipe(v.number(), v.finite())
const positiveNumber = v.pipe(finiteNumber, v.check(value => value > 0))

const expressionCommand = v.object({
  requestId: v.optional(v.string()),
  action: v.literal('expression'),
  name: v.pipe(v.string(), v.minLength(1)),
  durationMs: v.optional(positiveNumber),
  intensity: v.optional(v.pipe(finiteNumber, v.minValue(0), v.maxValue(1))),
})

const motionCommand = v.object({
  requestId: v.optional(v.string()),
  action: v.literal('motion'),
  name: v.pipe(v.string(), v.minLength(1)),
  index: v.optional(v.pipe(v.number(), v.integer(), v.minValue(0))),
})

const speechCommand = v.object({
  requestId: v.optional(v.string()),
  action: v.literal('speech'),
  text: v.string(),
  speak: v.optional(v.boolean()),
})

const viewCommand = v.object({
  requestId: v.optional(v.string()),
  action: v.literal('view'),
  x: v.optional(finiteNumber),
  y: v.optional(finiteNumber),
  z: v.optional(finiteNumber),
  scale: v.optional(finiteNumber),
})

const modelCommand = v.object({
  requestId: v.optional(v.string()),
  action: v.literal('model'),
  modelId: v.pipe(v.string(), v.minLength(1)),
})

const windowCommand = v.object({
  requestId: v.optional(v.string()),
  action: v.literal('window'),
  visible: v.boolean(),
})

const stageControlDataSchema = v.variant('action', [
  expressionCommand,
  motionCommand,
  speechCommand,
  viewCommand,
  modelCommand,
  windowCommand,
])

/** One parsed stage control request. */
export interface StageControlRequest {
  requestId?: string
  command: StageControlCommand
}

/** Reads one `stage:control` data object. Throws when the payload is not valid. */
export function parseStageControlData(data: unknown): StageControlRequest {
  const parsed = v.safeParse(stageControlDataSchema, data)
  if (!parsed.success)
    throw new Error('The stage control payload is not valid.')

  if (
    parsed.output.action === 'view'
    && parsed.output.x === undefined
    && parsed.output.y === undefined
    && parsed.output.z === undefined
    && parsed.output.scale === undefined
  ) {
    throw new Error('The view action needs x, y, z, or scale.')
  }

  const { requestId, ...command } = parsed.output
  return {
    requestId,
    command,
  }
}
