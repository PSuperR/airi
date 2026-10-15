import type { StageCommandRuntime } from './stage-command-executor'

import { describe, expect, it, vi } from 'vitest'

import { executeStageModelCommand } from './stage-command-executor'

function createRuntime(renderer: StageCommandRuntime['renderer']): StageCommandRuntime & {
  calls: string[]
} {
  const calls: string[] = []
  return {
    calls,
    renderer,
    live2dExpressions: {
      availableNames: ['happy'],
      play: vi.fn(async () => {
        calls.push('expression')
        return true
      }),
    },
    live2dMotions: {
      available: [
        { fileName: 'wave.motion3.json', group: 'Wave', index: 0 },
        { fileName: 'wave-2.motion3.json', group: 'Wave', index: 1 },
      ],
      play: vi.fn(async () => {
        calls.push('motion')
        return true
      }),
    },
    setVrmExpression: vi.fn(async () => {
      calls.push('vrm-expression')
      return true
    }),
    setLive2dView: vi.fn((key: string, value: number) => {
      calls.push(`live2d-view:${key}:${value}`)
    }),
    setVrmView: vi.fn((key: string, value: number) => {
      calls.push(`vrm-view:${key}:${value}`)
    }),
    setModel: vi.fn(async (modelId: string) => {
      calls.push(`model:${modelId}`)
      return modelId !== 'missing'
    }),
    showCaptionText: vi.fn((text: string) => {
      calls.push(`caption:${text}`)
    }),
    speakText: vi.fn(async (text: string) => {
      calls.push(`speak:${text}`)
    }),
  }
}

describe('executeStageModelCommand', () => {
  it('plays a Live2D expression and rejects an unknown name', async () => {
    const runtime = createRuntime('live2d')

    await executeStageModelCommand({ action: 'expression', name: 'happy', durationMs: 2000 }, runtime)
    expect(runtime.live2dExpressions.play).toHaveBeenCalledWith({ name: 'happy', duration: 2 })

    await expect(executeStageModelCommand({ action: 'expression', name: 'missing' }, runtime))
      .rejects
      .toThrow('Live2D has no expression named "missing".')
  })

  it('plays a known VRM expression and rejects a named motion', async () => {
    const runtime = createRuntime('vrm')

    await executeStageModelCommand({ action: 'expression', name: 'happy' }, runtime)
    expect(runtime.setVrmExpression).toHaveBeenCalledWith('happy', 1, 3000)

    await expect(executeStageModelCommand({ action: 'motion', name: 'wave' }, runtime))
      .rejects
      .toThrow('The VRM model cannot play a named motion. Use the expression action.')
  })

  it('asks for an index when a Live2D group has more than one motion', async () => {
    const runtime = createRuntime('live2d')

    await expect(executeStageModelCommand({ action: 'motion', name: 'Wave' }, runtime))
      .rejects
      .toThrow('Pass index. Indexes: 0, 1.')

    await executeStageModelCommand({ action: 'motion', name: 'Wave', index: 1 }, runtime)
    expect(runtime.live2dMotions.play).toHaveBeenCalledWith('wave-2.motion3.json')
  })

  it('rejects Live2D depth and maps VRM scale to camera distance', async () => {
    const live2d = createRuntime('live2d')
    await expect(executeStageModelCommand({ action: 'view', z: 1 }, live2d))
      .rejects
      .toThrow('Depth is not supported for the Live2D model.')
    expect(live2d.setLive2dView).not.toHaveBeenCalled()

    const vrm = createRuntime('vrm')
    await executeStageModelCommand({ action: 'view', scale: 2.5, x: 1 }, vrm)
    expect(vrm.calls).toEqual(['vrm-view:x:1', 'vrm-view:cameraDistance:2.5'])
  })

  it('shows the caption before speech and skips speech for an empty line', async () => {
    const runtime = createRuntime('live2d')

    await executeStageModelCommand({ action: 'speech', text: 'Hello', speak: true }, runtime)
    expect(runtime.calls).toEqual(['caption:Hello', 'speak:Hello'])

    runtime.calls.length = 0
    await executeStageModelCommand({ action: 'speech', text: '' }, runtime)
    expect(runtime.calls).toEqual(['caption:'])
  })

  it('rejects a missing display model and an unsupported renderer', async () => {
    const runtime = createRuntime('spine')

    await expect(executeStageModelCommand({ action: 'model', modelId: 'missing' }, runtime))
      .rejects
      .toThrow('No display model has id "missing".')
    await expect(executeStageModelCommand({ action: 'expression', name: 'happy' }, runtime))
      .rejects
      .toThrow('Expression is not supported for the spine model.')
  })
})
