import { describe, expect, it } from 'vitest'

import { isDocumented, noteToMarkdown } from '@/utils/noteMarkdown'

import { note } from './fixtures'

describe('noteToMarkdown', () => {
  it('writes every section, with explicit placeholders for undiscussed ones', () => {
    const markdown = noteToMarkdown(note)
    expect(markdown).toContain('## Presenting Complaint\n\nChest discomfort since yesterday evening.')
    expect(markdown).toContain('## Plan Of Care\n\n_Not mentioned in consultation_')
    expect(markdown).toContain('- shortness of breath (denied)')
  })

  it('carries the offline fallback warning into the export', () => {
    const markdown = noteToMarkdown({
      ...note,
      content: {
        ...note.content,
        fallback: { code: 'LLM_SERVICE_UNAVAILABLE', label: 'OFFLINE FALLBACK - OLLAMA DISCONNECTED', message: 'x', at: null },
      },
    })
    expect(markdown).toContain('[OFFLINE FALLBACK - OLLAMA DISCONNECTED]')
  })

  it('treats placeholder text as undocumented', () => {
    const base = note.content.plan
    expect(isDocumented({ ...base, text: 'Not mentioned.' })).toBe(false)
    expect(isDocumented({ ...base, text: 'Not mentioned in consultation' })).toBe(false)
    expect(isDocumented({ ...base, text: 'Tab Dolo 650 SOS' })).toBe(true)
  })
})
