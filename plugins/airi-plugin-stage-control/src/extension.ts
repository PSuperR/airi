import { defineExtension } from '@proj-airi/plugin-sdk'

import { dispatchStageControl } from './dispatch'
import { stageKit } from './kit'
import { startStageControlSession } from './session'

export const stageControlExtension = defineExtension({
  id: 'airi-plugin-stage-control',
  async setup(ctx) {
    const stage = await ctx.kits.use(stageKit)
    const endpoint = await stage.readChannel()
    const session = startStageControlSession({
      url: endpoint.url,
      token: endpoint.token,
      dispatch: command => dispatchStageControl(command, stage),
      log: message => console.error(`[stage-control] ${message}`),
    })
    ctx.subscriptions.add({
      dispose: () => {
        session.stop()
      },
    })
  },
})
