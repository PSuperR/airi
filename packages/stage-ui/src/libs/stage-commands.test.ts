import { describe, expect, it } from 'vitest'

import { registerStageCommands, runStageCommand } from './stage-commands'

describe('runStageCommand', () => {
  it('reports that the stage is not ready when no scene is registered', async () => {
    await expect(runStageCommand({ action: 'model', modelId: 'preset-live2d-1' })).resolves.toEqual({
      ok: false,
      error: 'The stage is not ready.',
    })
  })

  it('returns ok after the registered scene finishes', async () => {
    const stop = registerStageCommands(async () => {})

    await expect(runStageCommand({ action: 'speech', text: 'Hello' })).resolves.toEqual({ ok: true })

    stop()
  })

  it('returns data from a read command', async () => {
    const stop = registerStageCommands(async () => ({ renderer: 'vrm', live2dMotionGroups: [] }))

    await expect(runStageCommand({ action: 'state' })).resolves.toEqual({
      ok: true,
      data: { renderer: 'vrm', live2dMotionGroups: [] },
    })

    stop()
  })

  it('returns the scene error and clears the registration', async () => {
    const stop = registerStageCommands(async () => {
      throw new Error('Live2D has no expression named "missing".')
    })

    await expect(runStageCommand({ action: 'expression', name: 'missing' })).resolves.toEqual({
      ok: false,
      error: 'Live2D has no expression named "missing".',
    })

    stop()
    await expect(runStageCommand({ action: 'expression', name: 'missing' })).resolves.toEqual({
      ok: false,
      error: 'The stage is not ready.',
    })
  })
})
