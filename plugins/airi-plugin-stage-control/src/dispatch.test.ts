import type { StageKitClient } from './kit'

import { describe, expect, it, vi } from 'vitest'

import { dispatchStageControl } from './dispatch'

function createKit(): StageKitClient {
  return {
    readChannel: vi.fn(async () => ({ url: 'ws://127.0.0.1:6121/ws', token: 'token' })),
    command: vi.fn(async () => ({ ok: true })),
    setWindowVisible: vi.fn(() => ({ ok: true })),
    showCaption: vi.fn(async () => ({ ok: true })),
  }
}

describe('dispatchStageControl', () => {
  it('hides the window without a model command', async () => {
    const kit = createKit()

    await expect(dispatchStageControl({ action: 'window', visible: false }, kit)).resolves.toEqual({ ok: true })

    expect(kit.setWindowVisible).toHaveBeenCalledWith(false)
    expect(kit.command).not.toHaveBeenCalled()
    expect(kit.showCaption).not.toHaveBeenCalled()
  })

  it('shows the caption before a speech command', async () => {
    const kit = createKit()

    await dispatchStageControl({ action: 'speech', text: 'Hello', speak: true }, kit)

    expect(kit.showCaption).toHaveBeenCalledOnce()
    expect(kit.command).toHaveBeenCalledWith({ action: 'speech', text: 'Hello', speak: true })
  })

  it('returns the caption error and skips the model command', async () => {
    const kit = createKit()
    vi.mocked(kit.showCaption).mockResolvedValue({ ok: false, error: 'The caption window is not ready.' })

    await expect(dispatchStageControl({ action: 'speech', text: 'Hello' }, kit)).resolves.toEqual({
      ok: false,
      error: 'The caption window is not ready.',
    })
    expect(kit.command).not.toHaveBeenCalled()
  })

  it('returns a kit error as a failed result', async () => {
    const kit = createKit()
    vi.mocked(kit.command).mockRejectedValue(new Error('The stage is not ready.'))

    await expect(dispatchStageControl({ action: 'model', modelId: 'preset-live2d-1' }, kit)).resolves.toEqual({
      ok: false,
      error: 'The stage is not ready.',
    })
  })
})
