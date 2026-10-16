import type { StageCommandResult } from '@proj-airi/stage-shared/stage-command'

import type { PluginControlCommand } from './protocol'

import { errorMessageFrom } from '@moeru/std'

import { parseStageControlData } from './protocol'

const reconnectDelaysMs = [1000, 2000, 4000, 8000, 15000]
const invalidTokenMessage = 'invalid token'

/** A socket that can send text and report open, message, close, and error. */
export interface StageControlSocket {
  send: (data: string) => void
  close: () => void
  addEventListener: (type: 'open' | 'message' | 'close' | 'error', listener: (event: { data?: unknown }) => void) => void
}

/** Starts one authenticated stage control session. */
export interface StageControlSessionOptions {
  url: string
  token: string
  dispatch: (command: PluginControlCommand) => Promise<StageCommandResult>
  /**
   * Reads the current channel address and token before each connect.
   * Use it so a token change in Settings, Connection, does not lock the plugin out.
   */
  readEndpoint?: () => Promise<{ url: string, token: string }>
  /** Longest time one command may run before the plugin answers with an error. Default 10 s. */
  dispatchTimeoutMs?: number
  connect?: (url: string) => StageControlSocket
  heartbeatMs?: number
  log?: (message: string) => void
}

interface IncomingEvent {
  type?: unknown
  data?: unknown
  metadata?: unknown
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms)
    unrefTimer(timer)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error: unknown) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}

function unrefTimer(timer: unknown) {
  if (timer && typeof timer === 'object' && 'unref' in timer && typeof timer.unref === 'function')
    timer.unref()
}

function parseIncoming(text: string): unknown {
  const parsed: unknown = JSON.parse(text)
  if (parsed && typeof parsed === 'object' && 'json' in parsed && !('type' in parsed))
    return parsed.json
  return parsed
}

async function textFrom(data: unknown) {
  if (typeof data === 'string')
    return data
  if (data instanceof ArrayBuffer)
    return new TextDecoder().decode(data)
  if (ArrayBuffer.isView(data))
    return new TextDecoder().decode(data)
  if (data && typeof data === 'object' && 'text' in data && typeof data.text === 'function')
    return String(await data.text())
  return String(data)
}

function asEvent(value: unknown): IncomingEvent | undefined {
  if (!value || typeof value !== 'object')
    return undefined
  return value
}

function senderPeerId(event: IncomingEvent) {
  if (!event.metadata || typeof event.metadata !== 'object')
    return undefined
  if (!('sender' in event.metadata))
    return undefined
  const sender = event.metadata.sender
  if (!sender || typeof sender !== 'object' || !('peerId' in sender))
    return undefined
  return typeof sender.peerId === 'string' && sender.peerId.length > 0 ? sender.peerId : undefined
}

function openSocket(url: string): StageControlSocket {
  const socket = new WebSocket(url)
  return {
    send: data => socket.send(data),
    close: () => socket.close(),
    addEventListener: (type, listener) => {
      socket.addEventListener(type, (event) => {
        listener({ data: 'data' in event ? event.data : undefined })
      })
    },
  }
}

/**
 * Connects to the server channel, authenticates, and answers `stage:control`.
 *
 * Call `stop` to close the socket and cancel reconnect.
 */
