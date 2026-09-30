import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { ClinicalNotePanel } from '@/components/session/ClinicalNotePanel'

import { note } from './fixtures'

describe('ClinicalNotePanel', () => {
  it('renders every clinical section with provenance affordances', () => {
    render(<ClinicalNotePanel note={note} changedSections={[]} onShowSource={() => {}} />)

    expect(screen.getByText('Presenting Complaint')).toBeInTheDocument()
    expect(screen.getByText('History of Present Illness')).toBeInTheDocument()
    expect(screen.getByText('Assessment and Plan')).toBeInTheDocument()
    expect(screen.getByText('Chest discomfort since yesterday evening.')).toBeInTheDocument()
    expect(screen.getByText('Draft Note')).toBeInTheDocument()
    expect(screen.getByLabelText('Show source for Presenting Complaint')).toHaveTextContent('Sources (1)')
    expect(screen.getByLabelText('Show source for Assessment and Plan')).toHaveTextContent('Sources (0)')
  })

  it('surfaces negated symptoms without presenting them as present', () => {
    render(<ClinicalNotePanel note={note} changedSections={[]} onShowSource={() => {}} />)
    expect(screen.getByText('shortness of breath')).toBeInTheDocument()
    expect(screen.getByText('Denied')).toBeInTheDocument()
  })

  it('opens the evidence viewer for the clicked section', async () => {
    const onShowSource = vi.fn()
    render(<ClinicalNotePanel note={note} changedSections={[]} onShowSource={onShowSource} />)
    await userEvent.click(screen.getByLabelText('Show source for Presenting Complaint'))
    expect(onShowSource).toHaveBeenCalledWith('chief_complaint', 'Chest discomfort since yesterday evening.')
  })

  it('lets a human edit and save a section when review editing is enabled', async () => {
    const onSaveSection = vi.fn().mockResolvedValue(undefined)
    render(
      <ClinicalNotePanel
        note={note}
        changedSections={[]}
        editable
        onShowSource={() => {}}
        onSaveSection={onSaveSection}
      />,
    )

    await userEvent.click(screen.getAllByText('Edit')[0])
    const textarea = screen.getByLabelText('Edit Presenting Complaint')
    await userEvent.clear(textarea)
    await userEvent.type(textarea, 'Chest discomfort since yesterday evening, pressure-like.')
    await userEvent.click(screen.getByText('Save'))

    expect(onSaveSection).toHaveBeenCalledWith(
      'chief_complaint',
      'Chest discomfort since yesterday evening, pressure-like.',
    )
  })

  it('blocks nothing but clearly flags sections that need review', () => {
    const flagged = {
      ...note,
      status: 'REVIEW_REQUIRED' as const,
      review_flags: [
        { section: 'assessment', label: 'Assessment', reason: 'No transcript evidence', severity: 'WARNING' },
      ],
    }
    render(<ClinicalNotePanel note={flagged} changedSections={[]} onShowSource={() => {}} />)
    expect(screen.getByText('1 item(s) require review')).toBeInTheDocument()
    expect(screen.getByText('No transcript evidence')).toBeInTheDocument()
  })

  it('shows undiscussed core sections as "Not mentioned" and marks cited ones as grounded', () => {
    render(<ClinicalNotePanel note={note} changedSections={[]} onShowSource={() => {}} />)
    expect(screen.getByText('Review of Systems')).toBeInTheDocument()
    expect(screen.getByText('Plan Of Care')).toBeInTheDocument()
    expect(screen.queryByText('Menstrual History')).not.toBeInTheDocument()
    expect(screen.getAllByText('Not mentioned in consultation').length).toBeGreaterThan(3)
    expect(screen.getAllByText('Grounded')).toHaveLength(2)
  })

  it('never shows a rule-based draft without the offline fallback badge', () => {
    const fallbackNote = {
      ...note,
      content: {
        ...note.content,
        fallback: {
          code: 'LLM_SERVICE_UNAVAILABLE',
          label: 'OFFLINE FALLBACK - OLLAMA DISCONNECTED',
          message: 'The local LLM could not be reached.',
          at: null,
        },
      },
    }
    render(<ClinicalNotePanel note={fallbackNote} changedSections={[]} onShowSource={() => {}} />)
    expect(screen.getByRole('alert')).toHaveTextContent('[OFFLINE FALLBACK - OLLAMA DISCONNECTED]')
  })

  it('copies a single section and routes PDF/FHIR exports to the server', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    const onExport = vi.fn()
    render(<ClinicalNotePanel note={note} changedSections={[]} onShowSource={() => {}} onExport={onExport} />)

    await userEvent.click(screen.getByLabelText('Copy Presenting Complaint'))
    expect(writeText).toHaveBeenCalledWith('Presenting Complaint\nChest discomfort since yesterday evening.')

    await userEvent.click(screen.getByText('FHIR JSON'))
    await userEvent.click(screen.getByText('PDF'))
    expect(onExport.mock.calls).toEqual([['FHIR'], ['PDF']])
  })

  it('highlights entity mentions the validator flagged', () => {
    const [first, ...rest] = note.content.symptoms
    const flaggedNote = {
      ...note,
      content: { ...note.content, symptoms: [{ ...first, review_required: true }, ...rest] },
    }
    render(<ClinicalNotePanel note={flaggedNote} changedSections={[]} onShowSource={() => {}} />)
    const marks = document.querySelectorAll('mark')
    expect([...marks].map((mark) => mark.textContent)).toContain('Chest discomfort')
  })

  it('renders the streamed draft as unverified', () => {
    render(
      <ClinicalNotePanel
        note={note}
        changedSections={[]}
        onShowSource={() => {}}
        streamingSections={{ chief_complaint: 'Fever for three days' }}
      />,
    )
    expect(screen.getByLabelText('Streaming draft')).toHaveTextContent('not yet verified')
    expect(screen.getByText('Fever for three days')).toBeInTheDocument()
  })
})
