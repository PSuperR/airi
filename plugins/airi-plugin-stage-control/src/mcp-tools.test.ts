import { describe, expect, it } from 'vitest'

import { describeActions } from './capabilities'
import { buildStageTools, fieldToJsonSchema, toolNameFor } from './mcp-tools'

describe('mcp tools', () => {
  it('maps every capabilities action to a readable tool', () => {
    const tools = buildStageTools()
    expect(tools.map(tool => tool.action)).toEqual(describeActions().map(action => action.action))
    expect(tools.map(tool => tool.name)).toContain('stage_light')
    expect(tools.map(tool => tool.name)).toContain('motion_play')
    expect(toolNameFor('motion.setDirectory')).toBe('motion_setDirectory')
    expect(tools.every(tool => /^[\w-]{1,64}$/.test(tool.name))).toBe(true)
  })

  it('converts field descriptions to JSON Schema', () => {
    const tools = Object.fromEntries(buildStageTools().map(tool => [tool.action, tool]))
    const expression = tools.expression.inputSchema
    expect(expression.required).toContain('name')
    expect(expression.properties?.intensity).toMatchObject({ type: 'number', minimum: 0, maximum: 1 })
    expect(tools.motion.inputSchema.properties?.index).toMatchObject({ type: 'integer', minimum: 0 })
    expect(tools.light.inputSchema.properties?.environment).toMatchObject({ enum: ['hemisphere', 'skyBox'] })
    expect(tools.light.inputSchema.properties?.ambient?.type).toBe('object')
    expect(tools.light.description).toMatch(/灯光/)
  })

  it('strips regex delimiters from patterns', () => {
    expect(fieldToJsonSchema({ type: 'string', pattern: '/^#[0-9a-f]{6}$/i' }).pattern).toBe('^#[0-9a-f]{6}$')
  })
})
