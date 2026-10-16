import { describe, expect, it } from 'vitest'

import { serverChannelClientUrl } from './endpoint'

describe('serverChannelClientUrl', () => {
  it('uses loopback when the server listens on every interface', () => {
    expect(serverChannelClientUrl({ hostname: '0.0.0.0', tls: false, port: 6121 })).toBe('ws://127.0.0.1:6121/ws')
    expect(serverChannelClientUrl({ hostname: '::', tls: true, port: 6121 })).toBe('wss://127.0.0.1:6121/ws')
  })

  it('keeps an explicit host and brackets an IPv6 address', () => {
    expect(serverChannelClientUrl({ hostname: 'localhost', tls: false, port: 6121 })).toBe('ws://localhost:6121/ws')
    expect(serverChannelClientUrl({ hostname: '::1', tls: false, port: 6121 })).toBe('ws://[::1]:6121/ws')
  })
})
