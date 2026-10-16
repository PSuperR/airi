import type { StageCommandRuntime } from './stage-command-executor'

import { describe, expect, it, vi } from 'vitest'

import { executeStageModelCommand } from './stage-command-executor'

const lighting = {
  ambient: { intensity: 0.6, color: '#ffffff' },
  directional: { intensity: 2.02, color: '#fffbf5', rotationX: 0, rotationY: 0 },
  hemisphere: { intensity: 0.4, skyColor: '#ffffff', groundColor: '#222222' },
  environment: 'hemisphere' as const,
  skyBoxIntensity: 0.1,
  exposure: 1,
}

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
    playVrmAnimation: vi.fn(async (src: string) => {
      calls.push(`vrma:${src}`)
      return true
    }),
    setLive2dView: vi.fn((key: string, value: number) => {
      calls.push(`live2d-view:${key}:${value}`)
    }),
    setVrmView: vi.fn((key: string, value: number) => {
      calls.push(`vrm-view:${key}:${value}`)
    }),
    getView: vi.fn(() => ({ x: 0, y: 0, scale: 1 })),
    getVrmLighting: vi.fn(() => ({ ...lighting })),
    setVrmLighting: vi.fn((patch) => {
      calls.push(`light:${JSON.stringify(patch)}`)
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
  it('reports the model type and Live2D motion groups for the state command', async () => {
    await expect(executeStageModelCommand({ action: 'state' }, createRuntime('live2d'))).resolves.toEqual({
      renderer: 'live2d',
      live2dMotionGroups: [{ group: 'Wave', count: 2 }],
      view: { x: 0, y: 0, scale: 1 },
    })
    await expect(executeStageModelCommand({ action: 'state' }, createRuntime('vrm'))).resolves.toEqual({
      renderer: 'vrm',
      live2dMotionGroups: [],
      view: { x: 0, y: 0, scale: 1 },
      lighting,
    })
    await expect(executeStageModelCommand({ action: 'state' }, createRuntime(undefined))).resolves.toEqual({
      renderer: 'disabled',
      live2dMotionGroups: [],
    })
  })

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

  it('plays a vrma clip on VRM with defaults and rejects it on Live2D', async () => {
    const vrm = createRuntime('vrm')
    await executeStageModelCommand({ action: 'vrma', src: 'data:application/octet-stream;base64,AA==' }, vrm)
    expect(vrm.playVrmAnimation).toHaveBeenCalledWith('data:application/octet-stream;base64,AA==', { loop: false, fadeInMs: 300, fadeOutMs: 300 })

    await executeStageModelCommand({ action: 'vrma', src: 'https://example.com/a.vrma', loop: true, fadeInMs: 0, fadeOutMs: 800 }, vrm)
    expect(vrm.playVrmAnimation).toHaveBeenLastCalledWith('https://example.com/a.vrma', { loop: true, fadeInMs: 0, fadeOutMs: 800 })

    await expect(executeStageModelCommand({ action: 'vrma', src: 'C:/a.vrma' }, vrm)).rejects.toThrow('http(s), data, or blob URL')
    vi.mocked(vrm.playVrmAnimation).mockResolvedValueOnce(false)
    await expect(executeStageModelCommand({ action: 'vrma', src: 'https://example.com/a.vrma' }, vrm)).rejects.toThrow('The VRM model is not ready.')

    const live2d = createRuntime('live2d')
    await expect(executeStageModelCommand({ action: 'vrma', src: 'https://example.com/a.vrma' }, live2d)).rejects.toThrow('The Live2D model cannot play a .vrma animation.')
    expect(live2d.playVrmAnimation).not.toHaveBeenCalled()
    await expect(executeStageModelCommand({ action: 'vrma', src: 'https://example.com/a.vrma' }, createRuntime('disabled'))).rejects.toThrow('not supported')
  })

  it('reads VRM lighting with an empty light command', async () => {
    const vrm = createRuntime('vrm')
    await expect(executeStageModelCommand({ action: 'light' }, vrm)).resolves.toEqual(lighting)
    expect(vrm.setVrmLighting).not.toHaveBeenCalled()
  })

  it('clamps light values and writes only given fields', async () => {
    const vrm = createRuntime('vrm')
    await executeStageModelCommand({
      action: 'light',
      ambient: { intensity: 20 },
      directional: { color: '#FFAA00', rotationX: -400 },
      hemisphere: {},
      skyBoxIntensity: 2,
      exposure: 0,
      environment: 'skyBox',
    }, vrm)
    expect(vrm.setVrmLighting).toHaveBeenCalledWith({
      ambient: { intensity: 10 },
      directional: { color: '#ffaa00', rotationX: -180 },
      environment: 'skyBox',
      skyBoxIntensity: 1,
      exposure: 0.1,
    })
  })

  it('rejects a bad light color and the light action on Live2D', async () => {
    await expect(executeStageModelCommand({ action: 'light', ambient: { color: 'red' } }, createRuntime('vrm')))
      .rejects
      .toThrow('ambient.color must be a #RRGGBB color.')
    const live2d = createRuntime('live2d')
    await expect(executeStageModelCommand({ action: 'light', exposure: 1 }, live2d))
      .rejects
      .toThrow('The Live2D model has no scene lighting.')
    expect(live2d.setVrmLighting).not.toHaveBeenCalled()
  })
})
