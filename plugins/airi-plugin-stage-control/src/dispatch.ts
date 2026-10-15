import type { StageCommandResult, StageControlCommand } from '@proj-airi/stage-shared/stage-command'

import type { StageKitClient } from './kit'

import { errorMessageFrom } from '@moeru/std'

/** Routes one command to the stage kit. */
export async function dispatchStageControl(command: StageControlCommand, kit: StageKitClient): Promise<StageCommandResult> {
  try {
    if (command.action === 'window')
      return await kit.setWindowVisible(command.visible)

    if (command.action === 'speech') {
      const shown = await kit.showCaption()
      if (!shown.ok)
        return shown
    }

    return await kit.command(command)
  }
  catch (error) {
    return { ok: false, error: errorMessageFrom(error) ?? 'The stage command failed.' }
  }
}
