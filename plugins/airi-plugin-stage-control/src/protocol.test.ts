import { describe, expect, it } from 'vitest'

import { parseStageControlData } from './protocol'

describe('parseStageControlData', () => {
  it('reads each action', () => {
    expect(parseStageControlData({
      requestId: '1',
      action: 'expression',
      name: 'happy',
      durationMs: 3000,
      intensity: 1,
    })).toEqual({
      requestId: '1',
      command: { action: 'expression', name: 'happy', durationMs: 3000, intensity: 1 },
    })

    expect(parseStageControlData({ action: 'motion', name: 'Wave', index: 0 }).command).toEqual({
      action: 'motion',
      name: 'Wave',
      index: 0,
    })
    expect(parseStageControlData({ action: 'speech', text: '' }).command).toEqual({
      action: 'speech',
      text: '',
    })
    expect(parseStageControlData({ action: 'view', scale: 1.5 }).command).toEqual({
      action: 'view',
      scale: 1.5,
    })
    expect(parseStageControlData({ action: 'model', modelId: 'preset-vrm-1' }).command).toEqual({
      action: 'model',
      modelId: 'preset-vrm-1',
    })
    expect(parseStageControlData({ action: 'window', visible: false }).command).toEqual({
      action: 'window',
      visible: false,
    })
  })

  it('reads a vrma action', () => {
    expect(parseStageControlData({ action: 'vrma', src: ' https://example.com/a.vrma ', loop: true, fadeInMs: 0, fadeOutMs: 500 }).command).toEqual({
      action: 'vrma',
      src: 'https://example.com/a.vrma',
      loop: true,
      fadeInMs: 0,
      fadeOutMs: 500,
    })
    expect(() => parseStageControlData({ action: 'vrma', src: '' })).toThrow('The stage control payload is not valid.')
    expect(() => parseStageControlData({ action: 'vrma' })).toThrow('The stage control payload is not valid.')
    expect(() => parseStageControlData({ action: 'vrma', src: 'a.vrma', fadeInMs: -1 })).toThrow('The stage control payload is not valid.')
    expect(() => parseStageControlData({ action: 'vrma', src: 'a.vrma', loop: 'yes' })).toThrow('The stage control payload is not valid.')
  })

  it('rejects an empty view, a bad intensity, and an unknown action', () => {
    expect(() => parseStageControlData({ action: 'view' })).toThrow('The view action needs x, y, z, or scale.')
    expect(() => parseStageControlData({ action: 'expression', name: 'happy', intensity: 2 })).toThrow('The stage control payload is not valid.')
    expect(() => parseStageControlData({ action: 'jump' })).toThrow('The stage control payload is not valid.')
    expect(() => parseStageControlData({ action: 'motion', name: '' })).toThrow('The stage control payload is not valid.')
  })
})
