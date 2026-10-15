import { describe, expect, it } from 'vitest'

import {
  extensionAnnounce,
  extensionKitAnnounce,
  extensionModuleAnnounce,
  peerAuthenticate,
  stageControl,
  stageControlResult,
} from './events'

describe('extension runtime protocol events', () => {
  it('defines peer transport authentication separately from extension authentication', () => {
    expect(peerAuthenticate.id).toBe('peer:authenticate')
  })

  it('defines extension session announcement separately from module announcement', () => {
    expect(extensionAnnounce.id).toBe('extension:announce')
    expect(extensionModuleAnnounce.id).toBe('extension:module:announce')
  })

  it('defines kit availability events under extension kit namespace', () => {
    expect(extensionKitAnnounce.id).toBe('extension:kit:announce')
  })

  it('defines stage control separately from its result', () => {
    expect(stageControl.id).toBe('stage:control')
    expect(stageControlResult.id).toBe('stage:control:result')
  })
})
