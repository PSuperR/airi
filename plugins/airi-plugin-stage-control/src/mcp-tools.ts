import type { ActionDescription, FieldDescription } from './capabilities'

import { describeActions } from './capabilities'

/** A JSON Schema object, as MCP `inputSchema` expects. */
export interface JsonSchema {
  type?: string
  description?: string
  properties?: Record<string, JsonSchema>
  required?: string[]
  items?: JsonSchema
  enum?: unknown[]
  minimum?: number
  maximum?: number
  minLength?: number
  maxLength?: number
  pattern?: string
  additionalProperties?: boolean
}

/** One MCP tool mapped to one stage control action. */
export interface StageMcpTool {
  name: string
  action: string
  description: string
  inputSchema: JsonSchema & { type: 'object' }
}

const chinese: Record<string, string> = {
  'capabilities': '列出全部动作及字段，并返回舞台快照。建议先调用。',
  'state': '读取模型类型、Live2D 动作组、视角和 VRM 灯光。',
  'expression': '切换模型表情（VRM：happy、angry、sad、relaxed、surprised 等）。',
  'motion': '按组名或文件名播放 Live2D 动作（仅 Live2D）。',
  'speech': '显示字幕，可选朗读。',
  'view': '移动、缩放模型；超出范围会被钳制。',
  'model': '按 id 切换显示模型，例如 preset-vrm-1。',
  'vrma': '在 VRM 模型上播放 .vrma 动画（http(s)、file:// 或绝对路径）。',
  'light': '调整 VRM 场景灯光；不传字段则只读取。仅 VRM。',
  'window': '显示或隐藏主窗口。',
  'motion.list': '列出当前模型可播放的动作（all: true 列出全部）。',
  'motion.play': '按 id 或名称播放动作库中的动作。',
  'motion.rename': '修改动作的名称、标签或描述。',
  'motion.upload': '通过 path 或 base64 + fileName 把 .vrma 存入动作文件夹。',
  'motion.delete': '从动作文件夹删除一个 .vrma 文件。',
  'motion.setDirectory': '更换动作文件夹，或 reset: true 恢复默认。',
}

/** MCP tool name for an action: `light` -> `stage_light`, `motion.play` -> `motion_play`. */
export function toolNameFor(action: string): string {
  return action.startsWith('motion.') ? action.replace('.', '_') : `stage_${action}`
}

/** Converts one capabilities field description into JSON Schema. */
export function fieldToJsonSchema(field: FieldDescription): JsonSchema {
  const schema: JsonSchema = {}
  const type = field.integer ? 'integer' : field.type
  if (['string', 'number', 'integer', 'boolean', 'object', 'array'].includes(type))
    schema.type = type
  if (field.enum)
    schema.enum = field.enum
  if (field.min !== undefined)
    schema.minimum = field.min
  if (field.max !== undefined)
    schema.maximum = field.max
  if (field.minLength !== undefined)
    schema.minLength = field.minLength
  if (field.maxLength !== undefined)
    schema.maxLength = field.maxLength
  if (field.pattern) {
    // valibot prints regexes as /source/flags; JSON Schema wants only the source.
    const match = /^\/(.*)\/[a-z]*$/s.exec(field.pattern)
    schema.pattern = match ? match[1] : field.pattern
  }
  if (field.fields)
    Object.assign(schema, fieldsToObjectSchema(field.fields))
  if (field.items)
    schema.items = fieldToJsonSchema(field.items)
  return schema
}

function fieldsToObjectSchema(fields: Record<string, FieldDescription>): JsonSchema & { type: 'object' } {
  const properties = Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, fieldToJsonSchema(value)]))
  const required = Object.entries(fields).filter(([, value]) => value.required !== false).map(([key]) => key)
  return { type: 'object', properties, ...(required.length ? { required } : {}), additionalProperties: false }
}

/** Builds one MCP tool per action from the capabilities descriptions. */
export function buildStageTools(actions: ActionDescription[] = describeActions()): StageMcpTool[] {
  return actions.map(action => ({
    name: toolNameFor(action.action),
    action: action.action,
    description: [chinese[action.action], action.description, `(stage:control action "${action.action}")`].filter(Boolean).join('\n'),
    inputSchema: fieldsToObjectSchema(action.fields),
  }))
}

/** The raw passthrough tool. */
export const stageCommandTool: StageMcpTool = {
  name: 'stage_command',
  action: '',
  description: '通用舞台命令：直接发送任意 stage:control 动作与字段。\nGeneric stage command: sends any stage:control action with its fields.',
  inputSchema: {
    type: 'object',
    properties: {
      action: { type: 'string', description: 'Action name, e.g. light or motion.play.' },
      data: { type: 'object', description: 'Action fields (without action / requestId).' },
    },
    required: ['action'],
  },
}
