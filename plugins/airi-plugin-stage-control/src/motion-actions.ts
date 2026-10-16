import type { StageCommandResult, StageState } from '@proj-airi/stage-shared/stage-command'

import type { StageKitClient } from './kit'
import type { MotionEntry, MotionLibrary } from './motion-library'
import type { MotionLibraryCommand } from './protocol'

import { findMotion, live2dMotionEntries } from './motion-library'
import { resolveVrmaSource } from './vrma-source'

/** What the motion actions need besides the stage kit. */
export interface MotionActionContext {
  library: MotionLibrary
  kit: Pick<StageKitClient, 'command'>
  /** Changes the motion folder and saves the choice. `undefined` goes back to the default folder. */
  setDirectory: (directory: string | undefined) => Promise<void>
}

/** Reads the stage model type. Falls back to `unknown` when the stage cannot answer. */
export async function readStageState(kit: Pick<StageKitClient, 'command'>): Promise<StageState & { error?: string }> {
  const result = await kit.command({ action: 'state' })
  const data = result.data as Partial<StageState> | undefined
  if (!result.ok || !data || typeof data.renderer !== 'string')
    return { renderer: 'unknown', live2dMotionGroups: [], error: result.error ?? 'The stage did not report its state.' }
  return { renderer: data.renderer, live2dMotionGroups: Array.isArray(data.live2dMotionGroups) ? data.live2dMotionGroups : [] }
}

function compatible(entry: MotionEntry, renderer: string) {
  return (entry.compatibleModels as string[]).includes(renderer)
}

async function allEntries(context: MotionActionContext) {
  const state = await readStageState(context.kit)
  const entries = [
    ...context.library.list(),
    ...live2dMotionEntries(state.live2dMotionGroups, context.library.metadataMap()),
  ]
  return { state, entries }
}

/** Runs one motion library action. */
export async function runMotionCommand(command: MotionLibraryCommand, context: MotionActionContext): Promise<StageCommandResult> {
  const { library } = context
  switch (command.action) {
    case 'motion.list': {
      const { state, entries } = await allEntries(context)
      const motions = command.all ? entries : entries.filter(entry => compatible(entry, state.renderer))
      return {
        ok: true,
        data: {
          modelType: state.renderer,
          directory: library.directory,
          motions,
          ...(state.error ? { warning: state.error } : {}),
        },
      }
    }
    case 'motion.play': {
      const { state, entries } = await allEntries(context)
      const entry = findMotion(entries, command.id ?? command.name ?? '')
      if (!compatible(entry, state.renderer)) {
        throw new Error(`Motion "${entry.name}" needs a ${entry.compatibleModels.join(' or ')} model. The current model is ${state.renderer}.`)
      }
      const played = entry.source.kind === 'file'
        ? await context.kit.command({
            action: 'vrma',
            src: await resolveVrmaSource(entry.source.path),
            ...(command.loop === undefined ? {} : { loop: command.loop }),
            ...(command.fadeInMs === undefined ? {} : { fadeInMs: command.fadeInMs }),
            ...(command.fadeOutMs === undefined ? {} : { fadeOutMs: command.fadeOutMs }),
          })
        : await context.kit.command({ action: 'motion', name: entry.source.group, index: entry.source.index })
      return played.ok ? { ok: true, data: { id: entry.id, name: entry.name, type: entry.type } } : played
    }
    case 'motion.rename': {
      const meta = await library.rename(command.id, { name: command.name, tags: command.tags, description: command.description })
      return { ok: true, data: meta }
    }
    case 'motion.upload': {
      const { action: _action, ...request } = command
      return { ok: true, data: await library.upload(request) }
    }
    case 'motion.delete':
      await library.delete(command.id)
      return { ok: true, data: { id: command.id } }
    case 'motion.setDirectory':
      await context.setDirectory(command.reset ? undefined : command.directory)
      return { ok: true, data: { directory: library.directory } }
  }
}
