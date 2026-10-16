import { errorMessageFrom } from '@moeru/std'
import { defineExtension } from '@proj-airi/plugin-sdk'

import { dispatchStageControl } from './dispatch'
import { stageKit } from './kit'
import { MotionLibrary } from './motion-library'
import { defaultMotionDirectory, readMotionDirectory, saveMotionDirectory } from './motion-settings'
import { startStageControlSession } from './session'

export const stageControlExtension = defineExtension({
  id: 'airi-plugin-stage-control',
  async setup(ctx) {
    const log = (message: string) => console.error(`[stage-control] ${message}`)
    const stage = await ctx.kits.use(stageKit)
    const endpoint = await stage.readChannel()
    const userDataPath = await stage.readUserDataPath?.().catch(() => undefined)

    const library = new MotionLibrary({ directory: await readMotionDirectory(userDataPath), log })
    await library.start().catch((error: unknown) => {
      log(`Could not open the motion folder ${library.directory}. ${errorMessageFrom(error) ?? ''}`.trim())
    })

    const session = startStageControlSession({
      url: endpoint.url,
      token: endpoint.token,
      readEndpoint: () => stage.readChannel(),
      dispatch: command => dispatchStageControl(command, stage, {
        library,
        setDirectory: async (directory) => {
          await library.setDirectory(directory ?? defaultMotionDirectory(userDataPath))
          await saveMotionDirectory(userDataPath, directory)
        },
      }),
      log,
    })

    const stopListening = library.onChange((motions) => {
      session.broadcast({ event: 'motion.library.changed', directory: library.directory, motions })
    })

    log(`Started. Channel ${endpoint.url}. Motion folder ${library.directory}.`)
    ctx.subscriptions.add({
      dispose: () => {
        stopListening()
        library.stop()
        session.stop()
      },
    })
  },
})
