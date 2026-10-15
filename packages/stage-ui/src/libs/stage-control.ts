import type { StageControlRequest, StageControlResult } from '@proj-airi/server-sdk'
import type { InferOutput } from 'valibot'

import type { StageModelRenderer } from '../stores/settings/stage-model'

import { errorMessageFrom } from '@moeru/std'
import {
  boolean,
  check,
  integer,
  literal,
  minLength,
  minValue,
  number,
  object,
  optional,
  pipe,
  safeParse,
  string,
  variant,
} from 'valibot'

/** VRM expression names the stage can set from an external command. */
export const vrmStageControlExpressionNames = ['happy', 'sad', 'angry', 'surprised', 'neutral', 'think', 'relaxed'] as const

const vrmExpressionNames = new Set<string>(vrmStageControlExpressionNames)

const stageControlActions = ['expression', 'motion', 'caption', 'transform', 'model', 'window'] as const

const idSchema = pipe(string(), minLength(1, 'Stage control needs an id.'))

const positiveSeconds = optional(pipe(
  number('Duration must be a number of seconds.'),
  check(value => Number.isFinite(value) && value > 0, 'Duration must be greater than 0 seconds.'),
))

const intensitySchema = optional(pipe(
  number('Intensity must be a number.'),
  check(value => Number.isFinite(value) && value > 0 && value <= 1, 'Intensity must be greater than 0 and at most 1.'),
))

const axisSchema = optional(pipe(
  number('Transform values must be numbers.'),
  check((value: number) => Number.isFinite(value), 'Transform values must be finite numbers.'),
))

const stageControlSchema = variant('action', [
  object({
    id: idSchema,
    action: literal('expression'),
    name: pipe(string(), minLength(1, 'Expression needs a name.')),
    duration: positiveSeconds,
    intensity: intensitySchema,
  }),
  object({
    id: idSchema,
    action: literal('motion'),
    file: optional(pipe(string(), minLength(1, 'Motion file must not be empty.'))),
    group: optional(pipe(string(), minLength(1, 'Motion group must not be empty.'))),
    index: optional(pipe(
      number('Motion index must be a whole number.'),
      integer('Motion index must be a whole number.'),
      minValue(0, 'Motion index must be 0 or greater.'),
    )),
  }),
  object({
    id: idSchema,
    action: literal('caption'),
    text: string('Caption text must be a string.'),
    speak: optional(boolean('Caption speak must be true or false.')),
  }),
  object({
    id: idSchema,
    action: literal('transform'),
    x: axisSchema,
    y: axisSchema,
    z: axisSchema,
    scale: axisSchema,
  }),
  object({
    id: idSchema,
    action: literal('model'),
    modelId: pipe(string(), minLength(1, 'Model needs a modelId.')),
  }),
  object({
    id: idSchema,
    action: literal('window'),
    visible: boolean('Window visible must be true or false.'),
  }),
])

type ParsedStageControl = InferOutput<typeof stageControlSchema>

