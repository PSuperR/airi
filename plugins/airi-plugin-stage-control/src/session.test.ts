import type { StageControlSocket } from './session'

import { describe, expect, it, vi } from 'vitest'

import { startStageControlSession } from './session'

class FakeSocket implements StageControlSocket {
  sent: string[] = []
  private listeners = new Map<string, Array<(event: { data?: unknown }) => void>>()

  send(data: string) {
    this.sent.push(data)
  }

  close() {
    this.emit('close', {})
  }

  addEventListener(type: 'open' | 'message' | 'close' | 'error', listener: (event: { data?: unknown }) => void) {
    const list = this.listeners.get(type) ?? []
    list.push(listener)
    this.listeners.set(type, list)
  }

  emit(type: 'open' | 'message' | 'close' | 'error', event: { data?: unknown }) {
    for (const listener of this.listeners.get(type) ?? [])
      listener(event)
  }
}

function lastMessage(socket: FakeSocket) {
  return JSON.parse(socket.sent.at(-1) ?? '{}') as {
    type?: string
    data?: Record<string, unknown>
    route?: { destinations?: string[] }
  }
}

async function flush() {
  await Promise.resolve()
  await Promise.resolve()
}

describe('startStageControlSession', () => {
  it('authenticates and returns one command result to the sender', async () => {
    const socket = new FakeSocket()
    const dispatch = vi.fn(async () => ({ ok: true }))
    const session = startStageControlSession({
      url: 'ws://127.0.0.1:6121/ws',
      token: 'secret',
      heartbeatMs: 60_000,
      dispatch,
      connect: () => socket,
    })

    socket.emit('open', {})
    expect(lastMessage(socket)).toEqual({
      type: 'module:authenticate',
      data: { token: 'secret' },
    })

    socket.emit('message', {
      data: JSON.stringify({
        json: {
          type: 'module:authenticated',
          data: { authenticated: true },
        },
      }),
    })
    await flush()

    socket.emit('message', {
      data: JSON.stringify({
        type: 'stage:control',
        data: { requestId: '1', action: 'window', visible: true },
        metadata: { sender: { peerId: 'peer-1', modules: [] } },
      }),
    })
    await vi.waitFor(() => {
      expect(dispatch).toHaveBeenCalledWith({ action: 'window', visible: true })
    })

    expect(lastMessage(socket)).toEqual({
      type: 'stage:control:result',
      data: { requestId: '1', ok: true },
      route: { destinations: ['peer:peer-1'] },
    })

    session.stop()
  })

  it('does not broadcast a result when the sender is missing', async () => {
    const socket = new FakeSocket()
    const log = vi.fn()
    const session = startStageControlSession({
      url: 'ws://127.0.0.1:6121/ws',
      token: 'secret',
      heartbeatMs: 60_000,
      dispatch: async () => ({ ok: true }),
      log,
      connect: () => socket,
    })

    socket.emit('open', {})
    socket.emit('message', {
      data: JSON.stringify({ type: 'module:authenticated', data: { authenticated: true } }),
    })
    await flush()
    const sentAfterAuth = socket.sent.length

    socket.emit('message', {
      data: JSON.stringify({
        type: 'stage:control',
        data: { action: 'model', modelId: 'preset-live2d-1' },
      }),
    })
    await flush()

    expect(log).toHaveBeenCalledWith('Stage control has no sender. The result was not sent.')
    expect(socket.sent.length).toBe(sentAfterAuth)
    session.stop()
  })

  it('stops after an invalid token and does not reconnect', async () => {
    vi.useFakeTimers()
    try {
      const sockets: FakeSocket[] = []
      const session = startStageControlSession({
        url: 'ws://127.0.0.1:6121/ws',
        token: 'wrong',
        heartbeatMs: 60_000,
        dispatch: async () => ({ ok: true }),
        connect: () => {
          const socket = new FakeSocket()
          sockets.push(socket)
          return socket
        },
      })

      const socket = sockets[0]
      if (!socket)
        throw new Error('The session did not open a socket.')
      socket.emit('open', {})
      socket.emit('message', {
        data: JSON.stringify({ type: 'error', data: { message: 'invalid token' } }),
      })
      await flush()
      await vi.advanceTimersByTimeAsync(20_000)

      expect(sockets).toHaveLength(1)
      session.stop()
    }
    finally {
      vi.useRealTimers()
    }
  })
})
