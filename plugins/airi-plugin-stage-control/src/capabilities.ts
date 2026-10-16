import type { StageCommandResult } from '@proj-airi/stage-shared/stage-command'

import type { StageKitClient } from './kit'
import type { MotionLibrary } from './motion-library'

import { readStageState } from './motion-actions'
import { stageControlActionSchemas } from './protocol'

/** A JSON description of one field, built from its valibot schema. */
export interface FieldDescription {
  type: string
  required?: boolean
  min?: number
  max?: number
  minLength?: number
  maxLength?: number
  pattern?: string
  integer?: boolean
  enum?: unknown[]
  fields?: Record<string, FieldDescription>
  items?: FieldDescription
}

/** One action with its fields and a short purpose. */
export interface ActionDescription {
  action: string
  description: string
  fields: Record<string, FieldDescription>
}

const descriptions: Record<string, string> = {
  'capabilities': 'Lists every action with its fields, plus a snapshot of the stage. Call it first.',
  'state': 'Reads the model type, Live2D motion groups, view, and VRM lighting.',
  'expression': 'Shows a model expression. VRM names: happy, angry, sad, relaxed, surprised, etc.',
  'motion': 'Plays a Live2D motion by group or file name. Live2D only.',
  'speech': 'Shows a caption and optionally speaks it.',
  'view': 'Moves and sizes the model. Live2D: x/y percent (-500..500), scale 0.01..3. VRM: x/y/z meters (-10..10), scale = camera distance 0..10. Values are clamped.',
  'model': 'Switches the display model by id, e.g. preset-vrm-1.',
  'vrma': 'Plays a .vrma clip on a VRM model. src: http(s), file:// URL, or absolute path.',
  'light': 'Changes VRM scene lighting; values are clamped (intensity 0..10, rotation -180..180, skyBoxIntensity 0..1, exposure 0.1..5). No fields = read only. Returns the current lighting. VRM only.',
  'window': 'Shows or hides the main window.',
  'motion.list': 'Lists motions the current model can play (all: true for every one).',
  'motion.play': 'Plays a library motion by id or name.',
  'motion.rename': 'Sets the name, tags, or description of a motion.',
  'motion.upload': 'Saves a .vrma file into the motion folder from path or base64 + fileName.',
  'motion.delete': 'Deletes one .vrma file from the motion folder.',
  'motion.setDirectory': 'Changes the motion folder, or reset: true for the default.',
}

interface AnySchema {
  type: string
  kind?: string
  entries?: Record<string, AnySchema>
  wrapped?: AnySchema
  item?: AnySchema
  options?: unknown[]
  literal?: unknown
  pipe?: AnySchema[]
  requirement?: unknown
}

const stepKeys: Record<string, 'min' | 'max' | 'minLength' | 'maxLength' | 'pattern' | 'integer'> = {
  min_value: 'min',
  max_value: 'max',
  min_length: 'minLength',
  max_length: 'maxLength',
  regex: 'pattern',
  integer: 'integer',
}

/** Describes one valibot schema as plain JSON. */
export function describeSchema(schema: AnySchema): FieldDescription {
  if (schema.type === 'optional') {
    const inner = describeSchema(schema.wrapped!)
    return { ...inner, required: false }
  }
  const description: FieldDescription = { type: schema.type, required: true }
  if (schema.type === 'picklist') {
    description.type = 'string'
    description.enum = [...(schema.options ?? [])]
  }
  if (schema.type === 'literal') {
    description.type = typeof schema.literal
    description.enum = [schema.literal]
  }
  if (schema.type === 'object' && schema.entries) {
    description.fields = Object.fromEntries(Object.entries(schema.entries).map(([key, value]) => [key, describeSchema(value)]))
  }
  if (schema.type === 'array' && schema.item)
    description.items = describeSchema(schema.item)

  for (const step of schema.pipe ?? []) {
    if (step === schema)
      continue
    if (step.kind === 'schema') {
      const { required: _required, ...inner } = describeSchema(step)
      Object.assign(description, inner)
      continue
    }
    const key = stepKeys[step.type]
    if (key === 'integer')
      description.integer = true
    else if (key === 'pattern')
      description.pattern = String(step.requirement)
    else if (key)
      description[key] = step.requirement as number
  }
  return description
}

/** Describes every accepted action from the protocol schemas. */
export function describeActions(): ActionDescription[] {
  return stageControlActionSchemas.map((schema) => {
    const entries = (schema as unknown as AnySchema).entries!
    const action = (entries.action as AnySchema).literal as string
    const fields = Object.fromEntries(
      Object.entries(entries)
        .filter(([key]) => key !== 'action' && key !== 'requestId')
        .map(([key, value]) => [key, describeSchema(value)]),
    )
    return { action, description: descriptions[action] ?? '', fields }
  })
}

/** Builds the `capabilities` result: actions plus a current snapshot. */
export async function readCapabilities(kit: StageKitClient, library?: MotionLibrary): Promise<StageCommandResult> {
  const state = await readStageState(kit)
  const windowVisible = kit.isWindowVisible ? await kit.isWindowVisible() : undefined
  const motions = library?.list() ?? []
  return {
    ok: true,
    data: {
      protocol: { request: { type: 'stage:control', data: '{ action, requestId?, ...fields }' }, result: 'stage:control:result' },
      actions: describeActions(),
      snapshot: {
        modelType: state.renderer,
        view: state.view ?? null,
        lighting: state.lighting ?? null,
        window: { visible: windowVisible ?? null },
        live2dMotionGroups: state.live2dMotionGroups,
        motionLibrary: library
          ? { directory: library.directory, vrmaCount: motions.length, names: motions.slice(0, 50).map(entry => entry.name) }
          : null,
        ...(state.error ? { warning: state.error } : {}),
      },
    },
  }
}
