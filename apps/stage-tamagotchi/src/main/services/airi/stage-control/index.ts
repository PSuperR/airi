import type { createContext } from '@moeru/eventa/adapters/electron/main'
import type { KitRef } from '@proj-airi/plugin-sdk'
import type { StageKitClient } from '@proj-airi/plugin-stage-control'
import type { StageCommandResult, StageModelCommand } from '@proj-airi/stage-shared/stage-command'
import type { BrowserWindow } from 'electron'

import { defineInvoke } from '@moeru/eventa'
import { errorMessageFrom } from '@moeru/std'
import { stageKit } from '@proj-airi/plugin-stage-control'
import { app } from 'electron'

import { electronStageCommand } from '../../../../shared/eventa'
import { readServerChannelEndpoint } from '../channel-server'
import { applyWindowVisibility } from './window'

type EventaContext = ReturnType<typeof createContext>['context']

let stageWindow: BrowserWindow | undefined
let invokeCommand: ((command: StageModelCommand) => Promise<StageCommandResult>) | undefined
let showCaption: (() => Promise<void>) | undefined

/** Binds the main stage window and its existing Eventa context. */
export function bindStageWindow(params: { window: BrowserWindow, context: EventaContext }) {
  stageWindow = params.window
  invokeCommand = defineInvoke(params.context, electronStageCommand)
  params.window.once('closed', () => {
    if (stageWindow !== params.window)
      return
    stageWindow = undefined
    invokeCommand = undefined
  })
}

/** Binds the function that opens the caption window. */
export function bindCaptionWindow(show: () => Promise<void>) {
  showCaption = show
}

/** Runs one model command in the main stage renderer. */
export async function stageCommand(command: StageModelCommand): Promise<StageCommandResult> {
  if (!invokeCommand || !stageWindow || stageWindow.isDestroyed())
    return { ok: false, error: 'The stage is not ready.' }

  try {
    return await invokeCommand(command)
  }
  catch (error) {
    return { ok: false, error: errorMessageFrom(error) ?? 'The stage command failed.' }
  }
}

/** Shows or hides the bound main window. */
export function setWindowVisible(visible: boolean) {
  return applyWindowVisibility(stageWindow, visible)
}

/** Whether the bound main window is visible. Undefined when it is not ready. */
export function isWindowVisible() {
  if (!stageWindow || stageWindow.isDestroyed())
    return undefined
  return stageWindow.isVisible()
}

/** Opens the caption window so a later caption broadcast has a listener. */
export async function showCaptionWindow(): Promise<StageCommandResult> {
  if (!showCaption)
    return { ok: false, error: 'The caption window is not ready.' }

  try {
    await showCaption()
    return { ok: true }
  }
  catch (error) {
    return { ok: false, error: errorMessageFrom(error) ?? 'The caption window is not ready.' }
  }
}

/** Creates the host kit client for the built-in stage control plugin. */
export function createHostStageKit(): KitRef<StageKitClient> {
  return {
    ...stageKit,
    createClient() {
      return {
        readChannel: () => readServerChannelEndpoint(),
        command: command => stageCommand(command),
        setWindowVisible: visible => setWindowVisible(visible),
        showCaption: () => showCaptionWindow(),
        isWindowVisible: () => isWindowVisible(),
        readUserDataPath: async () => app.getPath('userData'),
      }
    },
  }
}
