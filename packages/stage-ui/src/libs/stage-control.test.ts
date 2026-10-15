import type { StageControlScene } from './stage-control'

import { describe, expect, it, vi } from 'vitest'

import { readStageControlRequest, runStageControl } from './stage-control'

function createScene(overrides: Partial<StageControlScene> = {}): StageControlScene {
  return {
    renderer: 'live2d',
    setLive2dExpression: vi.fn(async () => true),
    setVrmExpression: vi.fn(),
    resolveLive2dMotionFile: vi.fn(() => 'motions/idle.motion3.json'),
    playLive2dMotion: vi.fn(async () => true),
    setLive2dView: vi.fn(),
    setVrmView: vi.fn(),
    showCaption: vi.fn(),
    speak: vi.fn(async () => {}),
    setModel: vi.fn(async () => {}),
    setWindowVisible: vi.fn(async () => {}),
    ...overrides,
  }
}

describe('stage control', () => {
  it('rejects an unknown action', () => {
    expect(readStageControlRequest({ id: '1', action: 'jump' })).toEqual({
      ok: false,
      id: '1',
      error: 'Unknown stage control action.',
    })
  })

  it('rejects a payload that is not an object', () => {
    expect(readStageControlRequest(null)).toEqual({
      ok: false,
      id: '',
      error: 'Stage control data must be an object.',
    })
  })

  it('sets a Live2D expression', async () => {
    const scene = createScene()

    await expect(runStageControl({
      id: 'expression-1',
      action: 'expression',
      name: '05_Angry',
      duration: 2,
    }, scene)).resolves.toEqual({ id: 'expression-1', ok: true })

    expect(scene.setLive2dExpression).toHaveBeenCalledWith('05_Angry', 2)
    expect(scene.setVrmExpression).not.toHaveBeenCalled()
  })

  it('returns an error when the Live2D expression is missing', async () => {
    const scene = createScene({ setLive2dExpression: vi.fn(async () => false) })

    await expect(runStageControl({
      id: 'expression-2',
      action: 'expression',
      name: 'missing',
    }, scene)).resolves.toEqual({
      id: 'expression-2',
      ok: false,
      error: 'Live2D expression "missing" is not available on the loaded model.',
    })
  })

  it('rejects a VRM expression outside the supported names', async () => {
    const scene = createScene({ renderer: 'vrm' })

    await expect(runStageControl({
      id: 'expression-3',
      action: 'expression',
      name: '05_Angry',
    }, scene)).resolves.toEqual({
      id: 'expression-3',
      ok: false,
      error: 'VRM expression "05_Angry" is not supported. Use happy, sad, angry, surprised, neutral, think, relaxed.',
    })

    expect(scene.setVrmExpression).not.toHaveBeenCalled()
  })

  it('sets a supported VRM expression', async () => {
    const scene = createScene({ renderer: 'vrm' })

    await expect(runStageControl({
      id: 'expression-4',
      action: 'expression',
      name: 'happy',
      intensity: 0.5,
    }, scene)).resolves.toEqual({ id: 'expression-4', ok: true })

    expect(scene.setVrmExpression).toHaveBeenCalledWith('happy', 0.5)
  })

  it('rejects expression for a model that has none', async () => {
    const scene = createScene({ renderer: 'mmd' })

    await expect(runStageControl({
      id: 'expression-5',
      action: 'expression',
      name: 'happy',
    }, scene)).resolves.toEqual({
      id: 'expression-5',
      ok: false,
      error: 'Expression is not supported for the "mmd" model.',
    })
  })

  it('plays a Live2D motion group', async () => {
    const scene = createScene()

    await expect(runStageControl({
      id: 'motion-1',
      action: 'motion',
      group: 'Idle',
      index: 0,
    }, scene)).resolves.toEqual({ id: 'motion-1', ok: true })

    expect(scene.resolveLive2dMotionFile).toHaveBeenCalledWith('Idle', 0)
    expect(scene.playLive2dMotion).toHaveBeenCalledWith('motions/idle.motion3.json')
  })

  it('rejects a VRM motion without playing one', async () => {
    const scene = createScene({ renderer: 'vrm' })

    await expect(runStageControl({
      id: 'motion-2',
      action: 'motion',
      group: 'Idle',
    }, scene)).resolves.toEqual({
      id: 'motion-2',
      ok: false,
      error: 'VRM does not play a named motion. The model loops its idle animation.',
    })

    expect(scene.playLive2dMotion).not.toHaveBeenCalled()
  })

  it('rejects a motion that has no file and no group', async () => {
    await expect(runStageControl({ id: 'motion-3', action: 'motion' }, createScene())).resolves.toEqual({
      id: 'motion-3',
      ok: false,
      error: 'A motion needs a file name or a group.',
    })
  })

  it('shows a caption and speaks when asked', async () => {
    const scene = createScene()

    await expect(runStageControl({
      id: 'caption-1',
      action: 'caption',
      text: 'Hello',
      speak: true,
    }, scene)).resolves.toEqual({ id: 'caption-1', ok: true })

    expect(scene.showCaption).toHaveBeenCalledWith('Hello')
    expect(scene.speak).toHaveBeenCalledWith('Hello')
  })

  it('keeps the caption when speech fails', async () => {
    const scene = createScene({
      speak: vi.fn(async () => {
        throw new Error('Speech is not configured. The caption is visible.')
      }),
    })

    await expect(runStageControl({
      id: 'caption-2',
      action: 'caption',
      text: 'Hello',
      speak: true,
    }, scene)).resolves.toEqual({
      id: 'caption-2',
      ok: false,
      error: 'Speech is not configured. The caption is visible.',
    })

    expect(scene.showCaption).toHaveBeenCalledWith('Hello')
  })

  it('does not apply Live2D position when z is set', async () => {
    const scene = createScene()

    await expect(runStageControl({
      id: 'transform-1',
      action: 'transform',
      x: 10,
      z: 1,
    }, scene)).resolves.toEqual({
      id: 'transform-1',
      ok: false,
      error: 'Live2D has no z position.',
    })

    expect(scene.setLive2dView).not.toHaveBeenCalled()
  })

  it('sets Live2D scale and position', async () => {
    const scene = createScene()

    await expect(runStageControl({
      id: 'transform-2',
      action: 'transform',
      x: 12,
      y: -4,
      scale: 1.5,
    }, scene)).resolves.toEqual({ id: 'transform-2', ok: true })

    expect(scene.setLive2dView).toHaveBeenCalledWith('x', 12)
    expect(scene.setLive2dView).toHaveBeenCalledWith('y', -4)
    expect(scene.setLive2dView).toHaveBeenCalledWith('scale', 1.5)
  })

  it('rejects VRM scale and leaves the position unchanged', async () => {
    const scene = createScene({ renderer: 'vrm' })

    await expect(runStageControl({
      id: 'transform-3',
      action: 'transform',
      x: 1,
      scale: 2,
    }, scene)).resolves.toEqual({
      id: 'transform-3',
      ok: false,
      error: 'VRM has no model scale. Set x, y, or z.',
    })

    expect(scene.setVrmView).not.toHaveBeenCalled()
  })

  it('sets the VRM position', async () => {
    const scene = createScene({ renderer: 'vrm' })

    await expect(runStageControl({
      id: 'transform-4',
      action: 'transform',
      x: 0.2,
      y: 0,
      z: -0.4,
    }, scene)).resolves.toEqual({ id: 'transform-4', ok: true })

    expect(scene.setVrmView).toHaveBeenCalledWith('x', 0.2)
    expect(scene.setVrmView).toHaveBeenCalledWith('y', 0)
    expect(scene.setVrmView).toHaveBeenCalledWith('z', -0.4)
  })

  it('selects a display model', async () => {
    const scene = createScene()

    await expect(runStageControl({
      id: 'model-1',
      action: 'model',
      modelId: 'preset-vrm-1',
    }, scene)).resolves.toEqual({ id: 'model-1', ok: true })

    expect(scene.setModel).toHaveBeenCalledWith('preset-vrm-1')
  })

  it('returns the model error', async () => {
    const scene = createScene({
      setModel: vi.fn(async () => {
        throw new Error('Display model "missing" was not found.')
      }),
    })

    await expect(runStageControl({
      id: 'model-2',
      action: 'model',
      modelId: 'missing',
    }, scene)).resolves.toEqual({
      id: 'model-2',
      ok: false,
      error: 'Display model "missing" was not found.',
    })
  })

  it('shows the window', async () => {
    const scene = createScene()

    await expect(runStageControl({
      id: 'window-1',
      action: 'window',
      visible: true,
    }, scene)).resolves.toEqual({ id: 'window-1', ok: true })

    expect(scene.setWindowVisible).toHaveBeenCalledWith(true)
  })

  it('rejects window control when the runtime has no window', async () => {
    const scene = createScene({ setWindowVisible: undefined })

    await expect(runStageControl({
      id: 'window-2',
      action: 'window',
      visible: false,
    }, scene)).resolves.toEqual({
      id: 'window-2',
      ok: false,
      error: 'This runtime cannot show or hide the main window.',
    })
  })
})
