import { isIP } from 'node:net'

/** Builds the loopback WebSocket URL that a local client uses. */
export function serverChannelClientUrl(input: { hostname: string, tls: boolean, port: number }) {
  const hostname = input.hostname === '0.0.0.0' || input.hostname === '::' ? '127.0.0.1' : input.hostname
  const protocol = input.tls ? 'wss' : 'ws'
  const host = isIP(hostname) === 6 ? `[${hostname}]` : hostname
  return `${protocol}://${host}:${input.port}/ws`
}
