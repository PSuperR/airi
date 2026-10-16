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

const fadeMs = v.pipe(finiteNumber, v.minValue(0), v.maxValue(10000))

const vrmaCommand = v.object({
  requestId: v.optional(v.string()),
  action: v.literal('vrma'),
  src: v.pipe(v.string(), v.trim(), v.minLength(1)),
  loop: v.optional(v.boolean()),
  fadeInMs: v.optional(fadeMs),
  fadeOutMs: v.optional(fadeMs),
})

const windowCommand = v.object({
  requestId: v.optional(v.string()),
  action: v.literal('window'),
  visible: v.boolean(),
})

const motionKey = v.pipe(v.string(), v.trim(), v.minLength(1))
const tags = v.array(v.pipe(v.string(), v.maxLength(64)))
const description = v.pipe(v.string(), v.maxLength(1000))

const motionListCommand = v.object({
  requestId: v.optional(v.string()),
  action: v.literal('motion.list'),
  all: v.optional(v.boolean()),
})

const motionPlayCommand = v.object({
  requestId: v.optional(v.string()),
  action: v.literal('motion.play'),
  id: v.optional(motionKey),
  name: v.optional(motionKey),
  loop: v.optional(v.boolean()),
  fadeInMs: v.optional(fadeMs),
  fadeOutMs: v.optional(fadeMs),
})

const motionRenameCommand = v.object({
  requestId: v.optional(v.string()),
  action: v.literal('motion.rename'),
  id: motionKey,
  name: v.optional(v.pipe(v.string(), v.maxLength(128))),
  tags: v.optional(tags),
  description: v.optional(description),
})

const motionUploadCommand = v.object({
  requestId: v.optional(v.string()),
  action: v.literal('motion.upload'),
  fileName: v.optional(motionKey),
  path: v.optional(motionKey),
  base64: v.optional(v.pipe(v.string(), v.minLength(1))),
  name: v.optional(v.pipe(v.string(), v.maxLength(128))),
  tags: v.optional(tags),
  description: v.optional(description),
  overwrite: v.optional(v.boolean()),
})

const motionDeleteCommand = v.object({
  requestId: v.optional(v.string()),
  action: v.literal('motion.delete'),
  id: motionKey,
})

const motionSetDirectoryCommand = v.object({
  requestId: v.optional(v.string()),
  action: v.literal('motion.setDirectory'),
  directory: v.optional(motionKey),
  reset: v.optional(v.boolean()),
})

const stageControlDataSchema = v.variant('action', [
  motionListCommand,
  motionPlayCommand,
  motionRenameCommand,
  motionUploadCommand,
  motionDeleteCommand,
  motionSetDirectoryCommand,
  expressionCommand,
  motionCommand,
  speechCommand,
  viewCommand,
  modelCommand,
  vrmaCommand,
  windowCommand,
])

/** Motion library actions. The plugin runs them; only `motion.list` and `motion.play` read the stage. */
export type MotionLibraryCommand
  = | { action: 'motion.list', all?: boolean }
    | { action: 'motion.play', id?: string, name?: string, loop?: boolean, fadeInMs?: number, fadeOutMs?: number }
    | { action: 'motion.rename', id: string, name?: string, tags?: string[], description?: string }
    | { action: 'motion.upload', fileName?: string, path?: string, base64?: string, name?: string, tags?: string[], description?: string, overwrite?: boolean }
    | { action: 'motion.delete', id: string }
    | { action: 'motion.setDirectory', directory?: string, reset?: boolean }

/** Every action the plugin accepts. */
export type PluginControlCommand = StageControlCommand | MotionLibraryCommand

/** One parsed stage control request. */
export interface StageControlRequest {
  requestId?: string
  command: PluginControlCommand
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

  if (parsed.output.action === 'motion.play' && parsed.output.id === undefined && parsed.output.name === undefined)
    throw new Error('The motion.play action needs id or name.')
  if (parsed.output.action === 'motion.upload' && (parsed.output.path === undefined) === (parsed.output.base64 === undefined))
    throw new Error('The motion.upload action needs either path or base64.')
  if (parsed.output.action === 'motion.upload' && parsed.output.base64 !== undefined && parsed.output.fileName === undefined)
    throw new Error('The motion.upload action needs fileName with base64.')
  if (parsed.output.action === 'motion.setDirectory' && parsed.output.directory === undefined && !parsed.output.reset)
    throw new Error('The motion.setDirectory action needs directory or reset: true.')

  const { requestId, ...command } = parsed.output
  return {
    requestId,
    command,
  }
}
