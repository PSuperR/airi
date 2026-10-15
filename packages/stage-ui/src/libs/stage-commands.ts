import type { StageCommandResult, StageModelCommand } from '@proj-airi/stage-shared/stage-command'

import { errorMessageFrom } from '@moeru/std'

type StageCommandHandler = (command: StageModelCommand) => Promise<void>

let handler: StageCommandHandler | undefined

/**
 * Registers the stage scene that runs model commands.
 *
 * The last registration wins. Call the returned function when that scene unmounts.
 */
export function registerStageCommands(execute: StageCommandHandler): () => void {
  handler = execute
  return () => {
    if (handler === execute)
      handler = undefined
  }
}

/** Runs one model command on the registered stage scene. */
export async function runStageCommand(command: StageModelCommand): Promise<StageCommandResult> {
  if (!handler)
    return { ok: false, error: 'The stage is not ready.' }

  try {
    await handler(command)
    return { ok: true }
  }
  catch (error) {
    return { ok: false, error: errorMessageFrom(error) ?? 'The stage command failed.' }
  }
}
