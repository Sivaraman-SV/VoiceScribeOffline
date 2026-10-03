import { describe, expect, it } from 'vitest'

import { containsTamil, liveWorkspaceMode } from '@/components/session/ConsultationFlow'

describe('liveWorkspaceMode', () => {
  it('stays on the mic while recording', () => {
    expect(
      liveWorkspaceMode({ recording: true, processing: true, hasTranscript: false, hasNote: false }),
    ).toBe('capture')
  })

  it('uses the full-screen theater only before the first transcript line', () => {
    expect(
      liveWorkspaceMode({ recording: false, processing: true, hasTranscript: false, hasNote: false }),
    ).toBe('theater')
  })

  it('opens the two-column workspace as soon as transcript lines exist', () => {
    expect(
      liveWorkspaceMode({ recording: false, processing: true, hasTranscript: true, hasNote: false }),
    ).toBe('workspace')
  })

  it('keeps the workspace when a note arrived from an earlier chunk', () => {
    expect(
      liveWorkspaceMode({ recording: false, processing: true, hasTranscript: true, hasNote: true }),
    ).toBe('workspace')
  })
})

describe('containsTamil', () => {
  it('detects Tamil script for the Indic font stack', () => {
    expect(containsTamil('Hello doctor')).toBe(false)
    expect(containsTamil('எனக்கு தலைவலி இருக்கு')).toBe(true)
  })
})
