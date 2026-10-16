import type { FSWatcher } from 'node:fs'

import type { StageLive2dMotionGroup } from '@proj-airi/stage-shared/stage-command'

import process from 'node:process'

import { Buffer } from 'node:buffer'
import { watch } from 'node:fs'
import { copyFile, mkdir, readdir, readFile, rename as renameFile, stat, unlink, writeFile } from 'node:fs/promises'
import { basename, extname, isAbsolute, join } from 'node:path'

import { errorMessageFrom } from '@moeru/std'

import { MAX_VRMA_FILE_BYTES } from './vrma-source'

/** Name of the sidecar file that keeps display names, tags, and descriptions. */
export const MOTION_METADATA_FILE = 'motions.json'

/** Kind of motion. `vrma` is a file in the motion folder, `live2d` is a motion built into the Live2D model. */
export type MotionType = 'vrma' | 'live2d'

/** Model type that can play a motion. */
export type MotionModelType = 'vrm' | 'live2d'

/** Where a motion comes from. */
export type MotionSource
  = | { kind: 'file', fileName: string, path: string, sizeBytes: number }
    | { kind: 'live2d', group: string, index: number }

/** One entry of the motion library. */
export interface MotionEntry {
  /** Stable id: `vrma:<file name>` or `live2d:<group>:<index>`. */
  id: string
  /** Friendly name. Defaults to the file name without `.vrma`, or `<group>` / `<group> <index>`. */
  name: string
  type: MotionType
  compatibleModels: MotionModelType[]
  source: MotionSource
  tags?: string[]
  description?: string
}

/** Editable metadata for one motion. */
export interface MotionMetadata {
  name?: string
  tags?: string[]
  description?: string
}

/** Sidecar file shape. Keys are `.vrma` file names, or `live2d:<group>:<index>` for Live2D motions. */
export interface MotionMetadataFile {
  version: 1
  motions: Record<string, MotionMetadata>
}

/** Upload request: copy a local file or write base64 bytes into the motion folder. */
export interface MotionUploadRequest {
  fileName?: string
  path?: string
  base64?: string
  name?: string
  tags?: string[]
  description?: string
  overwrite?: boolean
}

export interface MotionLibraryOptions {
  directory: string
  /** Wait time before a folder change is read again. Default 300 ms. */
  debounceMs?: number
  /** Largest `.vrma` file the library accepts. Default 32 MB. */
  maxBytes?: number
  /** Watch the folder for changes. Default true. */
  watch?: boolean
  log?: (message: string) => void
}

export type MotionLibraryListener = (entries: MotionEntry[]) => void

const VRMA_EXTENSION = '.vrma'

function isVrmaFile(fileName: string) {
  return extname(fileName).toLowerCase() === VRMA_EXTENSION
}

function cleanTags(tags: string[] | undefined) {
  if (!tags)
    return undefined
  const list = [...new Set(tags.map(tag => tag.trim()).filter(Boolean))]
  return list.length > 0 ? list : undefined
}

function applyMetadata(entry: MotionEntry, meta: MotionMetadata | undefined): MotionEntry {
  if (!meta)
    return entry
  const tags = cleanTags(meta.tags)
  return {
    ...entry,
    ...(meta.name?.trim() ? { name: meta.name.trim() } : {}),
    ...(tags ? { tags } : {}),
    ...(meta.description?.trim() ? { description: meta.description.trim() } : {}),
  }
}

