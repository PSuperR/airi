#!/usr/bin/env node
import process from 'node:process'

const args = process.argv.slice(2)

function readArg(name) {
  const index = args.indexOf(name)
  if (index === -1)
    return undefined
  return args[index + 1]
}

const url = readArg('--url') ?? process.env.STAGE_CONTROL_URL ?? 'ws://127.0.0.1:6121/ws'
const token = readArg('--token') ?? process.env.STAGE_CONTROL_TOKEN

if (!token) {
  console.error('Pass --token or set STAGE_CONTROL_TOKEN. Copy the token from Settings, Connection.')
  process.exit(1)
}

const actions = [
  { requestId: 'window', action: 'window', visible: true },
  { requestId: 'expression', action: 'expression', name: 'happy', durationMs: 3000, intensity: 1 },
  { requestId: 'motion', action: 'motion', name: 'Idle', index: 0 },
  { requestId: 'speech', action: 'speech', text: 'Hello from stage control.', speak: false },
  { requestId: 'view', action: 'view', x: 0, y: 0, scale: 1 },
  { requestId: 'model', action: 'model', modelId: 'preset-live2d-1' },
  { requestId: 'state', action: 'state' },
  { requestId: 'motion.list', action: 'motion.list' },
]

function unwrap(text) {
  const parsed = JSON.parse(text)
  if (parsed && typeof parsed === 'object' && 'json' in parsed && !('type' in parsed))
    return parsed.json
  return parsed
}

const socket = new WebSocket(url)
const pending = new Map()

socket.addEventListener('message', (event) => {
  const text = typeof event.data === 'string' ? event.data : String(event.data)
  let message
  try {
    message = unwrap(text)
  }
  catch {
    return
  }

  if (message?.type === 'transport:connection:heartbeat' && message.data?.kind === 'ping') {
    socket.send(JSON.stringify({
      type: 'transport:connection:heartbeat',
      data: { kind: 'pong', message: 'stage-control-example', at: Date.now() },
    }))
    return
  }

  if (message?.type !== 'stage:control:result')
    return

  const requestId = message.data?.requestId
  const waiter = pending.get(requestId)
  if (!waiter)
    return
  pending.delete(requestId)
  waiter(message.data)
})

function waitFor(type, timeoutMs) {
  let timer
  let onMessage
  const promise = new Promise((resolve, reject) => {
    timer = setTimeout(() => {
      socket.removeEventListener('message', onMessage)
      reject(new Error(`Timed out waiting for ${type}.`))
    }, timeoutMs)
    onMessage = (event) => {
      const text = typeof event.data === 'string' ? event.data : String(event.data)
      let message
      try {
        message = unwrap(text)
      }
      catch {
        return
      }
      if (message?.type !== type)
        return
      clearTimeout(timer)
      socket.removeEventListener('message', onMessage)
      resolve(message)
    }
    socket.addEventListener('message', onMessage)
  })
  return {
    promise,
    cancel() {
      clearTimeout(timer)
      socket.removeEventListener('message', onMessage)
    },
  }
}

try {
  const opened = new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true })
    socket.addEventListener('error', () => reject(new Error(`Cannot connect to ${url}.`)), { once: true })
  })
  const authenticated = waitFor('module:authenticated', 10000)
  const failed = waitFor('error', 10000)
  await opened
  socket.send(JSON.stringify({ type: 'module:authenticate', data: { token } }))

  const auth = await Promise.race([
    authenticated.promise.then(message => ({ ok: true, message })),
    failed.promise.then(message => ({ ok: false, message })),
  ])
  authenticated.cancel()
  failed.cancel()
  if (!auth.ok || auth.message.data?.authenticated !== true) {
    throw new Error('Authentication failed. Check the token in Settings, Connection.')
  }

  for (const action of actions) {
    const result = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`No result for ${action.requestId}.`)), 15000)
      pending.set(action.requestId, (data) => {
        clearTimeout(timer)
        resolve(data)
      })
    })
    socket.send(JSON.stringify({ type: 'stage:control', data: action }))
    const data = await result
    console.info(JSON.stringify(data))
  }
}
catch (error) {
  const message = error && typeof error === 'object' && 'message' in error && typeof error.message === 'string'
    ? error.message
    : 'Stage control example failed.'
  console.error(message)
  process.exitCode = 1
}
finally {
  socket.close()
}
