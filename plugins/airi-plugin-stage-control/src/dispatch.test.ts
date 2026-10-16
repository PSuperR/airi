import type { StageKitClient } from './kit'

import { Buffer } from 'node:buffer'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

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

  describe('vrma', () => {
    let dir: string
    let file: string

    beforeAll(async () => {
      dir = await mkdtemp(join(tmpdir(), 'stage-control-'))
      file = join(dir, 'wave.vrma')
      await writeFile(file, Buffer.from('glTF'))
      await writeFile(join(dir, 'wave.txt'), 'x')
    })

    afterAll(async () => {
      await rm(dir, { recursive: true, force: true })
    })

    it('passes an http URL through', async () => {
      const kit = createKit()
      await dispatchStageControl({ action: 'vrma', src: 'https://example.com/a.vrma', loop: true }, kit)
      expect(kit.command).toHaveBeenCalledWith({ action: 'vrma', src: 'https://example.com/a.vrma', loop: true })
    })

    it('reads a local path and a file URL as a data URL', async () => {
      const expected = `data:application/octet-stream;base64,${Buffer.from('glTF').toString('base64')}`
      for (const src of [file, pathToFileURL(file).href]) {
        const kit = createKit()
        await expect(dispatchStageControl({ action: 'vrma', src }, kit)).resolves.toEqual({ ok: true })
        expect(kit.command).toHaveBeenCalledWith({ action: 'vrma', src: expected })
      }
    })

    it('rejects a relative path, a missing file, and another extension', async () => {
      const kit = createKit()
      await expect(dispatchStageControl({ action: 'vrma', src: 'wave.vrma' }, kit)).resolves.toMatchObject({ ok: false, error: expect.stringContaining('absolute file path') })
      await expect(dispatchStageControl({ action: 'vrma', src: join(dir, 'missing.vrma') }, kit)).resolves.toMatchObject({ ok: false, error: expect.stringContaining('not found') })
      await expect(dispatchStageControl({ action: 'vrma', src: join(dir, 'wave.txt') }, kit)).resolves.toMatchObject({ ok: false, error: expect.stringContaining('.vrma extension') })
      expect(kit.command).not.toHaveBeenCalled()
    })
  })
})
