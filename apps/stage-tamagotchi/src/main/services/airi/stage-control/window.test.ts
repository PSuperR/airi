import { describe, expect, it, vi } from 'vitest'

import { applyWindowVisibility } from './window'

function createWindow(state: { destroyed?: boolean, minimized?: boolean } = {}) {
  return {
    isDestroyed: vi.fn(() => state.destroyed === true),
    isMinimized: vi.fn(() => state.minimized === true),
    restore: vi.fn(),
    show: vi.fn(),
    hide: vi.fn(),
  }
}

describe('applyWindowVisibility', () => {
  it('restores and shows a minimized window', () => {
    const window = createWindow({ minimized: true })

    expect(applyWindowVisibility(window, true)).toEqual({ ok: true })
    expect(window.restore).toHaveBeenCalledOnce()
    expect(window.show).toHaveBeenCalledOnce()
  })

  it('hides a visible window and rejects a missing window', () => {
    const window = createWindow()

    expect(applyWindowVisibility(window, false)).toEqual({ ok: true })
    expect(window.hide).toHaveBeenCalledOnce()
    expect(applyWindowVisibility(undefined, true)).toEqual({
      ok: false,
      error: 'The main window is not ready.',
    })
  })
})
