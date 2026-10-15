/** A model command. The stage scene chooses Live2D or VRM behavior. */
export type StageModelCommand
  = | { action: 'expression', name: string, durationMs?: number, intensity?: number }
    | { action: 'motion', name: string, index?: number }
    | { action: 'speech', text: string, speak?: boolean }
    | { action: 'view', x?: number, y?: number, z?: number, scale?: number }
    | { action: 'model', modelId: string }

/** Shows or hides the main window. The main process handles this command. */
export interface StageWindowCommand {
  action: 'window'
  visible: boolean
}

/** One external stage command. */
export type StageControlCommand = StageModelCommand | StageWindowCommand

/** The result of one stage command. */
export interface StageCommandResult {
  ok: boolean
  error?: string
}
