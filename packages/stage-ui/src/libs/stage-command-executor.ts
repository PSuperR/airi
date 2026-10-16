import type { StageLighting, StageLightingPatch, StageModelCommand, StageState } from '@proj-airi/stage-shared/stage-command'

import { vrmEmotionNames } from '@proj-airi/stage-ui-three/composables/vrm/expression'

/** One Live2D motion that an external command can play. */
export interface StageCommandMotion {
  fileName: string
  group: string
  index: number
}

/** The stage scene surface that applies one model command. */
export interface StageCommandRuntime {
  renderer: string | undefined
  live2dExpressions: {
    availableNames: readonly string[]
    play: (request: { name: string, duration?: number }) => Promise<boolean>
  }
  live2dMotions: {
    available: readonly StageCommandMotion[]
    play: (fileName: string) => Promise<boolean>
  }
  setVrmExpression: (name: string, intensity: number, durationMs: number) => boolean | Promise<boolean>
  /** Plays one .vrma clip on the VRM model. Resolves false when the model is not ready. */
  playVrmAnimation: (src: string, options: { loop: boolean, fadeInMs: number, fadeOutMs: number }) => Promise<boolean>
  setLive2dView: (key: 'x' | 'y' | 'scale', value: number) => void
  setVrmView: (key: 'x' | 'y' | 'z' | 'cameraDistance', value: number) => void
  /** Reads the current view of the shown model. */
  getView: () => StageState['view']
  /** Reads the VRM scene lighting. */
  getVrmLighting: () => StageLighting
  /** Writes a checked, clamped lighting change to the VRM scene settings. */
  setVrmLighting: (patch: StageLightingPatch) => void
  setModel: (modelId: string) => Promise<boolean>
  showCaptionText: (text: string) => void
  speakText: (text: string) => Promise<void>
}

function unsupported(action: string, renderer: string | undefined) {
  if (!renderer || renderer === 'disabled')
    return `${action} is not supported for this model.`

  return `${action} is not supported for the ${renderer} model.`
}

function resolveLive2DMotion(name: string, index: number | undefined, motions: readonly StageCommandMotion[]) {
  const byFile = motions.filter(motion => motion.fileName === name)
  if (byFile.length === 1 && index === undefined)
    return byFile[0]

  if (byFile.length > 0) {
    if (index === undefined) {
      throw new Error(`Live2D motion "${name}" matches more than one file. Pass index.`)
    }
    const match = byFile.find(motion => motion.index === index)
    if (!match)
      throw new Error(`Live2D motion "${name}" has no index ${index}.`)
    return match
  }

  const byGroup = motions.filter(motion => motion.group === name)
  if (byGroup.length === 0)
    throw new Error(`Live2D has no motion named "${name}".`)

  if (index !== undefined) {
    const match = byGroup.find(motion => motion.index === index)
    if (!match) {
      const indexes = byGroup.map(motion => motion.index).join(', ')
      throw new Error(`Live2D motion group "${name}" has no index ${index}. Indexes: ${indexes}.`)
    }
    return match
  }

  if (byGroup.length > 1) {
    const indexes = byGroup.map(motion => motion.index).join(', ')
    throw new Error(`Live2D motion group "${name}" has more than one motion. Pass index. Indexes: ${indexes}.`)
  }

  return byGroup[0]
}

async function applyExpression(command: Extract<StageModelCommand, { action: 'expression' }>, runtime: StageCommandRuntime) {
  if (runtime.renderer === 'live2d') {
    if (!runtime.live2dExpressions.availableNames.includes(command.name))
      throw new Error(`Live2D has no expression named "${command.name}".`)

    const played = await runtime.live2dExpressions.play({
      name: command.name,
      duration: command.durationMs === undefined ? undefined : command.durationMs / 1000,
    })
    if (!played)
      throw new Error('The Live2D model is not ready.')
    return
  }

  if (runtime.renderer === 'vrm') {
    const names: readonly string[] = vrmEmotionNames
    if (!names.includes(command.name)) {
      throw new Error(`The VRM model has no expression named "${command.name}". Names: ${vrmEmotionNames.join(', ')}.`)
    }
    if (command.intensity === 0)
      throw new Error('Intensity must be greater than 0 for a VRM expression.')

    const applied = await runtime.setVrmExpression(command.name, command.intensity ?? 1, command.durationMs ?? 3000)
    if (!applied)
      throw new Error('The VRM model is not ready.')
    return
  }

  throw new Error(unsupported('Expression', runtime.renderer))
}

