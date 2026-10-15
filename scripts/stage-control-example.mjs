// Sends one example of each stage:control action.
// Edit the names below to match the loaded model.
// AIRI_WS_URL defaults to ws://127.0.0.1:6121/ws.
// AIRI_TOKEN defaults to an empty token.
// AIRI_STAGE_HIDE=1 hides the main window after the other actions.
// The model action changes the selected model.

import process from 'node:process'

const url = process.env.AIRI_WS_URL || 'ws://127.0.0.1:6121/ws'
const token = process.env.AIRI_TOKEN || ''

const actions = [
  { id: 'expression-1', action: 'expression', name: 'happy', intensity: 1 },
  { id: 'motion-1', action: 'motion', group: 'Idle', index: 0 },
  { id: 'caption-1', action: 'caption', text: 'Hello from stage control.', speak: false },
  { id: 'transform-1', action: 'transform', x: 0, y: 0, scale: 1 },
  { id: 'model-1', action: 'model', modelId: 'preset-live2d-1' },
  { id: 'window-show', action: 'window', visible: true },
]

if (process.env.AIRI_STAGE_HIDE === '1') {
  actions.push({ id: 'window-hide', action: 'window', visible: false })
}

const queue = []
let waiter
const socket = new WebSocket(url)

socket.addEventListener('message', (event) => {
  const message = unwrap(String(event.data))
  if (!waiter) {
    queue.push(message)
    return
  }
  const current = waiter
  waiter = undefined
  current(message)
})

socket.addEventListener('error', () => {
  console.error(`WebSocket error for ${url}`)
  process.exitCode = 1
})

await onceOpen(socket)
socket.send(JSON.stringify({
  type: 'module:authenticate',
  data: { token },
}))

const authenticated = await waitFor(
  message => message?.type === 'module:authenticated' || message?.type === 'error',
  20_000,
)
if (authenticated?.type !== 'module:authenticated') {
  console.error(authenticated?.data?.message || 'Authentication failed.')
  socket.close()
  process.exit(1)
}

let failed = false
for (const action of actions) {
  socket.send(JSON.stringify({ type: 'stage:control', data: action }))
  const timeout = action.action === 'caption' && action.speak ? 70_000 : 20_000
  const result = await waitFor(
    message => message?.type === 'stage:control:result' && message.data?.id === action.id,
    timeout,
  ).catch((error) => {
    failed = true
    console.error(`${action.id} ${errorMessage(error)}`)
    return undefined
  })
  if (!result)
    continue
  if (result.data?.ok) {
    console.info(`${action.id} ok`)
  }
  else {
    failed = true
    console.error(`${action.id} ${result.data?.error || 'failed'}`)
  }
  if (action.action === 'model')
    await sleep(2_000)
}

socket.close()
if (failed)
  process.exit(1)

function unwrap(text) {
  const parsed = JSON.parse(text)
  if (parsed && typeof parsed === 'object' && parsed.json && typeof parsed.json.type === 'string')
    return parsed.json
  return parsed
}

function onceOpen(target) {
  if (target.readyState === WebSocket.OPEN)
    return Promise.resolve()
  return new Promise((resolve, reject) => {
    target.addEventListener('open', () => resolve(), { once: true })
    target.addEventListener('error', () => reject(new Error(`Cannot connect to ${url}`)), { once: true })
  })
}

function nextMessage(timeoutMs) {
  const pending = queue.shift()
  if (pending)
    return Promise.resolve(pending)
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      waiter = undefined
      reject(new Error('Timed out waiting for a message.'))
    }, timeoutMs)
    waiter = (message) => {
      clearTimeout(timer)
      resolve(message)
    }
  })
}

async function waitFor(match, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (true) {
    const remaining = deadline - Date.now()
    if (remaining <= 0)
      throw new Error('Timed out waiting for a message.')
    const message = await nextMessage(remaining)
    if (match(message))
      return message
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function errorMessage(error) {
  if (error instanceof Error)
    return error.message
  return 'Stage control failed.'
}
