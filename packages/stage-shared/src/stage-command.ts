/** A model command. The stage scene chooses Live2D or VRM behavior. */
export type StageModelCommand
  = | { action: 'expression', name: string, durationMs?: number, intensity?: number }
    | { action: 'motion', name: string, index?: number }
    | { action: 'speech', text: string, speak?: boolean }
    | { action: 'view', x?: number, y?: number, z?: number, scale?: number }
    | { action: 'model', modelId: string }
    | StageVrmaCommand
    | StageStateCommand

/**
 * Reads the current stage state. The result carries a `StageState` in `data`.
 * It changes nothing on the stage.
 */
export interface StageStateCommand {
  action: 'state'
}

/** One Live2D motion group on the current model. */
export interface StageLive2dMotionGroup {
  group: string
  count: number
}

/** What the current stage model can do. Returned by the `state` command. */
export interface StageState {
  /** `live2d`, `vrm`, another renderer id, or `disabled` when no model is shown. */
  renderer: string
  /** Motion groups of the current Live2D model. Empty for other renderers. */
  live2dMotionGroups: StageLive2dMotionGroup[]
}

/**
 * Plays one VRM animation (.vrma) on the VRM model, then returns to idle.
 * `src` is an http(s), data, or blob URL when it reaches the stage.
 * `loop` repeats the clip until another clip or a model reload replaces it.
 */
export interface StageVrmaCommand {
  action: 'vrma'
  src: string
  loop?: boolean
  fadeInMs?: number
  fadeOutMs?: number
}

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
  /** Extra data for read commands, such as `state`. */
  data?: unknown
}
