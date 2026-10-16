/** A model command. The stage scene chooses Live2D or VRM behavior. */
export type StageModelCommand
  = | { action: 'expression', name: string, durationMs?: number, intensity?: number }
    | { action: 'motion', name: string, index?: number }
    | { action: 'speech', text: string, speak?: boolean }
    | { action: 'view', x?: number, y?: number, z?: number, scale?: number }
    | { action: 'model', modelId: string }
    | StageVrmaCommand
    | StageLightCommand
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
  /**
   * Current model view. Live2D: x/y percent, scale factor. VRM: x/y/z meters, scale = camera distance.
   * Absent when no model is shown.
   */
  view?: { x: number, y: number, z?: number, scale: number }
  /** Current VRM scene lighting. Present only when the renderer is `vrm`. */
  lighting?: StageLighting
}

/** Environment light mode of the VRM scene. */
export type StageLightEnvironment = 'hemisphere' | 'skyBox'

/**
 * Changes the VRM scene lighting. Every field is optional; omitted fields keep their value.
 * Intensities are clamped to 0-10, rotations to -180..180 degrees, `skyBoxIntensity` to 0-1,
 * and `exposure` to 0.1-5. Colors are `#RRGGBB`.
 * With no fields it only reads the lighting. The result carries the current `StageLighting` in `data`.
 * The settings are saved, the same as the VRM settings page.
 */
export interface StageLightCommand {
  action: 'light'
  ambient?: { intensity?: number, color?: string }
  directional?: { intensity?: number, color?: string, rotationX?: number, rotationY?: number }
  hemisphere?: { intensity?: number, skyColor?: string, groundColor?: string }
  environment?: StageLightEnvironment
  skyBoxIntensity?: number
  exposure?: number
}

/** The full VRM scene lighting. */
export interface StageLighting {
  ambient: { intensity: number, color: string }
  directional: { intensity: number, color: string, rotationX: number, rotationY: number }
  hemisphere: { intensity: number, skyColor: string, groundColor: string }
  environment: StageLightEnvironment
  skyBoxIntensity: number
  exposure: number
}

/** A lighting change with every value already checked and clamped. */
export type StageLightingPatch = Omit<StageLightCommand, 'action'>

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
