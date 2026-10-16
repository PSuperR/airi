import type { StageCommandResult, StageModelCommand } from '@proj-airi/stage-shared/stage-command'

import type { StageKitClient } from './kit'

import { Buffer } from 'node:buffer'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { dispatchStageControl } from './dispatch'
import { MotionLibrary } from './motion-library'
import { parseStageControlData } from './protocol'

let root: string
let library: MotionLibrary

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'airi-motion-actions-'))
  library = new MotionLibrary({ directory: join(root, 'motions'), watch: false })
  await library.start()
  await writeFile(join(library.directory, 'VRMA_01.vrma'), Buffer.from('vrma'))
  await library.scan()
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

function createKit(renderer: string) {
  const command = vi.fn(async (cmd: StageModelCommand): Promise<StageCommandResult> => {
    if (cmd.action === 'state')
      return { ok: true, data: { renderer, live2dMotionGroups: renderer === 'live2d' ? [{ group: 'Tap', count: 2 }] : [] } }
    return { ok: true }
  })
  const kit: StageKitClient = {
    readChannel: vi.fn(async () => ({ url: 'ws://x', token: 't' })),
    command,
    setWindowVisible: vi.fn(() => ({ ok: true })),
    showCaption: vi.fn(async () => ({ ok: true })),
  }
  return { kit, command }
}

const setDirectory = vi.fn(async (directory: string | undefined) => {
  if (directory)
    await library.setDirectory(directory)
})

function run(data: unknown, kit: StageKitClient) {
  return dispatchStageControl(parseStageControlData(data).command, kit, { library, setDirectory })
}

describe('motion actions', () => {
  it('lists motions for the current model type', async () => {
    const vrm = createKit('vrm')
    const listed = await run({ action: 'motion.list' }, vrm.kit)
    expect(listed.ok).toBe(true)
    expect(listed.data).toMatchObject({ modelType: 'vrm', motions: [{ id: 'vrma:VRMA_01.vrma' }] })

    const live2d = createKit('live2d')
    const l2 = await run({ action: 'motion.list' }, live2d.kit)
    expect((l2.data as { motions: { id: string }[] }).motions.map(m => m.id)).toEqual(['live2d:Tap:0', 'live2d:Tap:1'])
    const all = await run({ action: 'motion.list', all: true }, live2d.kit)
    expect((all.data as { motions: unknown[] }).motions).toHaveLength(3)
  })

  it('plays a vrma entry as a data URL and a Live2D entry as a motion', async () => {
    const vrm = createKit('vrm')
    await expect(run({ action: 'motion.play', name: 'VRMA_01', loop: true }, vrm.kit)).resolves.toMatchObject({ ok: true })
    expect(vrm.command).toHaveBeenLastCalledWith({ action: 'vrma', src: `data:application/octet-stream;base64,${Buffer.from('vrma').toString('base64')}`, loop: true })

    const live2d = createKit('live2d')
    await expect(run({ action: 'motion.play', id: 'live2d:Tap:1' }, live2d.kit)).resolves.toMatchObject({ ok: true })
    expect(live2d.command).toHaveBeenLastCalledWith({ action: 'motion', name: 'Tap', index: 1 })

    await expect(run({ action: 'motion.play', id: 'vrma:VRMA_01.vrma' }, live2d.kit)).resolves.toMatchObject({ ok: false, error: expect.stringContaining('needs a vrm model') })
  })

  it('renames, uploads, deletes, and changes folder', async () => {
    const { kit } = createKit('vrm')
    await expect(run({ action: 'motion.rename', id: 'vrma:VRMA_01.vrma', name: 'Wave', tags: ['greet'] }, kit)).resolves.toMatchObject({ ok: true })
    await expect(run({ action: 'motion.play', name: 'wave' }, kit)).resolves.toMatchObject({ ok: true })
    await expect(run({ action: 'motion.upload', fileName: 'New.vrma', base64: 'AAAA' }, kit)).resolves.toMatchObject({ ok: true, data: { id: 'vrma:New.vrma' } })
    await expect(run({ action: 'motion.delete', id: 'vrma:New.vrma' }, kit)).resolves.toMatchObject({ ok: true })
    const other = join(root, 'other')
    await expect(run({ action: 'motion.setDirectory', directory: other }, kit)).resolves.toEqual({ ok: true, data: { directory: other } })
  })

  it('rejects bad motion payloads', () => {
    expect(() => parseStageControlData({ action: 'motion.play' })).toThrow('id or name')
    expect(() => parseStageControlData({ action: 'motion.upload', fileName: 'a.vrma' })).toThrow('path or base64')
    expect(() => parseStageControlData({ action: 'motion.upload', base64: 'AAAA' })).toThrow('fileName')
    expect(() => parseStageControlData({ action: 'motion.setDirectory' })).toThrow('directory or reset')
    expect(parseStageControlData({ requestId: 'r', action: 'motion.list' })).toEqual({ requestId: 'r', command: { action: 'motion.list' } })
  })

  it('reports that the library is not ready without a library', async () => {
    const { kit } = createKit('vrm')
    await expect(dispatchStageControl({ action: 'motion.list' }, kit)).resolves.toEqual({ ok: false, error: 'The motion library is not ready.' })
  })
})