export function startStageControlSession(options: StageControlSessionOptions) {
  const heartbeatMs = options.heartbeatMs ?? 20_000
  const log = options.log ?? (() => {})
  const dispatchTimeoutMs = options.dispatchTimeoutMs ?? 10_000
  let endpoint = { url: options.url, token: options.token }
  let stopped = false
  let fatal = false
  let authenticated = false
  let reconnectAttempt = 0
  let socket: StageControlSocket | undefined
  let heartbeat: ReturnType<typeof setInterval> | undefined
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined

  function clearHeartbeat() {
    if (heartbeat === undefined)
      return
    clearInterval(heartbeat)
    heartbeat = undefined
  }

  function send(current: StageControlSocket, message: unknown) {
    current.send(JSON.stringify(message))
  }

  function sendResult(current: StageControlSocket, peerId: string, requestId: string | undefined, result: StageCommandResult) {
    send(current, {
      type: 'stage:control:result',
      data: {
        ...(requestId === undefined ? {} : { requestId }),
        ok: result.ok,
        ...(result.error === undefined ? {} : { error: result.error }),
        ...(result.data === undefined ? {} : { data: result.data }),
      },
      route: {
        destinations: [`peer:${peerId}`],
      },
    })
  }

  function startHeartbeat(current: StageControlSocket) {
    clearHeartbeat()
    const sendPing = () => {
      send(current, {
        type: 'transport:connection:heartbeat',
        data: { kind: 'ping', message: 'stage-control', at: Date.now() },
      })
    }
    sendPing()
    heartbeat = setInterval(sendPing, heartbeatMs)
    unrefTimer(heartbeat)
  }

  async function handleMessage(current: StageControlSocket, data: unknown) {
    let event: IncomingEvent | undefined
    try {
      event = asEvent(parseIncoming(await textFrom(data)))
    }
    catch (error) {
      log(`Ignored one channel frame. ${errorMessageFrom(error) ?? 'The frame is not JSON.'}`)
      return
    }
    if (!event || typeof event.type !== 'string')
      return

    if (event.type === 'module:authenticated') {
      const body = event.data
      if (body && typeof body === 'object' && 'authenticated' in body && body.authenticated === true) {
        authenticated = true
        reconnectAttempt = 0
        startHeartbeat(current)
      }
      return
    }

    if (event.type === 'error' && !authenticated) {
      const body = event.data
      const message = body && typeof body === 'object' && 'message' in body && typeof body.message === 'string'
        ? body.message
        : 'Authentication failed.'
      if (message === invalidTokenMessage) {
        // With readEndpoint, the next connect reads the new token, so keep retrying.
        fatal = !options.readEndpoint
        log('Stage control authentication failed. Check the token in Settings, Connection.')
        current.close()
      }
      return
    }

    if (event.type === 'transport:connection:heartbeat') {
      const body = event.data
      if (body && typeof body === 'object' && 'kind' in body && body.kind === 'ping') {
        send(current, {
          type: 'transport:connection:heartbeat',
          data: { kind: 'pong', message: 'stage-control', at: Date.now() },
        })
      }
      return
    }

    if (event.type !== 'stage:control' || !authenticated)
      return

    const peerId = senderPeerId(event)
    if (!peerId) {
      log('Stage control has no sender. The result was not sent.')
      return
    }

    // Keep the request id on every error, so the client can match the reply.
    const rawRequestId = event.data && typeof event.data === 'object' && 'requestId' in event.data && typeof event.data.requestId === 'string'
      ? event.data.requestId
      : undefined
    try {
      const request = parseStageControlData(event.data)
      log(`Running ${request.command.action}${request.requestId === undefined ? '' : ` (${request.requestId})`}.`)
      const result = await withTimeout(
        options.dispatch(request.command),
        dispatchTimeoutMs,
        `The stage did not answer the ${request.command.action} action within ${dispatchTimeoutMs} ms.`,
      )
      sendResult(current, peerId, request.requestId, result)
    }
    catch (error) {
      const message = errorMessageFrom(error) ?? 'The stage control payload is not valid.'
      sendResult(current, peerId, rawRequestId, { ok: false, error: message })
    }
  }

  function scheduleReconnect() {
    if (stopped || fatal)
      return
    const delay = reconnectDelaysMs[Math.min(reconnectAttempt, reconnectDelaysMs.length - 1)] ?? 15000
    reconnectAttempt += 1
    reconnectTimer = setTimeout(connect, delay)
    unrefTimer(reconnectTimer)
  }

  function connect() {
    if (stopped || fatal)
      return
    if (!options.readEndpoint) {
      open()
      return
    }
    options.readEndpoint().then(
      (next) => {
        endpoint = next
        open()
      },
      (error: unknown) => {
        log(`Could not read the channel address. ${errorMessageFrom(error) ?? ''}`.trim())
        open()
      },
    )
  }

  function open() {
    if (stopped || fatal)
      return
    authenticated = false
    clearHeartbeat()
    let current: StageControlSocket
    try {
      current = (options.connect ?? openSocket)(endpoint.url)
    }
    catch (error) {
      log(`Could not open ${endpoint.url}. ${errorMessageFrom(error) ?? ''}`.trim())
      scheduleReconnect()
      return
    }
    socket = current
    current.addEventListener('open', () => {
      if (socket !== current)
        return
      send(current, { type: 'module:authenticate', data: { token: endpoint.token } })
    })
    current.addEventListener('message', (event) => {
      if (socket !== current)
        return
      void handleMessage(current, event.data)
    })
    current.addEventListener('close', () => {
      if (socket !== current)
        return
      log('Channel connection closed. Reconnecting.')
      clearHeartbeat()
      socket = undefined
      scheduleReconnect()
    })
  }

  connect()

  return {
    /**
     * Sends one `stage:control:event` to every peer on the channel.
     * Returns false when the session is not connected.
     */
    broadcast(data: unknown) {
      if (!socket || !authenticated)
        return false
      try {
        send(socket, { type: 'stage:control:event', data })
        return true
      }
      catch {
        return false
      }
    },
    stop() {
      stopped = true
      if (reconnectTimer !== undefined)
        clearTimeout(reconnectTimer)
      clearHeartbeat()
      socket?.close()
      socket = undefined
    },
  }
}
