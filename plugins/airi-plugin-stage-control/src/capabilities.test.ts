import type { StageKitClient } from './kit'

import { describe, expect, it, vi } from 'vitest'

import { describeActions, readCapabilities } from './capabilities'
import { stageControlActionSchemas } from './protocol'

describe('capabilities', () => {
  it('lists every protocol action', () => {
    const protocolActions = stageControlActionSchemas.map(schema => schema.entries.action.literal)
    const described = describeActions().map(action => action.action)
    expect(described).toEqual(protocolActions)
    for (const action of describeActions())
      expect(action.description, action.action).not.toBe('')
  })

  it('describes ranges, enums, and nested light fields', () => {
    const actions = Object.fromEntries(describeActions().map(action => [action.action, action]))
    expect(actions.expression.fields.intensity).toMatchObject({ type: 'number', required: false, min: 0, max: 1 })
    expect(actions.expression.fields.name).toMatchObject({ type: 'string', required: true, minLength: 1 })
    expect(actions.light.fields.environment).toMatchObject({ type: 'string', enum: ['hemisphere', 'skyBox'] })
    expect(actions.light.fields.ambient.fields?.color).toMatchObject({ type: 'string', pattern: expect.stringContaining('0-9a-f') })
    expect(actions.motion.fields.index).toMatchObject({ integer: true, min: 0 })
  })

  it('returns a stage snapshot', async () => {
    const kit: StageKitClient = {
      readChannel: vi.fn(),
      command: vi.fn(async () => ({ ok: true, data: { renderer: 'vrm', live2dMotionGroups: [], view: { x: 0, y: 0, z: 0, scale: 1 }, lighting: { exposure: 1 } } })),
      setWindowVisible: vi.fn(),
      showCaption: vi.fn(),
      isWindowVisible: () => true,
    }
    const result = await readCapabilities(kit)
    expect(result.ok).toBe(true)
    expect((result.data as any).snapshot).toMatchObject({
      modelType: 'vrm',
      view: { scale: 1 },
      lighting: { exposure: 1 },
      window: { visible: true },
      motionLibrary: null,
    })
  })
})