async function applyMotion(command: Extract<StageModelCommand, { action: 'motion' }>, runtime: StageCommandRuntime) {
  if (runtime.renderer === 'vrm')
    throw new Error('The VRM model cannot play a named motion. Use the expression action.')

  if (runtime.renderer !== 'live2d')
    throw new Error(unsupported('Motion', runtime.renderer))

  const motion = resolveLive2DMotion(command.name, command.index, runtime.live2dMotions.available)
  const played = await runtime.live2dMotions.play(motion.fileName)
  if (!played)
    throw new Error('The Live2D model is not ready.')
}

const VRMA_SOURCE = /^(?:https?:|data:|blob:)/i

async function applyVrma(command: Extract<StageModelCommand, { action: 'vrma' }>, runtime: StageCommandRuntime) {
  if (runtime.renderer === 'live2d')
    throw new Error('The Live2D model cannot play a .vrma animation. Switch to a VRM model.')

  if (runtime.renderer !== 'vrm')
    throw new Error(unsupported('VRMA animation', runtime.renderer))

  if (!VRMA_SOURCE.test(command.src))
    throw new Error('The .vrma source must be an http(s), data, or blob URL.')

  const played = await runtime.playVrmAnimation(command.src, {
    loop: command.loop ?? false,
    fadeInMs: command.fadeInMs ?? 300,
    fadeOutMs: command.fadeOutMs ?? 300,
  })
  if (!played)
    throw new Error('The VRM model is not ready.')
}

function applyView(command: Extract<StageModelCommand, { action: 'view' }>, runtime: StageCommandRuntime) {
  if (command.x === undefined && command.y === undefined && command.z === undefined && command.scale === undefined)
    throw new Error('The view action needs x, y, z, or scale.')

  if (runtime.renderer === 'live2d') {
    if (command.z !== undefined)
      throw new Error('Depth is not supported for the Live2D model.')
    if (command.x !== undefined)
      runtime.setLive2dView('x', command.x)
    if (command.y !== undefined)
      runtime.setLive2dView('y', command.y)
    if (command.scale !== undefined)
      runtime.setLive2dView('scale', command.scale)
    return
  }

  if (runtime.renderer === 'vrm') {
    if (command.x !== undefined)
      runtime.setVrmView('x', command.x)
    if (command.y !== undefined)
      runtime.setVrmView('y', command.y)
    if (command.z !== undefined)
      runtime.setVrmView('z', command.z)
    if (command.scale !== undefined)
      runtime.setVrmView('cameraDistance', command.scale)
    return
  }

  throw new Error(unsupported('View', runtime.renderer))
}

async function applySpeech(command: Extract<StageModelCommand, { action: 'speech' }>, runtime: StageCommandRuntime) {
  runtime.showCaptionText(command.text)
  if (!command.speak || command.text.length === 0)
    return

  await runtime.speakText(command.text)
}

const HEX_COLOR = /^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/i

function clamp(value: number, min: number, max: number, field: string) {
  if (typeof value !== 'number' || !Number.isFinite(value))
    throw new Error(`${field} must be a finite number.`)
  return Math.min(max, Math.max(min, value))
}

function color(value: string, field: string) {
  if (typeof value !== 'string' || !HEX_COLOR.test(value))
    throw new Error(`${field} must be a #RRGGBB (or #RRGGBBAA) color.`)
  // Alpha is ignored: scene lights have none.
  return value.slice(0, 7).toLowerCase()
}

/** `#RRGGBBAA` -> `#rrggbb`, so a read-back color can be written back unchanged. */
function toRgbHex(value: string) {
  return HEX_COLOR.test(value) ? value.slice(0, 7).toLowerCase() : value
}

/** Normalizes every lighting color to `#rrggbb`. */
export function normalizeLighting(lighting: StageLighting): StageLighting {
  return {
    ...lighting,
    ambient: { ...lighting.ambient, color: toRgbHex(lighting.ambient.color) },
    directional: { ...lighting.directional, color: toRgbHex(lighting.directional.color) },
    hemisphere: { ...lighting.hemisphere, skyColor: toRgbHex(lighting.hemisphere.skyColor), groundColor: toRgbHex(lighting.hemisphere.groundColor) },
  }
}

