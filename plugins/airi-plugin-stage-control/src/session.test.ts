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

  it('returns result data and broadcasts library events after auth', async () => {
    const socket = new FakeSocket()
    const session = startStageControlSession({
      url: 'ws://127.0.0.1:6121/ws',
      token: 'secret',
      heartbeatMs: 60_000,
      dispatch: async () => ({ ok: true, data: { motions: [] } }),
      connect: () => socket,
    })

    expect(session.broadcast({ event: 'motion.library.changed' })).toBe(false)
    socket.emit('open', {})
    socket.emit('message', { data: JSON.stringify({ type: 'module:authenticated', data: { authenticated: true } }) })
    await flush()

    socket.emit('message', {
      data: JSON.stringify({
        type: 'stage:control',
        data: { requestId: 'm', action: 'motion.list' },
        metadata: { sender: { peerId: 'peer-1' } },
      }),
    })
    await vi.waitFor(() => {
      expect(lastMessage(socket)).toEqual({
        type: 'stage:control:result',
        data: { requestId: 'm', ok: true, data: { motions: [] } },
        route: { destinations: ['peer:peer-1'] },
      })
    })

    expect(session.broadcast({ event: 'motion.library.changed', motions: [] })).toBe(true)
    expect(lastMessage(socket)).toEqual({
      type: 'stage:control:event',
      data: { event: 'motion.library.changed', motions: [] },
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
  it('answers with an error when the stage never answers', async () => {
    vi.useFakeTimers()
    try {
      const socket = new FakeSocket()
      const session = startStageControlSession({
        url: 'ws://127.0.0.1:6121/ws',
        token: 'secret',
        heartbeatMs: 60_000,
        dispatchTimeoutMs: 5000,
        dispatch: () => new Promise(() => {}),
        connect: () => socket,
      })
      socket.emit('open', {})
      socket.emit('message', { data: JSON.stringify({ type: 'module:authenticated', data: { authenticated: true } }) })
      await flush()
      socket.emit('message', {
        data: JSON.stringify({
          type: 'stage:control',
          data: { requestId: 'v1', action: 'vrma', src: 'https://example.com/a.vrma' },
          metadata: { sender: { peerId: 'peer-1', modules: [] } },
        }),
      })
      await vi.advanceTimersByTimeAsync(5001)
      expect(lastMessage(socket)).toEqual({
        type: 'stage:control:result',
        data: { requestId: 'v1', ok: false, error: 'The stage did not answer the vrma action within 5000 ms.' },
        route: { destinations: ['peer:peer-1'] },
      })
      session.stop()
    }
    finally {
      vi.useRealTimers()
    }
  })

  it('reads the token again after the server rejects it', async () => {
    vi.useFakeTimers()
    try {
      const sockets: FakeSocket[] = []
      let token = 'old'
      const session = startStageControlSession({
        url: 'ws://127.0.0.1:6121/ws',
        token: 'old',
        heartbeatMs: 60_000,
        readEndpoint: async () => ({ url: 'ws://127.0.0.1:6121/ws', token }),
        dispatch: async () => ({ ok: true }),
        connect: () => {
          const socket = new FakeSocket()
          sockets.push(socket)
          return socket
        },
      })
      await flush()
      sockets[0]!.emit('open', {})
      token = 'new'
      sockets[0]!.emit('message', { data: JSON.stringify({ type: 'error', data: { message: 'invalid token' } }) })
      await flush()
      await vi.advanceTimersByTimeAsync(1100)
      expect(sockets).toHaveLength(2)
      sockets[1]!.emit('open', {})
      expect(lastMessage(sockets[1]!)).toEqual({ type: 'module:authenticate', data: { token: 'new' } })
      session.stop()
    }
    finally {
      vi.useRealTimers()
    }
  })
})
