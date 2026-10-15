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
}

export const stageKit = defineKit<StageKitClient>({
  id: 'kit.stage',
  version: '1.0.0',
  createClient() {
    throw new Error('The stage kit client is created by the desktop host.')
  },
})
