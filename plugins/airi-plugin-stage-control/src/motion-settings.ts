import process from 'node:process'

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join } from 'node:path'

/** File in the host data folder that remembers the chosen motion folder. */
export const MOTION_SETTINGS_FILE = 'stage-control-motions.json'

/** Default motion folder: `<userData>/motions`, or `~/.airi/motions` when the host gives no data folder. */
export function defaultMotionDirectory(userDataPath: string | undefined) {
  return join(userDataPath ?? join(homedir(), '.airi'), 'motions')
}

/** Reads the motion folder: `AIRI_MOTIONS_DIR`, then the saved choice, then the default. */
export async function readMotionDirectory(userDataPath: string | undefined, env: Record<string, string | undefined> = process.env) {
  const fromEnv = env.AIRI_MOTIONS_DIR?.trim()
  if (fromEnv && isAbsolute(fromEnv))
    return fromEnv
  const saved = await readSavedDirectory(userDataPath)
  return saved ?? defaultMotionDirectory(userDataPath)
}

async function readSavedDirectory(userDataPath: string | undefined) {
  if (!userDataPath)
    return undefined
  try {
    const parsed: unknown = JSON.parse(await readFile(join(userDataPath, MOTION_SETTINGS_FILE), 'utf8'))
    if (parsed && typeof parsed === 'object' && 'directory' in parsed && typeof parsed.directory === 'string' && isAbsolute(parsed.directory))
      return parsed.directory
  }
  catch {}
  return undefined
}

/** Saves the motion folder choice. `undefined` clears it. */
export async function saveMotionDirectory(userDataPath: string | undefined, directory: string | undefined) {
  if (!userDataPath)
    return
  const file = join(userDataPath, MOTION_SETTINGS_FILE)
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, `${JSON.stringify(directory ? { directory } : {}, null, 2)}\n`, 'utf8')
}
