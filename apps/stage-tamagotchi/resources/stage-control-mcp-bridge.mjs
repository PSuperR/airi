#!/usr/bin/env node
// AIRI stage-control MCP stdio bridge. No dependencies; Node 18+.
// Forwards newline-delimited JSON-RPC from stdin to AIRI's Streamable HTTP MCP
// endpoint and writes replies to stdout. Config: AIRI_STAGE_MCP_URL
// (default http://127.0.0.1:6122/mcp) and AIRI_STAGE_TOKEN, or --url / --token.
import process from 'node:process'

import { createInterface } from 'node:readline'

const args = process.argv.slice(2)
function arg(name) {
  const index = args.indexOf(name)
  return index === -1 ? undefined : args[index + 1]
}
const url = arg('--url') ?? process.env.AIRI_STAGE_MCP_URL ?? 'http://127.0.0.1:6122/mcp'
const token = arg('--token') ?? process.env.AIRI_STAGE_TOKEN ?? ''
const timeoutMs = 15000
let sessionId

const write = message => process.stdout.write(`${JSON.stringify(message)}\n`)
const fail = (id, message) => id !== undefined && write({ jsonrpc: '2.0', id, error: { code: -32000, message } })

async function forward(message) {
  const headers = { 'content-type': 'application/json', 'accept': 'application/json, text/event-stream' }
  if (token)
    headers.authorization = `Bearer ${token}`
  if (sessionId)
    headers['mcp-session-id'] = sessionId
  let response
  try {
    response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(message), signal: AbortSignal.timeout(timeoutMs) })
  }
  catch (error) {
    return fail(message.id, `Cannot reach AIRI MCP at ${url}. Is AIRI running? (${error?.message ?? error})`)
  }
  sessionId = response.headers.get('mcp-session-id') ?? sessionId
  if (response.status === 202)
    return
  const text = await response.text()
  if (!response.ok) {
    let detail = text
    try {
      detail = JSON.parse(text).error?.message ?? text
    }
    catch {}
    if (response.status === 404 && sessionId)
      sessionId = undefined
    return fail(message.id, `AIRI MCP HTTP ${response.status}: ${detail}`)
  }
  if ((response.headers.get('content-type') ?? '').includes('text/event-stream')) {
    for (const block of text.split(/\r?\n\r?\n/)) {
      const data = block.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n')
      if (data)
        process.stdout.write(`${data}\n`)
    }
    return
  }
  if (text)
    process.stdout.write(`${text.trim()}\n`)
}

const lines = createInterface({ input: process.stdin })
let queue = Promise.resolve()
lines.on('line', (line) => {
  if (!line.trim())
    return
  let message
  try {
    message = JSON.parse(line)
  }
  catch {
    return
  }
  queue = queue.then(() => forward(message)).catch(error => fail(message.id, String(error?.message ?? error)))
})
lines.on('close', () => queue.finally(() => process.exit(0)))
