import type { AudioPlayback, PlaybackClip, TtsRequest } from '@proj-airi/pipelines-audio'
import type { CaptionChannelEvent } from '@proj-airi/stage-shared'
import type { Live2DContext } from '@proj-airi/stage-ui-live2d'
import type { MaybeRefOrGetter } from 'vue'

import type { StageControlScene } from '../libs/stage-control'

import { errorMessageFrom } from '@moeru/std'
import { useL2dViewControl } from '@proj-airi/stage-ui-live2d/stores'
import { useThreeViewControl } from '@proj-airi/stage-ui-three'
import { useBroadcastChannel } from '@vueuse/core'
import { nanoid } from 'nanoid'
import { storeToRefs } from 'pinia'
import { onScopeDispose, toValue, watch } from 'vue'

import { runStageControl } from '../libs/stage-control'
import { useDisplayModelsStore } from '../stores/display-models'
import { useModsServerChannelStore } from '../stores/mods/api/channel-server'
import { useAiriCardStore } from '../stores/modules/airi-card'
import { useSpeechStore } from '../stores/modules/speech'
import { useSettingsStageModel } from '../stores/settings/stage-model'
import { useSpeechOutputControlStore } from '../stores/speech-output-control'

/** How long one speech request can run before the stage reports failure. */
const speechTimeoutMs = 60_000

/**
 * Applies authenticated `stage:control` events to this stage.
 *
 * Call this from the window that owns the character. Other windows ignore the event.
 * The listener starts after the channel connection is up, so it does not open a second connection.
 */
export function useStageExternalControl(options: {
  enabled: MaybeRefOrGetter<boolean>
  live2d: Live2DContext
  setVrmExpression: (name: string, intensity: number) => void
  playback: AudioPlayback
  audioContext: AudioContext
  setWindowVisible?: (visible: boolean) => void | Promise<void>
  onSpeechStart?: () => void
  onSpeechEnd?: () => void
}) {
  const serverChannel = useModsServerChannelStore()
  const { connected } = storeToRefs(serverChannel)
  const stageModel = useSettingsStageModel()
  const { stageModelRenderer } = storeToRefs(stageModel)
  const displayModels = useDisplayModelsStore()
  const cards = useAiriCardStore()
  const speechStore = useSpeechStore()
  const { speechMuted } = storeToRefs(useSpeechOutputControlStore())
  const live2dView = useL2dViewControl()
  const vrmView = useThreeViewControl()
  const { post: postCaption } = useBroadcastChannel<CaptionChannelEvent, CaptionChannelEvent>({ name: 'airi-caption-overlay' })
  let stopListener: (() => void) | undefined

  function showCaption(text: string) {
    postCaption({ type: 'caption-assistant', operation: 'replace', text })
  }

  async function playAudio(audio: PlaybackClip['audio']) {
    const group = options.playback.openGroup('stage-control')
    let started = false
    try {
      const status = await group.enqueue({
        id: nanoid(),
        audio,
        onStart: () => {
          started = true
          options.onSpeechStart?.()
        },
      })
      if (status === 'failed')
        throw new Error('Speech playback failed.')
    }
    finally {
      if (started)
        options.onSpeechEnd?.()
      await group.finish()
    }
  }

  async function speak(text: string) {
    if (speechMuted.value)
      throw new Error('Speech is muted. The caption is visible.')

    try {
      const selection = cards.getModules(cards.activeCardId).speech
      if (!selection.provider || selection.provider === 'speech-noop')
        throw new Error('Speech is not configured.')

      const output = speechStore.createOutput(
        { sessionId: 'stage-control', turnId: nanoid() },
        selection,
        { playback: options.playback },
        options.audioContext,
      )
      const signal = AbortSignal.timeout(speechTimeoutMs)
      if ('synthesize' in output) {
        const audio = await output.synthesize(speechRequest(text), signal)
        if (!audio)
          throw new Error('Speech returned no audio.')
        await playAudio(audio)
        return
      }

      const textStream = new ReadableStream<string>({
        start(controller) {
          controller.enqueue(text)
          controller.close()
        },
      })
      const audioStream = await output.stream(textStream, signal)
      const reader = audioStream.getReader()
      let played = false
      while (true) {
        const next = await reader.read()
        if (next.done)
          break
        if (!next.value)
          continue
        played = true
        await playAudio(next.value.audio)
      }
      if (!played)
        throw new Error('Speech returned no audio.')
    }
    catch (error) {
      const message = errorMessageFrom(error) ?? 'Speech failed.'
      if (message.includes('The caption is visible.'))
        throw error
      throw new Error(`${message} The caption is visible.`)
    }
  }

  function createScene(): StageControlScene {
    return {
      renderer: stageModelRenderer.value,
      setLive2dExpression: (name, duration) => options.live2d.expressions.execute({ name, duration }),
      setVrmExpression: options.setVrmExpression,
      resolveLive2dMotionFile: (group, index) => {
        return options.live2d.motions.available.value.find(motion => motion.group === group && motion.index === index)?.fileName
      },
      playLive2dMotion: file => options.live2d.motions.execute(file),
      setLive2dView: (key, value) => {
        live2dView.set(key, value)
      },
      setVrmView: (key, value) => {
        vrmView.set(key, value)
      },
      showCaption,
      speak,
      setModel: async (modelId) => {
        const model = await displayModels.getDisplayModel(modelId)
        if (!model)
          throw new Error(`Display model "${modelId}" was not found.`)
        stageModel.stageModelSelected = modelId
      },
      setWindowVisible: options.setWindowVisible,
    }
  }

  async function onStageControl(event: { data: unknown, metadata?: { event?: { id?: string }, sender?: { peerId?: string } } }) {
    const result = await runStageControl(event.data, createScene())
    if (!result.ok)
      console.error('[stage-control]', result.error)

    const senderPeerId = event.metadata?.sender?.peerId
    const parentId = event.metadata?.event?.id
    serverChannel.send({
      type: 'stage:control:result',
      data: result,
      metadata: parentId ? { event: { parentId } } : undefined,
      route: senderPeerId ? { destinations: [`peer:${senderPeerId}`] } : undefined,
    })
  }

  function syncListener() {
    if (!toValue(options.enabled)) {
      stopListener?.()
      stopListener = undefined
      return
    }

    // Wait for the app connection. Subscribing earlier opens a second connection without the desktop token.
    if (stopListener || !connected.value)
      return

    stopListener = serverChannel.onEvent('stage:control', onStageControl)
  }

  const stopWatch = watch([() => toValue(options.enabled), connected], syncListener, { immediate: true })

  onScopeDispose(() => {
    stopWatch()
    stopListener?.()
    stopListener = undefined
  })
}

function speechRequest(text: string): TtsRequest {
  return {
    streamId: 'stage-control',
    intentId: 'stage-control',
    segmentId: nanoid(),
    sequence: 0,
    text,
    special: null,
    reason: 'flush',
    priority: 0,
    createdAt: Date.now(),
  }
}
