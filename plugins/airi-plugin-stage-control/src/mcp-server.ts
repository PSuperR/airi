import type { Server as HttpServer, IncomingMessage, ServerResponse } from 'node:http'

import type { StageCommandResult } from '@proj-airi/stage-shared/stage-command'

import type { StageMcpTool } from './mcp-tools'

import { Buffer } from 'node:buffer'
import { randomUUID, timingSafeEqual } from 'node:crypto'
import { createServer } from 'node:http'

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import {
  CallToolRequestSchema,
  isInitializeRequest,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
  SubscribeRequestSchema,
  UnsubscribeRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import { errorMessageFrom } from '@moeru/std'

import { buildStageTools, stageCommandTool } from './mcp-tools'

export const defaultMcpPort = 6122
export const capabilitiesResourceUri = 'airi://stage/capabilities'
export const motionLibraryResourceUri = 'airi://stage/motions'

export interface StageMcpServerOptions {
  /** TCP port. 0 picks a free port (tests). */
  port?: number
  /** Reads the current channel token for each request, so a token change in Settings applies at once. */
  readToken: () => Promise<string> | string
  /** Runs one raw `stage:control` data object in-process. */
  dispatch: (data: Record<string, unknown>) => Promise<StageCommandResult>
  /** Per-call timeout. Default 12 s. */
  timeoutMs?: number
  log?: (message: string) => void
}

export interface StageMcpServerHandle {
  readonly port: number
  readonly url: string
  /** Tells every MCP session that the motion library resource changed. */
  notifyMotionLibraryChanged: () => void
  stop: () => Promise<void>
}

const localHosts = new Set(['127.0.0.1', 'localhost', '[::1]'])

function sameSecret(a: string, b: string) {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  return left.length === right.length && timingSafeEqual(left, right)
}

/** Reads the token from `Authorization: Bearer` or `?token=`. */
export function requestToken(req: IncomingMessage): string | undefined {
  const header = req.headers.authorization
  if (header?.toLowerCase().startsWith('bearer '))
    return header.slice(7).trim()
  const url = new URL(req.url ?? '/', 'http://127.0.0.1')
  return url.searchParams.get('token') ?? undefined
}

function sendJson(res: ServerResponse, status: number, message: string) {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message }, id: null }))
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  for await (const chunk of req)
    chunks.push(chunk as Buffer)
  const text = Buffer.concat(chunks).toString('utf8')
  return text ? JSON.parse(text) : undefined
}

function resultContent(result: StageCommandResult) {
  const text = result.ok
    ? JSON.stringify(result.data ?? { ok: true }, null, 2)
    : `Error: ${result.error ?? 'The stage command failed.'}`
  return { content: [{ type: 'text' as const, text }], isError: !result.ok }
}

