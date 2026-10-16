import type { StageCommandResult } from '@proj-airi/stage-shared/stage-command'

import type { StageKitClient } from './kit'
import type { MotionActionContext } from './motion-actions'
import type { PluginControlCommand } from './protocol'

import { errorMessageFrom } from '@moeru/std'

import { runMotionCommand } from './motion-actions'
import { resolveVrmaSource } from './vrma-source'

/** Routes one command to the stage kit or the motion library. */
export async function dispatchStageControl(
  command: PluginControlCommand,
  kit: StageKitClient,
  motions?: Omit<MotionActionContext, 'kit'>,
): Promise<StageCommandResult> {
  try {
    if (command.action.startsWith('motion.')) {
      if (!motions)
        return { ok: false, error: 'The motion library is not ready.' }
      return await runMotionCommand(command as Parameters<typeof runMotionCommand>[0], { ...motions, kit })
    }
    const stageCommand = command as Exclude<PluginControlCommand, { action: `motion.${string}` }>

    if (stageCommand.action === 'window')
      return await kit.setWindowVisible(stageCommand.visible)

    if (stageCommand.action === 'speech') {
      const shown = await kit.showCaption()
      if (!shown.ok)
        return shown
    }

    if (stageCommand.action === 'vrma')
      return await kit.command({ ...stageCommand, src: await resolveVrmaSource(stageCommand.src) })

    return await kit.command(stageCommand)
  }
  catch (error) {
    return { ok: false, error: errorMessageFrom(error) ?? 'The stage command failed.' }
  }
}
