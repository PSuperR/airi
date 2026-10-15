import type { StageModelCommand } from '@proj-airi/stage-shared/stage-command'

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
  setLive2dView: (key: 'x' | 'y' | 'scale', value: number) => void
  setVrmView: (key: 'x' | 'y' | 'z' | 'cameraDistance', value: number) => void
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

/** Applies one model command. Throws a clear error when the current model cannot do it. */
export async function executeStageModelCommand(command: StageModelCommand, runtime: StageCommandRuntime): Promise<void> {
  switch (command.action) {
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
    case 'speech':
      await applySpeech(command, runtime)
  }
}