/** Checks an uploaded file name. Returns the bare name or throws. */
export function validateMotionFileName(fileName: string): string {
  const trimmed = fileName.trim()
  if (!trimmed)
    throw new Error('The file name is empty.')
  if (/[/\\]/.test(trimmed) || trimmed === '.' || trimmed === '..' || basename(trimmed) !== trimmed)
    throw new Error('The file name must not contain a folder.')

  if (/[<>:"|?*]/.test(trimmed) || [...trimmed].some(char => char.charCodeAt(0) < 32))
    throw new Error('The file name has a character that is not allowed.')
  if (!isVrmaFile(trimmed))
    throw new Error('The file must have the .vrma extension.')
  return trimmed
}

function live2dKey(group: string, index: number) {
  return `live2d:${group}:${index}`
}

/** Builds library entries for the Live2D motion groups of the current model. */
export function live2dMotionEntries(groups: readonly StageLive2dMotionGroup[], metadata: MotionMetadataFile['motions'] = {}): MotionEntry[] {
  const entries: MotionEntry[] = []
  for (const { group, count } of groups) {
    for (let index = 0; index < count; index += 1) {
      const id = live2dKey(group, index)
      entries.push(applyMetadata({
        id,
        name: count === 1 ? group : `${group} ${index + 1}`,
        type: 'live2d',
        compatibleModels: ['live2d'],
        source: { kind: 'live2d', group, index },
      }, metadata[id]))
    }
  }
  return entries
}

/** Finds one motion by id, then by name, then by file name. Throws when there is no single match. */
export function findMotion(entries: readonly MotionEntry[], key: string): MotionEntry {
  const byId = entries.find(entry => entry.id === key)
  if (byId)
    return byId

  const lower = key.trim().toLowerCase()
  const byName = entries.filter(entry => entry.name.toLowerCase() === lower)
  if (byName.length === 1)
    return byName[0]
  if (byName.length > 1)
    throw new Error(`More than one motion is named "${key}". Use the id: ${byName.map(entry => entry.id).join(', ')}.`)

  const byFile = entries.filter(entry => entry.source.kind === 'file' && (
    entry.source.fileName.toLowerCase() === lower
    || basename(entry.source.fileName, extname(entry.source.fileName)).toLowerCase() === lower
  ))
  if (byFile.length === 1)
    return byFile[0]

  throw new Error(`No motion has the id or name "${key}". Call motion.list to see the motions.`)
}

function sameEntries(a: readonly MotionEntry[], b: readonly MotionEntry[]) {
  return JSON.stringify(a) === JSON.stringify(b)
}

/**
 * Keeps the `.vrma` files of one folder and their sidecar metadata.
 *
 * Call `start` to read the folder and watch it. Listeners run when the list changes.
 */
export class MotionLibrary {
  private directoryPath: string
  private readonly debounceMs: number
  private readonly maxBytes: number
  private readonly watchEnabled: boolean
  private readonly log: (message: string) => void
  private watcher: FSWatcher | undefined
  private timer: ReturnType<typeof setTimeout> | undefined
  private entries: MotionEntry[] = []
  private metadata: MotionMetadataFile = { version: 1, motions: {} }
  private readonly listeners = new Set<MotionLibraryListener>()
  private queue: Promise<unknown> = Promise.resolve()

  constructor(options: MotionLibraryOptions) {
    this.directoryPath = options.directory
    this.debounceMs = options.debounceMs ?? 300
    this.maxBytes = options.maxBytes ?? MAX_VRMA_FILE_BYTES
    this.watchEnabled = options.watch ?? true
    this.log = options.log ?? (() => {})
  }

  get directory() {
    return this.directoryPath
  }

  /** `.vrma` entries from the last scan. */
  list(): MotionEntry[] {
    return [...this.entries]
  }

  /** Metadata keyed by file name or Live2D id. */
  metadataMap(): MotionMetadataFile['motions'] {
    return { ...this.metadata.motions }
  }

  onChange(listener: MotionLibraryListener) {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  async start() {
    await mkdir(this.directoryPath, { recursive: true })
    await this.scan()
    this.startWatch()
  }

  stop() {
    this.watcher?.close()
    this.watcher = undefined
    if (this.timer !== undefined)
      clearTimeout(this.timer)
    this.timer = undefined
  }

  /** Switches to another folder, reads it, and watches it. */
  async setDirectory(directory: string) {
    if (!isAbsolute(directory))
      throw new Error('The motion folder must be an absolute path.')
    await mkdir(directory, { recursive: true })
    const info = await stat(directory)
    if (!info.isDirectory())
      throw new Error(`The motion folder is not a folder: ${directory}`)
    this.stop()
    this.directoryPath = directory
    this.entries = []
    await this.scan(true)
    this.startWatch()
  }

  /** Reads the folder again. Notifies listeners when the list changed or `force` is set. */
  scan(force = false): Promise<MotionEntry[]> {
    return this.serial(async () => {
      this.metadata = await this.readMetadata()
      const names = await readdir(this.directoryPath).catch(() => [] as string[])
      const next: MotionEntry[] = []
      for (const fileName of names.filter(isVrmaFile).sort((a, b) => a.localeCompare(b))) {
        const path = join(this.directoryPath, fileName)
        const info = await stat(path).catch(() => undefined)
        if (!info?.isFile())
          continue
        next.push(applyMetadata({
          id: `vrma:${fileName}`,
          name: basename(fileName, extname(fileName)),
          type: 'vrma',
          compatibleModels: ['vrm'],
          source: { kind: 'file', fileName, path, sizeBytes: info.size },
        }, this.metadata.motions[fileName]))
      }
      const changed = force || !sameEntries(this.entries, next)
      this.entries = next
      if (changed)
        this.emit()
      return next
    })
  }

  /** Saves a `.vrma` file into the folder. */
  async upload(request: MotionUploadRequest): Promise<MotionEntry> {
    const fileName = validateMotionFileName(request.fileName ?? (request.path ? basename(request.path.replace(/\\/g, '/')) : ''))
    if ((request.path === undefined) === (request.base64 === undefined))
      throw new Error('Pass either path or base64.')

    const target = join(this.directoryPath, fileName)
    if (!request.overwrite && await stat(target).then(() => true, () => false))
      throw new Error(`A motion file named "${fileName}" already exists. Pass overwrite: true to replace it.`)

    await mkdir(this.directoryPath, { recursive: true })
    const temp = `${target}.${process.pid}.${Date.now()}.part`
    if (request.path !== undefined) {
      if (!isAbsolute(request.path))
        throw new Error('The source path must be absolute.')
      if (!isVrmaFile(request.path))
        throw new Error('The source file must have the .vrma extension.')
      const info = await stat(request.path).catch(() => undefined)
      if (!info?.isFile())
        throw new Error(`The source file was not found: ${request.path}`)
      this.checkSize(info.size)
      await copyFile(request.path, temp)
    }
    else {
      const text = (request.base64 ?? '').replace(/^data:[^,]*,/, '').replace(/\s+/g, '')
      if (!text || !/^[A-Z0-9+/]+={0,2}$/i.test(text))
        throw new Error('The base64 content is not valid.')
      this.checkSize(Math.floor(text.length * 3 / 4))
      const bytes = Buffer.from(text, 'base64')
      this.checkSize(bytes.length)
      await writeFile(temp, bytes)
    }
    await renameFile(temp, target)

    if (request.name !== undefined || request.tags !== undefined || request.description !== undefined)
      await this.writeMetadataFor(fileName, { name: request.name, tags: request.tags, description: request.description })

    const entries = await this.scan(true)
    const entry = entries.find(item => item.id === `vrma:${fileName}`)
    if (!entry)
      throw new Error('The motion was saved but could not be read back.')
    return entry
  }

  /** Changes the name, tags, or description of a motion. Works for `vrma:` and `live2d:` ids. */
  async rename(id: string, meta: MotionMetadata) {
    const key = this.metadataKey(id)
    await this.writeMetadataFor(key, meta)
    await this.scan(true)
    return { id, ...this.metadata.motions[key] }
  }

  /** Deletes one `.vrma` file and its metadata. */
  async delete(id: string) {
    const key = this.metadataKey(id)
    if (key.startsWith('live2d:'))
      throw new Error('Live2D motions are part of the model and cannot be deleted.')
    const path = join(this.directoryPath, key)
    const info = await stat(path).catch(() => undefined)
    if (!info?.isFile())
      throw new Error(`No motion file has the id "${id}".`)
    await unlink(path)
    await this.serial(async () => {
      const current = await this.readMetadata()
      delete current.motions[key]
      await this.saveMetadata(current)
    })
    await this.scan(true)
  }

  private metadataKey(id: string) {
    if (id.startsWith('vrma:'))
      return validateMotionFileName(id.slice('vrma:'.length))
    if (/^live2d:.+:\d+$/.test(id))
      return id
    throw new Error(`"${id}" is not a motion id. Use a vrma:<file> or live2d:<group>:<index> id.`)
  }

  private checkSize(size: number) {
    if (size > this.maxBytes)
      throw new Error(`The .vrma file is larger than ${Math.round(this.maxBytes / 1024 / 1024)} MB.`)
    if (size === 0)
      throw new Error('The .vrma file is empty.')
  }

  private writeMetadataFor(key: string, meta: MotionMetadata) {
    return this.serial(async () => {
      const current = await this.readMetadata()
      const previous = current.motions[key] ?? {}
      const next: MotionMetadata = { ...previous }
      if (meta.name !== undefined) {
        if (meta.name.trim())
          next.name = meta.name.trim()
        else delete next.name
      }
      if (meta.tags !== undefined) {
        const tags = cleanTags(meta.tags)
        if (tags)
          next.tags = tags
        else delete next.tags
      }
      if (meta.description !== undefined) {
        if (meta.description.trim())
          next.description = meta.description.trim()
        else delete next.description
      }
      if (Object.keys(next).length > 0)
        current.motions[key] = next
      else delete current.motions[key]
      await this.saveMetadata(current)
    })
  }

  private async readMetadata(): Promise<MotionMetadataFile> {
    const text = await readFile(join(this.directoryPath, MOTION_METADATA_FILE), 'utf8').catch(() => undefined)
    if (text === undefined)
      return { version: 1, motions: {} }
    try {
      const parsed: unknown = JSON.parse(text)
      if (parsed && typeof parsed === 'object' && 'motions' in parsed && parsed.motions && typeof parsed.motions === 'object')
        return { version: 1, motions: parsed.motions as Record<string, MotionMetadata> }
    }
    catch (error) {
      this.log(`Could not read ${MOTION_METADATA_FILE}. ${errorMessageFrom(error) ?? ''}`.trim())
    }
    return { version: 1, motions: {} }
  }

  private async saveMetadata(file: MotionMetadataFile) {
    await mkdir(this.directoryPath, { recursive: true })
    await writeFile(join(this.directoryPath, MOTION_METADATA_FILE), `${JSON.stringify(file, null, 2)}\n`, 'utf8')
    this.metadata = file
  }

  private startWatch() {
    if (!this.watchEnabled)
      return
    try {
      this.watcher = watch(this.directoryPath, () => this.scheduleScan())
      this.watcher.on('error', (error) => {
        this.log(`Stopped watching the motion folder. ${errorMessageFrom(error) ?? ''}`.trim())
        this.watcher?.close()
        this.watcher = undefined
      })
    }
    catch (error) {
      this.log(`Could not watch the motion folder. ${errorMessageFrom(error) ?? ''}`.trim())
    }
  }

  private scheduleScan() {
    if (this.timer !== undefined)
      clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.timer = undefined
      this.scan().catch((error: unknown) => {
        this.log(`Could not read the motion folder. ${errorMessageFrom(error) ?? ''}`.trim())
      })
    }, this.debounceMs)
  }

  private serial<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task, task)
    this.queue = run.catch(() => {})
    return run
  }

  private emit() {
    const snapshot = this.list()
    for (const listener of this.listeners) {
      try {
        listener(snapshot)
      }
      catch (error) {
        this.log(`A motion library listener failed. ${errorMessageFrom(error) ?? ''}`.trim())
      }
    }
  }
}
