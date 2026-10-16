import type { StageMcpServerHandle } from './mcp-server'

import { request } from 'node:http'

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { capabilitiesResourceUri, startStageMcpServer } from './mcp-server'

let handle: StageMcpServerHandle | undefined

afterEach(async () => {
  await handle?.stop()
  handle = undefined
})

async function connect(url: string, token?: string) {
  const client = new Client({ name: 'test', version: '1.0.0' })
  const transport = new StreamableHTTPClientTransport(new URL(url), {
    requestInit: token ? { headers: { Authorization: `Bearer ${token}` } } : undefined,
  })
  await client.connect(transport)
  return client
}

describe('stage mcp server', () => {
  it('rejects a missing or wrong token', async () => {
    handle = await startStageMcpServer({ port: 0, readToken: () => 'secret', dispatch: async () => ({ ok: true }) })
    await expect(connect(handle.url)).rejects.toThrow()
    await expect(connect(handle.url, 'nope')).rejects.toThrow()
  })

  it('accepts ?token= and lists generated tools', async () => {
    handle = await startStageMcpServer({ port: 0, readToken: () => 'secret', dispatch: async () => ({ ok: true }) })
    const client = await connect(`${handle.url}?token=secret`)
    const { tools } = await client.listTools()
    const names = tools.map(tool => tool.name)
    expect(names).toEqual(expect.arrayContaining(['stage_capabilities', 'stage_light', 'motion_play', 'stage_command']))
    expect(tools.find(tool => tool.name === 'stage_expression')?.inputSchema.required).toContain('name')
    await client.close()
  })

  it('calls the in-process dispatch', async () => {
    const dispatch = vi.fn(async () => ({ ok: true, data: { done: true } }))
    handle = await startStageMcpServer({ port: 0, readToken: () => 'secret', dispatch })
    const client = await connect(handle.url, 'secret')
    const result = await client.callTool({ name: 'stage_light', arguments: { exposure: 1.2 } })
    expect(dispatch).toHaveBeenCalledWith({ action: 'light', exposure: 1.2 })
    expect(result.isError).toBe(false)
    await client.callTool({ name: 'stage_command', arguments: { action: 'motion.play', data: { name: 'wave' } } })
    expect(dispatch).toHaveBeenLastCalledWith({ action: 'motion.play', name: 'wave' })
    const resource = await client.readResource({ uri: capabilitiesResourceUri })
    expect(resource.contents[0]).toMatchObject({ uri: capabilitiesResourceUri })
    await client.close()
  })

  it('times out a stuck command with a clear error', async () => {
    handle = await startStageMcpServer({ port: 0, readToken: () => 'secret', timeoutMs: 50, dispatch: () => new Promise(() => {}) })
    const client = await connect(handle.url, 'secret')
    const result = await client.callTool({ name: 'stage_state', arguments: {} })
    expect(result.isError).toBe(true)
    expect(JSON.stringify(result.content)).toMatch(/No reply from the stage/)
    await client.close()
  })

  it('rejects a non-localhost Host header', async () => {
    handle = await startStageMcpServer({ port: 0, readToken: () => 'secret', dispatch: async () => ({ ok: true }) })
    const status = await new Promise<number | undefined>((resolve, reject) => {
      const req = request(handle!.url, { method: 'POST', headers: { Host: 'evil.example', Authorization: 'Bearer secret' } }, (res) => {
        res.resume()
        resolve(res.statusCode)
      })
      req.on('error', reject)
      req.end('{}')
    })
    expect(status).toBe(403)
  })
})
