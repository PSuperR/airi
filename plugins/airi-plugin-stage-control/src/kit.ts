import type { StageCommandResult, StageModelCommand } from '@proj-airi/stage-shared/stage-command'

import { defineKit } from '@proj-airi/plugin-sdk'

/** Channel address and token for the local stage control session. */
export interface StageChannelEndpoint {
  url: string
  token: string
}

/**
 * Host calls that the stage control plugin uses.
 *
 * The desktop host replaces `createClient`. The default client throws.
 */
export interface StageKitClient {
  readChannel: () => Promise<StageChannelEndpoint>
  command: (command: StageModelCommand) => Promise<StageCommandResult>
  setWindowVisible: (visible: boolean) => StageCommandResult | Promise<StageCommandResult>
  showCaption: () => Promise<StageCommandResult>
  /**
   * Per-user data folder of the host app (Electron `userData`).
   * The motion library keeps its default folder and settings there.
   * Optional so older hosts still work; the plugin then falls back to the home folder.
   */
  readUserDataPath?: () => Promise<string>
}

export const stageKit = defineKit<StageKitClient>({
  id: 'kit.stage',
  version: '1.0.0',
  createClient() {
    throw new Error('The stage kit client is created by the desktop host.')
  },
})
