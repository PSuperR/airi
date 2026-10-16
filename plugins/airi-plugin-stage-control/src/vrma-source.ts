import { readFile, stat } from 'node:fs/promises'
import { isAbsolute } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Largest local .vrma file the plugin sends to the stage. */
export const MAX_VRMA_FILE_BYTES = 32 * 1024 * 1024

const REMOTE_SOURCE = /^(?:https?:|data:|blob:)/i

/**
 * Turns a `vrma` source into a URL the stage renderer can load.
 *
 * The Electron renderer cannot fetch `file://` URLs, so the plugin reads a
 * local `.vrma` file itself and sends it as a `data:` URL.
 */
export async function resolveVrmaSource(src: string): Promise<string> {
  if (REMOTE_SOURCE.test(src))
    return src

  let path = src
  if (/^file:/i.test(src))
    path = fileURLToPath(src)
  else if (!isAbsolute(src))
    throw new Error('The .vrma source must be an http(s) URL, a file:// URL, or an absolute file path.')

  if (!path.toLowerCase().endsWith('.vrma'))
    throw new Error('The local file must have the .vrma extension.')

  const info = await stat(path).catch(() => undefined)
  if (!info?.isFile())
    throw new Error(`The .vrma file was not found: ${path}`)
  if (info.size > MAX_VRMA_FILE_BYTES)
    throw new Error(`The .vrma file is larger than ${MAX_VRMA_FILE_BYTES / 1024 / 1024} MB.`)

  const bytes = await readFile(path)
  return `data:application/octet-stream;base64,${bytes.toString('base64')}`
}
