import { describe, expect, it, vi } from 'vitest'

import { resizeBoundsByDelta, setWindowAlwaysOnTop, setWindowVisible } from './window'

const mocks = vi.hoisted(() => ({
  isMacOS: false,
  isWindows: false,
}))

vi.mock('electron', () => ({
  shell: {
    openExternal: vi.fn(),
  },
  BrowserWindow: vi.fn(),
}))

vi.mock('std-env', () => ({
  get isMacOS() {
    return mocks.isMacOS
  },
  get isWindows() {
    return mocks.isWindows
  },
}))

vi.mock('../../services/electron', () => ({
  createAppService: vi.fn(),
  createPowerMonitorService: vi.fn(),
  createScreenService: vi.fn(),
  createSystemPreferencesService: vi.fn(),
  createWindowService: vi.fn(),
}))

describe('setWindowAlwaysOnTop', () => {
  it('disables always-on-top when flag is false', () => {
    const window = {
      setAlwaysOnTop: vi.fn(),
    }

    setWindowAlwaysOnTop(window, false)

    expect(window.setAlwaysOnTop).toHaveBeenCalledWith(false)
  })

  it('applies standard always-on-top on Linux', () => {
    mocks.isMacOS = false
    mocks.isWindows = false

    const window = {
      setAlwaysOnTop: vi.fn(),
    }

    setWindowAlwaysOnTop(window, true)

    expect(window.setAlwaysOnTop).toHaveBeenCalledWith(true)
  })

  it('applies screen-saver level and relative offset on macOS', () => {
    mocks.isMacOS = true
    mocks.isWindows = false

    const window = {
      setAlwaysOnTop: vi.fn(),
    }

    setWindowAlwaysOnTop(window, true, 1)

    expect(window.setAlwaysOnTop).toHaveBeenCalledWith(true, 'screen-saver', 1)
  })

  it('applies screen-saver level and relative offset on Windows', () => {
    mocks.isMacOS = false
    mocks.isWindows = true

    const window = {
      setAlwaysOnTop: vi.fn(),
    }

    setWindowAlwaysOnTop(window, true, 2)

    expect(window.setAlwaysOnTop).toHaveBeenCalledWith(true, 'screen-saver', 2)
  })
})

describe('resizeBoundsByDelta', () => {
  it('keeps the opposite corner still while a corner grip is dragged', () => {
    const bounds = { x: 100, y: 100, width: 400, height: 500 }

    expect(resizeBoundsByDelta(bounds, { deltaX: -20, deltaY: -30, direction: 'nw' }))
      .toEqual({ x: 80, y: 70, width: 420, height: 530 })
    expect(resizeBoundsByDelta(bounds, { deltaX: 20, deltaY: 30, direction: 'se' }))
      .toEqual({ x: 100, y: 100, width: 420, height: 530 })
  })

  it('stops at the minimum size and keeps the opposite edges still', () => {
    const bounds = { x: 100, y: 100, width: 400, height: 500 }

    expect(resizeBoundsByDelta(bounds, { deltaX: 1000, deltaY: 1000, direction: 'nw', minWidth: 300, minHeight: 250 }))
      .toEqual({ x: 200, y: 350, width: 300, height: 250 })
  })
})

describe('setWindowVisible', () => {
  function createWindow(overrides: Partial<{
    destroyed: boolean
    minimized: boolean
  }> = {}) {
    return {
      focus: vi.fn(),
      hide: vi.fn(),
      isDestroyed: () => overrides.destroyed ?? false,
      isMinimized: () => overrides.minimized ?? false,
      restore: vi.fn(),
      show: vi.fn(),
    }
  }

  it('restores, shows, and focuses a minimized window', () => {
    const window = createWindow({ minimized: true })

    setWindowVisible(window, true)

    expect(window.restore).toHaveBeenCalledOnce()
    expect(window.show).toHaveBeenCalledOnce()
    expect(window.focus).toHaveBeenCalledOnce()
    expect(window.hide).not.toHaveBeenCalled()
  })

  it('hides a visible window', () => {
    const window = createWindow()

    setWindowVisible(window, false)

    expect(window.hide).toHaveBeenCalledOnce()
    expect(window.show).not.toHaveBeenCalled()
  })

  it('throws when the window is closed', () => {
    const window = createWindow({ destroyed: true })

    expect(() => setWindowVisible(window, true)).toThrow('The main window is closed.')
  })
})
