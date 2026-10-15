import type { StageCommandResult, StageControlCommand } from '@proj-airi/stage-shared/stage-command'

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
  dispatch: (command: StageControlCommand) => Promise<StageCommandResult>
  connect?: (url: string) => StageControlSocket
  heartbeatMs?: number
  log?: (message: string) => void
}

interface IncomingEvent {
  type?: unknown
  data?: unknown
  metadata?: unknown
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
        fatal = true
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

    try {
      const request = parseStageControlData(event.data)
      const result = await options.dispatch(request.command)
      sendResult(current, peerId, request.requestId, result)
    }
    catch (error) {
      const message = errorMessageFrom(error) ?? 'The stage control payload is not valid.'
      sendResult(current, peerId, undefined, { ok: false, error: message })
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
    authenticated = false
    clearHeartbeat()
    const current = (options.connect ?? openSocket)(options.url)
    socket = current
    current.addEventListener('open', () => {
      if (socket !== current)
        return
      send(current, { type: 'module:authenticate', data: { token: options.token } })
    })
    current.addEventListener('message', (event) => {
      if (socket !== current)
        return
      void handleMessage(current, event.data)
    })
    current.addEventListener('close', () => {
      if (socket !== current)
        return
      clearHeartbeat()
      socket = undefined
      scheduleReconnect()
    })
  }

  connect()

  return {
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
