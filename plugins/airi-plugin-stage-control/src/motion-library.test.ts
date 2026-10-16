import { Buffer } from 'node:buffer'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { findMotion, live2dMotionEntries, MOTION_METADATA_FILE, MotionLibrary, validateMotionFileName } from './motion-library'
import { defaultMotionDirectory, readMotionDirectory, saveMotionDirectory } from './motion-settings'

let root: string
let dir: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'airi-motions-'))
  dir = join(root, 'motions')
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

const bytes = Buffer.from('glTF-fake-vrma')

describe('motionLibrary', () => {
  it('scans .vrma files and names them after the file', async () => {
    const library = new MotionLibrary({ directory: dir, watch: false })
    await library.start()
    await writeFile(join(dir, 'VRMA_01.vrma'), bytes)
    await writeFile(join(dir, 'notes.txt'), 'x')
    const entries = await library.scan()
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({
      id: 'vrma:VRMA_01.vrma',
      name: 'VRMA_01',
      type: 'vrma',
      compatibleModels: ['vrm'],
      source: { kind: 'file', fileName: 'VRMA_01.vrma', sizeBytes: bytes.length },
    })
  })

  it('picks up added and removed files through the watcher', async () => {
    const library = new MotionLibrary({ directory: dir, debounceMs: 20 })
    await library.start()
    const changes: number[] = []
    library.onChange(entries => changes.push(entries.length))

    await writeFile(join(dir, 'wave.vrma'), bytes)
    await vi.waitFor(() => expect(library.list().map(entry => entry.id)).toEqual(['vrma:wave.vrma']), { timeout: 3000 })
    await rm(join(dir, 'wave.vrma'))
    await vi.waitFor(() => expect(library.list()).toEqual([]), { timeout: 3000 })
    expect(changes).toContain(1)
    expect(changes.at(-1)).toBe(0)
    library.stop()
  })

  it('renames with tags and description in the sidecar file', async () => {
    const library = new MotionLibrary({ directory: dir, watch: false })
    await library.start()
    await writeFile(join(dir, 'VRMA_02.vrma'), bytes)
    await library.scan()
    await library.rename('vrma:VRMA_02.vrma', { name: '打招呼', tags: ['greet', ' greet ', 'happy'], description: 'Waves one hand.' })
    expect(library.list()[0]).toMatchObject({ name: '打招呼', tags: ['greet', 'happy'], description: 'Waves one hand.' })
    const sidecar = JSON.parse(await readFile(join(dir, MOTION_METADATA_FILE), 'utf8'))
    expect(sidecar.motions['VRMA_02.vrma'].name).toBe('打招呼')

    await library.rename('vrma:VRMA_02.vrma', { name: '' })
    expect(library.list()[0].name).toBe('VRMA_02')
    await library.rename('live2d:Idle:0', { name: 'Breathe' })
    expect(live2dMotionEntries([{ group: 'Idle', count: 2 }], library.metadataMap()).map(entry => entry.name)).toEqual(['Breathe', 'Idle 2'])
    await expect(library.rename('nope', { name: 'x' })).rejects.toThrow('is not a motion id')
  })

  it('uploads from base64 and from a local path with validation', async () => {
    const library = new MotionLibrary({ directory: dir, watch: false, maxBytes: 64 })
    await library.start()
    const entry = await library.upload({ fileName: 'Hi.vrma', base64: `data:application/octet-stream;base64,${bytes.toString('base64')}`, name: 'Hello' })
    expect(entry).toMatchObject({ id: 'vrma:Hi.vrma', name: 'Hello' })
    expect(await readFile(join(dir, 'Hi.vrma'))).toEqual(bytes)

    const source = join(root, 'Dance.vrma')
    await writeFile(source, bytes)
    await expect(library.upload({ path: source })).resolves.toMatchObject({ id: 'vrma:Dance.vrma' })

    await expect(library.upload({ fileName: 'Hi.vrma', base64: bytes.toString('base64') })).rejects.toThrow('already exists')
    await expect(library.upload({ fileName: 'Hi.vrma', base64: bytes.toString('base64'), overwrite: true })).resolves.toBeTruthy()
    await expect(library.upload({ fileName: 'bad.glb', base64: 'AAAA' })).rejects.toThrow('.vrma extension')
    await expect(library.upload({ fileName: '../x.vrma', base64: 'AAAA' })).rejects.toThrow('folder')
    await expect(library.upload({ fileName: 'big.vrma', base64: Buffer.alloc(100).toString('base64') })).rejects.toThrow('larger than')
    await expect(library.upload({ fileName: 'junk.vrma', base64: '!!!' })).rejects.toThrow('not valid')
    await expect(library.upload({ path: 'relative.vrma' })).rejects.toThrow('absolute')
  })

  it('deletes a file and its metadata, and refuses Live2D ids', async () => {
    const library = new MotionLibrary({ directory: dir, watch: false })
    await library.start()
    await library.upload({ fileName: 'Bye.vrma', base64: bytes.toString('base64'), name: 'Bye' })
    await library.delete('vrma:Bye.vrma')
    expect(library.list()).toEqual([])
    await expect(stat(join(dir, 'Bye.vrma'))).rejects.toThrow()
    expect(library.metadataMap()['Bye.vrma']).toBeUndefined()
    await expect(library.delete('vrma:Bye.vrma')).rejects.toThrow('No motion file')
    await expect(library.delete('live2d:Idle:0')).rejects.toThrow('cannot be deleted')
  })

  it('switches folders', async () => {
    const library = new MotionLibrary({ directory: dir, watch: false })
    await library.start()
    const other = join(root, 'other')
    await library.setDirectory(other)
    expect(library.directory).toBe(other)
    await expect(library.setDirectory('relative')).rejects.toThrow('absolute')
  })
})

describe('motion helpers', () => {
  it('validates file names', () => {
    expect(validateMotionFileName(' a.VRMA ')).toBe('a.VRMA')
    expect(() => validateMotionFileName('a\\b.vrma')).toThrow('folder')
    expect(() => validateMotionFileName('a.vrm')).toThrow('.vrma')
  })

  it('finds motions by id, name, and file name', () => {
    const entries = live2dMotionEntries([{ group: 'Tap', count: 1 }, { group: 'Idle', count: 2 }])
    expect(findMotion(entries, 'live2d:Idle:1').name).toBe('Idle 2')
    expect(findMotion(entries, 'tap').id).toBe('live2d:Tap:0')
    expect(() => findMotion(entries, 'missing')).toThrow('motion.list')
  })

  it('reads the folder from env, saved settings, then the default', async () => {
    expect(await readMotionDirectory(root, {})).toBe(defaultMotionDirectory(root))
    await saveMotionDirectory(root, join(root, 'chosen'))
    expect(await readMotionDirectory(root, {})).toBe(join(root, 'chosen'))
    expect(await readMotionDirectory(root, { AIRI_MOTIONS_DIR: join(root, 'env') })).toBe(join(root, 'env'))
    await saveMotionDirectory(root, undefined)
    expect(await readMotionDirectory(root, {})).toBe(defaultMotionDirectory(root))
  })
})