/** Scene operations the stage control applier calls. The stage owns the model and the window. */
export interface StageControlScene {
  renderer: StageModelRenderer
  setLive2dExpression: (name: string, duration?: number) => Promise<boolean>
  setVrmExpression: (name: string, intensity: number) => Promise<void> | void
  resolveLive2dMotionFile: (group: string, index: number) => string | undefined
  playLive2dMotion: (file: string) => Promise<boolean>
  setLive2dView: (key: 'x' | 'y' | 'scale', value: number) => void
  setVrmView: (key: 'x' | 'y' | 'z', value: number) => void
  showCaption: (text: string) => void
  speak: (text: string) => Promise<void>
  setModel: (modelId: string) => Promise<void>
  /** Absent when this runtime has no main window. */
  setWindowVisible?: (visible: boolean) => Promise<void> | void
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function requestId(data: unknown) {
  return isRecord(data) && typeof data.id === 'string' ? data.id : ''
}

/**
 * Reads one `stage:control` payload.
 *
 * @example
 * readStageControlRequest({ id: '1', action: 'window', visible: true })
 * // => { ok: true, request: { id: '1', action: 'window', visible: true } }
 */
export function readStageControlRequest(data: unknown): { ok: true, request: StageControlRequest } | { ok: false, id: string, error: string } {
  if (!isRecord(data))
    return { ok: false, id: '', error: 'Stage control data must be an object.' }

  if (typeof data.action !== 'string' || !stageControlActions.includes(data.action as typeof stageControlActions[number]))
    return { ok: false, id: requestId(data), error: 'Unknown stage control action.' }

  const parsed = safeParse(stageControlSchema, data)
  if (!parsed.success) {
    return {
      ok: false,
      id: requestId(data),
      error: parsed.issues[0]?.message ?? 'Invalid stage control payload.',
    }
  }

  const request = toStageControlRequest(parsed.output)
  if (request.action === 'motion' && !request.file && !request.group)
    return { ok: false, id: request.id, error: 'A motion needs a file name or a group.' }

  if (request.action === 'transform' && request.x === undefined && request.y === undefined && request.z === undefined && request.scale === undefined)
    return { ok: false, id: request.id, error: 'Transform needs x, y, z, or scale.' }

  return { ok: true, request }
}

function toStageControlRequest(output: ParsedStageControl): StageControlRequest {
  return output
}

function rendererLabel(renderer: StageModelRenderer) {
  return renderer ?? 'unloaded'
}

/** Builds the action handlers for one loaded stage. */
export function createStageControlHandlers(scene: StageControlScene): {
  [Action in StageControlRequest['action']]: (request: Extract<StageControlRequest, { action: Action }>) => Promise<void>
} {
  return {
    async expression(request) {
      if (scene.renderer === 'live2d') {
        const active = await scene.setLive2dExpression(request.name, request.duration)
        if (!active)
          throw new Error(`Live2D expression "${request.name}" is not available on the loaded model.`)
        return
      }

      if (scene.renderer === 'vrm') {
        if (!vrmExpressionNames.has(request.name))
          throw new Error(`VRM expression "${request.name}" is not supported. Use ${vrmStageControlExpressionNames.join(', ')}.`)
        await scene.setVrmExpression(request.name, request.intensity ?? 1)
        return
      }

      throw new Error(`Expression is not supported for the "${rendererLabel(scene.renderer)}" model.`)
    },
    async motion(request) {
      if (scene.renderer === 'vrm')
        throw new Error('VRM does not play a named motion. The model loops its idle animation.')
      if (scene.renderer !== 'live2d')
        throw new Error(`Motion is not supported for the "${rendererLabel(scene.renderer)}" model.`)

      let file = request.file
      if (!file) {
        const group = request.group
        if (!group)
          throw new Error('A motion needs a file name or a group.')
        const index = request.index ?? 0
        const resolved = scene.resolveLive2dMotionFile(group, index)
        if (!resolved)
          throw new Error(`Live2D motion group "${group}" index ${index} is not on the loaded model.`)
        file = resolved
      }

      const played = await scene.playLive2dMotion(file)
      if (!played)
        throw new Error(`Live2D motion "${file}" is not available on the loaded model.`)
    },
    async caption(request) {
      scene.showCaption(request.text)
      if (!request.speak)
        return
      if (!request.text.trim())
        throw new Error('Speech needs text.')
      await scene.speak(request.text)
    },
    async transform(request) {
      if (scene.renderer === 'live2d') {
        if (request.z !== undefined)
          throw new Error('Live2D has no z position.')
        const x = request.x
        const y = request.y
        const scale = request.scale
        if (x !== undefined)
          scene.setLive2dView('x', x)
        if (y !== undefined)
          scene.setLive2dView('y', y)
        if (scale !== undefined)
          scene.setLive2dView('scale', scale)
        return
      }

      if (scene.renderer === 'vrm') {
        if (request.scale !== undefined)
          throw new Error('VRM has no model scale. Set x, y, or z.')
        const x = request.x
        const y = request.y
        const z = request.z
        if (x !== undefined)
          scene.setVrmView('x', x)
        if (y !== undefined)
          scene.setVrmView('y', y)
        if (z !== undefined)
          scene.setVrmView('z', z)
        return
      }

      throw new Error(`Scale and position are not supported for the "${rendererLabel(scene.renderer)}" model.`)
    },
    async model(request) {
      await scene.setModel(request.modelId)
    },
    async window(request) {
      if (!scene.setWindowVisible)
        throw new Error('This runtime cannot show or hide the main window.')
      await scene.setWindowVisible(request.visible)
    },
  }
}

/** Applies one raw `stage:control` payload and returns the result event data. */
export async function runStageControl(data: unknown, scene: StageControlScene): Promise<StageControlResult> {
  const parsed = readStageControlRequest(data)
  if (!parsed.ok)
    return { id: parsed.id, ok: false, error: parsed.error }

  try {
    const handlers = createStageControlHandlers(scene)
    switch (parsed.request.action) {
      case 'expression':
        await handlers.expression(parsed.request)
        break
      case 'motion':
        await handlers.motion(parsed.request)
        break
      case 'caption':
        await handlers.caption(parsed.request)
        break
      case 'transform':
        await handlers.transform(parsed.request)
        break
      case 'model':
        await handlers.model(parsed.request)
        break
      case 'window':
        await handlers.window(parsed.request)
        break
    }
    return { id: parsed.request.id, ok: true }
  }
  catch (error) {
    return {
      id: parsed.request.id,
      ok: false,
      error: errorMessageFrom(error) ?? 'Stage control failed.',
    }
  }
}
