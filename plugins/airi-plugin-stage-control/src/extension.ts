import process from 'node:process'

import { errorMessageFrom } from '@moeru/std'
import { defineExtension } from '@proj-airi/plugin-sdk'

import { dispatchStageControl } from './dispatch'
import { stageKit } from './kit'
import { defaultMcpPort, startStageMcpServer } from './mcp-server'
import { MotionLibrary } from './motion-library'
import { defaultMotionDirectory, readMotionDirectory, saveMotionDirectory } from './motion-settings'
import { parseStageControlData } from './protocol'
import { startStageControlSession } from './session'

/** MCP port from AIRI_STAGE_MCP_PORT (default 6122). AIRI_STAGE_MCP=off disables it. */
function readMcpPort() {
  if (['off', '0', 'false'].includes((process.env.AIRI_STAGE_MCP ?? '').toLowerCase()))
    return undefined
  const value = process.env.AIRI_STAGE_MCP_PORT
  const port = value ? Number.parseInt(value, 10) : defaultMcpPort
  return Number.isInteger(port) && port > 0 && port < 65536 ? port : defaultMcpPort
}

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

    const motionContext = {
      library,
      setDirectory: async (directory?: string) => {
        await library.setDirectory(directory ?? defaultMotionDirectory(userDataPath))
        await saveMotionDirectory(userDataPath, directory)
      },
    }
    const session = startStageControlSession({
      url: endpoint.url,
      token: endpoint.token,
      readEndpoint: () => stage.readChannel(),
      dispatch: command => dispatchStageControl(command, stage, motionContext),
      log,
    })

    // MCP over Streamable HTTP on 127.0.0.1. Same token, same dispatch, no WebSocket hop.
    const mcpPort = readMcpPort()
    const mcp = mcpPort === undefined
      ? undefined
      : await startStageMcpServer({
          port: mcpPort,
          readToken: async () => (await stage.readChannel()).token,
          dispatch: async (data) => {
            let command
            try {
              command = parseStageControlData(data).command
            }
            catch (error) {
              return { ok: false, error: errorMessageFrom(error) ?? 'The stage control payload is not valid.' }
            }
            return dispatchStageControl(command, stage, motionContext)
          },
          log,
        }).catch((error: unknown) => {
          log(`MCP server did not start (port ${mcpPort}). ${errorMessageFrom(error) ?? ''}`.trim())
          return undefined
        })
    if (mcp)
      log(`MCP server at ${mcp.url}.`)

    const stopListening = library.onChange((motions) => {
      session.broadcast({ event: 'motion.library.changed', directory: library.directory, motions })
      mcp?.notifyMotionLibraryChanged()
    })

    log(`Started. Channel ${endpoint.url}. Motion folder ${library.directory}.`)
    ctx.subscriptions.add({
      dispose: () => {
        stopListening()
        library.stop()
        session.stop()
        void mcp?.stop()
      },
    })
  },
})