function defined<T extends object>(value: T): T | undefined {
  const entries = Object.entries(value).filter(([, item]) => item !== undefined)
  return entries.length > 0 ? Object.fromEntries(entries) as T : undefined
}

/** Checks and clamps a light command. Returns undefined when it changes nothing. */
export function normalizeLightingPatch(command: Extract<StageModelCommand, { action: 'light' }>): StageLightingPatch | undefined {
  const patch: StageLightingPatch = {}
  const intensity = (value: number | undefined, field: string) => value === undefined ? undefined : clamp(value, 0, 10, field)
  const rotation = (value: number | undefined, field: string) => value === undefined ? undefined : clamp(value, -180, 180, field)
  const hex = (value: string | undefined, field: string) => value === undefined ? undefined : color(value, field)

  if (command.ambient) {
    patch.ambient = defined({
      intensity: intensity(command.ambient.intensity, 'ambient.intensity'),
      color: hex(command.ambient.color, 'ambient.color'),
    })
  }
  if (command.directional) {
    patch.directional = defined({
      intensity: intensity(command.directional.intensity, 'directional.intensity'),
      color: hex(command.directional.color, 'directional.color'),
      rotationX: rotation(command.directional.rotationX, 'directional.rotationX'),
      rotationY: rotation(command.directional.rotationY, 'directional.rotationY'),
    })
  }
  if (command.hemisphere) {
    patch.hemisphere = defined({
      intensity: intensity(command.hemisphere.intensity, 'hemisphere.intensity'),
      skyColor: hex(command.hemisphere.skyColor, 'hemisphere.skyColor'),
      groundColor: hex(command.hemisphere.groundColor, 'hemisphere.groundColor'),
    })
  }
  if (command.environment !== undefined) {
    if (command.environment !== 'hemisphere' && command.environment !== 'skyBox')
      throw new Error('environment must be "hemisphere" or "skyBox".')
    patch.environment = command.environment
  }
  if (command.skyBoxIntensity !== undefined)
    patch.skyBoxIntensity = clamp(command.skyBoxIntensity, 0, 1, 'skyBoxIntensity')
  if (command.exposure !== undefined)
    patch.exposure = clamp(command.exposure, 0.1, 5, 'exposure')

  return defined(patch)
}

function applyLight(command: Extract<StageModelCommand, { action: 'light' }>, runtime: StageCommandRuntime): StageLighting {
  if (runtime.renderer === 'live2d')
    throw new Error('The Live2D model has no scene lighting. Switch to a VRM model.')
  if (runtime.renderer !== 'vrm')
    throw new Error(unsupported('Light', runtime.renderer))

  const patch = normalizeLightingPatch(command)
  if (patch)
    runtime.setVrmLighting(patch)
  return normalizeLighting(runtime.getVrmLighting())
}

/** Reads the current model type and its Live2D motion groups. */
export function readStageState(runtime: StageCommandRuntime): StageState {
  const counts = new Map<string, number>()
  if (runtime.renderer === 'live2d') {
    for (const motion of runtime.live2dMotions.available)
      counts.set(motion.group, Math.max(counts.get(motion.group) ?? 0, motion.index + 1))
  }
  return {
    renderer: runtime.renderer ?? 'disabled',
    live2dMotionGroups: [...counts].map(([group, count]) => ({ group, count })),
    ...(runtime.renderer === 'live2d' || runtime.renderer === 'vrm' ? { view: runtime.getView() } : {}),
    ...(runtime.renderer === 'vrm' ? { lighting: normalizeLighting(runtime.getVrmLighting()) } : {}),
  }
}

/**
 * Applies one model command. Throws a clear error when the current model cannot do it.
 * Returns data for read commands such as `state`.
 */
export async function executeStageModelCommand(command: StageModelCommand, runtime: StageCommandRuntime): Promise<unknown> {
  switch (command.action) {
    case 'state':
      return readStageState(runtime)
    case 'expression':
      await applyExpression(command, runtime)
      return
    case 'motion':
      await applyMotion(command, runtime)
      return
    case 'view':
      applyView(command, runtime)
      return
    case 'model': {
      const selected = await runtime.setModel(command.modelId)
      if (!selected)
        throw new Error(`No display model has id "${command.modelId}".`)
      return
    }
    case 'light':
      return applyLight(command, runtime)
    case 'vrma':
      await applyVrma(command, runtime)
      return
    case 'speech':
      await applySpeech(command, runtime)
  }
}
