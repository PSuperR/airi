import type { StageCommandResult } from '@proj-airi/stage-shared/stage-command'

/** The window operations used to show or hide the main stage window. */
export interface StageWindowControls {
  isDestroyed: () => boolean
  isMinimized: () => boolean
  restore: () => void
  show: () => void
  hide: () => void
}

/** Shows or hides one window. A destroyed window returns an error. */
export function applyWindowVisibility(window: StageWindowControls | undefined, visible: boolean): StageCommandResult {
  if (!window || window.isDestroyed())
    return { ok: false, error: 'The main window is not ready.' }

  if (visible) {
    if (window.isMinimized())
      window.restore()
    window.show()
    return { ok: true }
  }

  window.hide()
  return { ok: true }
}