/** Starts the Streamable HTTP MCP server on 127.0.0.1. */
export async function startStageMcpServer(options: StageMcpServerOptions): Promise<StageMcpServerHandle> {
  const log = options.log ?? (() => {})
  const tools = buildStageTools()
  const toolMap = new Map<string, StageMcpTool>([...tools, stageCommandTool].map(tool => [tool.name, tool]))
  const timeoutMs = options.timeoutMs ?? 12_000
  const run = (data: Record<string, unknown>) => new Promise<StageCommandResult>((resolve) => {
    const timer = setTimeout(resolve, timeoutMs, { ok: false, error: `No reply from the stage within ${timeoutMs} ms for "${String(data.action)}". Is the main window open?` })
    options.dispatch(data).then(resolve, (error: unknown) => resolve({ ok: false, error: errorMessageFrom(error) ?? 'The stage command failed.' })).finally(() => clearTimeout(timer))
  })
  const sessions = new Map<string, { server: Server, transport: StreamableHTTPServerTransport }>()

  function createMcp() {
    const server = new Server(
      { name: 'airi-stage-control', version: '1.0.0' },
      { capabilities: { tools: { listChanged: true }, resources: { subscribe: true, listChanged: true } } },
    )
    server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [...toolMap.values()].map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
    }))
    server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const tool = toolMap.get(request.params.name)
      if (!tool)
        return resultContent({ ok: false, error: `Unknown tool ${request.params.name}.` })
      const args = (request.params.arguments ?? {}) as Record<string, unknown>
      const data = tool === stageCommandTool
        ? { ...(args.data as Record<string, unknown> | undefined ?? {}), action: args.action }
        : { ...args, action: tool.action }
      return resultContent(await run(data))
    })
    server.setRequestHandler(ListResourcesRequestSchema, async () => ({
      resources: [
        { uri: capabilitiesResourceUri, name: 'Stage capabilities and snapshot / 舞台能力与快照', mimeType: 'application/json' },
        { uri: motionLibraryResourceUri, name: 'Motion library / 动作库', mimeType: 'application/json' },
      ],
    }))
    server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      const uri = request.params.uri
      const action = uri === capabilitiesResourceUri ? 'capabilities' : uri === motionLibraryResourceUri ? 'motion.list' : undefined
      if (!action)
        throw new Error(`Unknown resource ${uri}.`)
      const result = await run(action === 'motion.list' ? { action, all: true } : { action })
      return { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(result, null, 2) }] }
    })
    server.setRequestHandler(SubscribeRequestSchema, async () => ({}))
    server.setRequestHandler(UnsubscribeRequestSchema, async () => ({}))
    return server
  }

  async function handle(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    const host = (req.headers.host ?? '').replace(/:\d+$/, '')
    // NOTICE: Rejects DNS rebinding. Only loopback Host headers reach the stage.
    if (!localHosts.has(host))
      return sendJson(res, 403, 'Only localhost may use the AIRI MCP server.')
    if (url.pathname !== '/mcp')
      return sendJson(res, 404, 'Use /mcp.')

    const expected = await options.readToken()
    const given = requestToken(req)
    if (!expected || !given || !sameSecret(given, expected))
      return sendJson(res, 401, 'Missing or wrong token. Send Authorization: Bearer <token> or ?token=<token> (Settings, Connection).')

    const sessionId = req.headers['mcp-session-id']
    const existing = typeof sessionId === 'string' ? sessions.get(sessionId) : undefined
    if (req.method !== 'POST') {
      if (!existing)
        return sendJson(res, 400, 'Unknown or missing mcp-session-id.')
      return existing.transport.handleRequest(req, res)
    }

    const body = await readBody(req).catch(() => Symbol('invalid'))
    if (typeof body === 'symbol')
      return sendJson(res, 400, 'The request body is not JSON.')
    if (existing)
      return existing.transport.handleRequest(req, res, body)
    if (sessionId)
      return sendJson(res, 404, 'The MCP session expired. Reinitialize.')
    if (!isInitializeRequest(body))
      return sendJson(res, 400, 'Start with an initialize request.')

    const server = createMcp()
    const transport: StreamableHTTPServerTransport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (id) => {
        sessions.set(id, { server, transport })
      },
    })
    transport.onclose = () => {
      if (transport.sessionId)
        sessions.delete(transport.sessionId)
    }
    await server.connect(transport)
    await transport.handleRequest(req, res, body)
  }

  const http: HttpServer = createServer((req, res) => {
    handle(req, res).catch((error: unknown) => {
      log(`MCP request failed. ${errorMessageFrom(error) ?? ''}`.trim())
      if (!res.headersSent)
        sendJson(res, 500, errorMessageFrom(error) ?? 'Internal error.')
    })
  })

  await new Promise<void>((resolve, reject) => {
    http.once('error', reject)
    http.listen(options.port ?? defaultMcpPort, '127.0.0.1', () => {
      http.off('error', reject)
      resolve()
    })
  })
  const address = http.address()
  const port = typeof address === 'object' && address ? address.port : (options.port ?? defaultMcpPort)

  return {
    port,
    url: `http://127.0.0.1:${port}/mcp`,
    notifyMotionLibraryChanged() {
      for (const { server } of sessions.values()) {
        server.sendResourceUpdated({ uri: motionLibraryResourceUri }).catch(() => {})
        server.sendResourceUpdated({ uri: capabilitiesResourceUri }).catch(() => {})
        server.sendResourceListChanged().catch(() => {})
      }
    },
    async stop() {
      for (const { transport } of sessions.values())
        await transport.close().catch(() => {})
      sessions.clear()
      http.closeAllConnections?.()
      await new Promise<void>(resolve => http.close(() => resolve()))
    },
  }
}
