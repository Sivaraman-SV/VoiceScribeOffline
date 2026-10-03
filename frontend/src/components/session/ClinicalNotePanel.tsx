import { Fragment, useEffect, useMemo, useState } from 'react'
import { Check, Copy, Download, FileText, Link2, Mic, Pencil, ShieldAlert, ShieldCheck, X } from 'lucide-react'

import { EmptyState, InlineAlert, Panel } from '@/components/ui/primitives'
import { NoteFallbackBanner, StreamingNotePreview } from './NoteStatusBlocks'
import { VitalsDictationModal } from './VitalsDictationModal'
import {
  CORE_SECTIONS,
  ENTITY_STATUS_LABELS,
  ENTITY_STATUS_STYLES,
  MOM_SECTION_LABELS,
  NOTE_STATUS_LABELS,
  NOTE_STATUS_STYLES,
  SECTION_HINTS,
  SECTION_LABELS,
  SECTION_ORDER,
} from '@/constants'
import type {
  ClinicalEntity,
  ClinicalNote,
  ClinicalSection,
  EntityGroupKey,
  ExportFormat,
  NoteSectionKey,
} from '@/types'
import { cn } from '@/utils/cn'
import { formatRelative } from '@/utils/format'
import { NOT_MENTIONED_TEXT, downloadText, isDocumented, noteToMarkdown } from '@/utils/noteMarkdown'

const ENTITY_GROUP_TITLES: Record<EntityGroupKey, string> = {
  symptoms: 'Symptoms',
  medications: 'Medications',
  findings: 'Physical Examination Findings',
  investigations: 'Investigations',
}

interface Props {
  note: ClinicalNote | null
  changedSections: string[]
  editable?: boolean
  isMeeting?: boolean
  encounterType?: string
  onShowSource: (targetKey: string, statement: string) => void
  onSaveSection?: (section: NoteSectionKey, text: string) => Promise<void>
  /** Server-rendered exports (PDF, FHIR). Markdown is always built client-side. */
  onExport?: (format: ExportFormat) => Promise<void> | void
  exportBusy?: boolean
  streamingSections?: Partial<Record<NoteSectionKey, string>> | null
  actions?: React.ReactNode
}

const EMPTY_SECTION: ClinicalSection = {
  text: '',
  confidence: 0,
  evidence: [],
  review_required: false,
  review_reason: null,
  edited_by_human: false,
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

async function copyToClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

export function ClinicalNotePanel({
  note,
  changedSections,
  editable = false,
  isMeeting = false,
  encounterType,
  onShowSource,
  onSaveSection,
  onExport,
  exportBusy = false,
  streamingSections = null,
  actions,
}: Props) {
  const [copied, setCopied] = useState(false)
  const [vitalsModalOpen, setVitalsModalOpen] = useState(false)
  const meetingMode = isMeeting || encounterType === 'MEETING' || encounterType === 'MDT'
  const sectionLabels = meetingMode ? MOM_SECTION_LABELS : SECTION_LABELS
  const panelTitle = meetingMode ? 'Minutes of Meeting (MoM)' : 'Ambulatory Care Clinical Notes'

  const handleAddVitals = async (vitalsSummary: string, medsSummary: string) => {
    if (!onSaveSection || !note) return
    const content = note.content
    if (vitalsSummary) {
      const rawExisting = (content.physical_examination?.text || '').trim()
      const isPlaceholder = !rawExisting || rawExisting.toLowerCase() === 'not mentioned' || rawExisting.toLowerCase().startsWith('not mentioned')
      const vitalsText = vitalsSummary.toLowerCase().startsWith('vital signs:') ? vitalsSummary : `Vital signs: ${vitalsSummary}`
      const updated = isPlaceholder ? vitalsText : `${rawExisting}. ${vitalsText}`
      await onSaveSection('physical_examination', updated)
    }
    if (medsSummary) {
      const rawExisting = (content.current_medication?.text || '').trim()
      const isPlaceholder = !rawExisting || rawExisting.toLowerCase() === 'not mentioned' || rawExisting.toLowerCase().startsWith('not mentioned')
      const updated = isPlaceholder ? medsSummary : `${rawExisting}. ${medsSummary}`
      await onSaveSection('current_medication', updated)
    }
  }

  if (!note) {
    return (
      <Panel title={panelTitle} icon={<FileText className="h-4 w-4 text-brand" aria-hidden />}>
        <EmptyState
          title={meetingMode ? 'No meeting minutes generated yet' : 'No note generated yet'}
          detail={
            meetingMode
              ? 'Meeting minutes and action items draft in real time as the discussion proceeds.'
              : 'The clinical note drafts in real time as the consultation proceeds.'
          }
        />
      </Panel>
    )
  }

  const content = note.content
  const flagged = note.review_flags ?? []
  const visibleSections = SECTION_ORDER.filter(
    (key) => (!meetingMode && CORE_SECTIONS.includes(key)) || isDocumented(content[key]),
  )
  const visibleGroups = (Object.keys(ENTITY_GROUP_TITLES) as EntityGroupKey[])
    .map((groupKey) => ({ groupKey, entities: content[groupKey] ?? [] }))
    .filter((group) => group.entities.length > 0)
  const flaggedTerms = (Object.keys(ENTITY_GROUP_TITLES) as EntityGroupKey[])
    .flatMap((groupKey) => content[groupKey] ?? [])
    .filter((entity) => entity.review_required)
    .flatMap((entity) => [entity.value, entity.normalized_value ?? ''])
  const title = meetingMode ? 'Minutes of Meeting (MoM)' : 'Ambulatory Care Clinical Note'
  const markdown = () => noteToMarkdown(note, { title, labels: sectionLabels, sections: visibleSections })

  const copyNote = async () => {
    if (await copyToClipboard(markdown())) {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  const exportMarkdown = () => downloadText(markdown(), `clinical-note-${note.session_id}-v${note.version}.md`)

  return (
    <>
      <Panel
        title={panelTitle}
        icon={<FileText className="h-4 w-4 text-brand" aria-hidden />}
        actions={
          <>
            {actions}
            {!meetingMode && editable && onSaveSection ? (
              <button
                type="button"
                onClick={() => setVitalsModalOpen(true)}
                className="btn-teal btn-sm py-1 text-2xs"
                title="Dictate or add patient vitals & medications"
              >
                <Mic className="h-3 w-3" aria-hidden />
                <span>Dictate Vitals & Meds</span>
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => void copyNote()}
              className="btn-secondary btn-sm py-1 text-2xs"
              title="Copy clinical note to clipboard"
            >
              {copied ? <Check className="h-3 w-3 text-tone-success-fg" /> : <Copy className="h-3 w-3 text-ink-3" />}
              {copied ? 'Copied' : 'Copy Note'}
            </button>
            <span className={cn('badge', NOTE_STATUS_STYLES[note.status])}>
              {NOTE_STATUS_LABELS[note.status]}
            </span>
          </>
        }
      >
        <div className="space-y-3.5 p-4 md:p-5">
          <NoteFallbackBanner fallback={content.fallback} />

          <div className="flex flex-wrap items-center justify-between gap-2 rounded-tile bg-surface-2 px-3.5 py-2 text-2xs text-ink-3">
            <span>Updated {formatRelative(note.updated_at)}</span>
            {note.approved_by ? <span className="font-semibold text-tone-success-fg">Signed by {note.approved_by}</span> : null}
            <span className="flex items-center gap-1.5" aria-label="Export note">
              <Download className="h-3 w-3" aria-hidden />
              <ExportButton label="Markdown" onClick={exportMarkdown} />
              {onExport ? (
                <>
                  <ExportButton label="PDF" disabled={exportBusy} onClick={() => void onExport('PDF')} />
                  <ExportButton label="FHIR JSON" disabled={exportBusy} onClick={() => void onExport('FHIR')} />
                </>
              ) : null}
            </span>
          </div>

          <StreamingNotePreview sections={streamingSections} />

          {flagged.length > 0 ? (
            <InlineAlert kind="warning" title={`${flagged.length} item(s) require review`}>
              <ul className="mt-1 space-y-0.5">
                {flagged.map((flag) => (
                  <li key={`${flag.section}-${flag.reason}`}>
                    <span className="font-semibold">{flag.label}:</span> {flag.reason}
                  </li>
                ))}
              </ul>
            </InlineAlert>
          ) : null}

          {visibleSections.map((key) => (
            <NoteSection
              key={key}
              sectionKey={key}
              label={sectionLabels[key] ?? SECTION_LABELS[key]}
              section={content[key] ?? EMPTY_SECTION}
              flaggedTerms={flaggedTerms}
              changed={changedSections.includes(key)}
              editable={editable}
              onShowSource={onShowSource}
              onSave={onSaveSection}
            />
          ))}

          {visibleGroups.map((group) => (
            <EntityGroup
              key={group.groupKey}
              title={ENTITY_GROUP_TITLES[group.groupKey]}
              entities={group.entities}
              onShowSource={onShowSource}
            />
          ))}

          {visibleSections.length === 0 && visibleGroups.length === 0 ? (
            <EmptyState title="Nothing documented yet" detail="Sections will automatically appear as discussion topics are mentioned." />
          ) : null}
        </div>
      </Panel>

      <VitalsDictationModal
        open={vitalsModalOpen}
        onClose={() => setVitalsModalOpen(false)}
        onAddVitals={handleAddVitals}
      />
    </>
  )
}

function ExportButton({ label, onClick, disabled }: { label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="btn-secondary btn-sm px-2.5 py-0.5 text-2xs"
    >
      {label}
    </button>
  )
}

/** Marks entity mentions the grounding validator flagged so the reviewer sees exactly which words are unsupported. */
function HighlightedText({ text, terms }: { text: string; terms: string[] }) {
  const pattern = useMemo(() => {
    const unique = [...new Set(terms.map((term) => term.trim()).filter((term) => term.length > 2))]
    if (unique.length === 0) return null
    unique.sort((a, b) => b.length - a.length)
    return new RegExp(`\\b(${unique.map(escapeRegExp).join('|')})\\b`, 'gi')
  }, [terms])

  if (!pattern) return <>{text}</>
  const parts = text.split(pattern)
  if (parts.length === 1) return <>{text}</>
  return (
    <>
      {parts.map((part, index) =>
        index % 2 === 1 ? (
          <mark
            key={index}
            title="Not confirmed by the transcript: verify before signing"
            className="rounded-sm bg-tone-warning-line px-0.5 text-tone-warning-fg"
          >
            {part}
          </mark>
        ) : (
          <Fragment key={index}>{part}</Fragment>
        ),
      )}
    </>
  )
}

function NoteSection({
  sectionKey,
  label,
  section,
  flaggedTerms,
  changed,
  editable,
  onShowSource,
  onSave,
}: {
  sectionKey: NoteSectionKey
  label: string
  section: ClinicalSection
  flaggedTerms: string[]
  changed: boolean
  editable: boolean
  onShowSource: (targetKey: string, statement: string) => void
  onSave?: (section: NoteSectionKey, text: string) => Promise<void>
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(section.text)
  const [saving, setSaving] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!editing) setDraft(section.text)
  }, [section.text, editing])

  const documented = isDocumented(section)
  const evidenceCount = section.evidence?.length ?? 0
  const needsReview = section.review_required
  const grounded =
    documented && !needsReview && evidenceCount > 0 && section.evidence.every((ref) => ref.validated !== false)

  const copySection = async () => {
    if (await copyToClipboard(`${label}\n${documented ? section.text : NOT_MENTIONED_TEXT}`)) {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    }
  }

  const save = async () => {
    if (!onSave) return
    setSaving(true)
    try {
      await onSave(sectionKey, draft.trim())
      setEditing(false)
    } finally {
      setSaving(false)
    }
  }

  return (
    <article
      className={cn(
        'overflow-hidden rounded-tile border bg-surface transition-all duration-150',
        needsReview
          ? 'border-tone-warning-line ring-1 ring-tone-warning-line'
          : 'border-line hover:border-line-strong',
        changed && 'ring-2 ring-aqua/40',
      )}
    >
      <header className="flex flex-wrap items-center gap-2 px-4 pb-1 pt-3.5 md:px-5">
        <span className={cn('h-4 w-1 shrink-0 rounded-full', needsReview ? 'bg-tone-warning-fg' : 'bg-aqua')} aria-hidden />
        <h3 className="text-sm font-semibold tracking-tight text-ink">{label}</h3>
        {grounded ? (
          <span className="badge tone-success" title="Every cited transcript segment was validated">
            <ShieldCheck className="h-3 w-3" aria-hidden /> Grounded
          </span>
        ) : null}
        {section.edited_by_human ? <span className="badge tone-neutral">Edited</span> : null}
        {needsReview ? (
          <span className="badge tone-warning">
            <ShieldAlert className="h-3 w-3" aria-hidden /> Review
          </span>
        ) : null}
        <span className="ml-auto flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => void copySection()}
            aria-label={`Copy ${label}`}
            title={`Copy ${label}`}
            className="btn-icon btn-icon-sm"
          >
            {copied ? <Check className="h-3 w-3 text-tone-success-fg" aria-hidden /> : <Copy className="h-3 w-3" aria-hidden />}
          </button>
          <button
            type="button"
            onClick={() => onShowSource(sectionKey, section.text)}
            aria-label={`Show source for ${label}`}
            className="btn-secondary btn-sm px-2.5 py-1 text-2xs hover:border-aqua hover:text-brand"
          >
            <Link2 className="h-3 w-3" aria-hidden />
            Sources ({evidenceCount})
          </button>
          {editable ? (
            editing ? (
              <span className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => void save()}
                  disabled={saving}
                  className="btn-primary btn-sm px-2.5 py-1 text-2xs"
                >
                  <Check className="h-3 w-3" aria-hidden />
                  Save
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setEditing(false)
                    setDraft(section.text)
                  }}
                  className="btn-icon btn-icon-sm"
                >
                  <X className="h-3 w-3" aria-hidden />
                </button>
              </span>
            ) : (
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="btn-secondary btn-sm px-2.5 py-1 text-2xs"
              >
                <Pencil className="h-3 w-3 text-ink-3" aria-hidden />
                Edit
              </button>
            )
          ) : null}
        </span>
      </header>

      <div className="px-4 pb-4 pt-2 md:px-5">
        {editing ? (
          <>
            <textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              rows={4}
              className="field-input font-normal leading-relaxed"
              aria-label={`Edit ${label}`}
            />
            <p className="field-hint">{SECTION_HINTS[sectionKey]}</p>
          </>
        ) : documented ? (
          <p className="whitespace-pre-wrap text-[14.5px] font-normal leading-7 text-ink">
            <HighlightedText text={section.text} terms={flaggedTerms} />
          </p>
        ) : (
          <p className="text-[13px] font-normal italic text-ink-3">{NOT_MENTIONED_TEXT}</p>
        )}
        {needsReview && section.review_reason ? (
          <p className="mt-2.5 rounded-control bg-tone-warning-bg px-3 py-1.5 text-2xs font-medium text-tone-warning-fg">
            {section.review_reason}
          </p>
        ) : null}
      </div>
    </article>
  )
}

function EntityGroup({
  title,
  entities,
  onShowSource,
}: {
  title: string
  entities: ClinicalEntity[]
  onShowSource: (targetKey: string, statement: string) => void
}) {
  return (
    <article className="overflow-hidden rounded-tile border border-line bg-surface">
      <header className="flex items-center gap-2 px-4 pb-1 pt-3.5 md:px-5">
        <span className="h-4 w-1 shrink-0 rounded-full bg-lime" aria-hidden />
        <h3 className="text-sm font-semibold tracking-tight text-ink">{title}</h3>
        <span className="badge tone-neutral mono ml-auto">{entities.length}</span>
      </header>
      <div className="px-4 pb-4 pt-2 md:px-5">
        <ul className="space-y-2">
          {entities.map((entity) => (
            <li
              key={entity.ref}
              className={cn(
                'flex flex-wrap items-center gap-2 text-[13px]',
                entity.review_required && 'rounded-control bg-tone-warning-bg px-2 py-1.5 ring-1 ring-tone-warning-line',
              )}
              title={entity.review_required ? entity.review_reason ?? 'Needs review' : undefined}
            >
              <span className={cn('badge', ENTITY_STATUS_STYLES[entity.status])}>
                {ENTITY_STATUS_LABELS[entity.status]}
              </span>
              <span className="font-semibold text-ink">
                {entity.normalized_value ? entity.normalized_value : entity.value}
              </span>
              {entity.normalized_value && entity.normalized_value.toLowerCase() !== entity.value.toLowerCase() ? (
                <span className="text-2xs italic text-ink-3">(&ldquo;{entity.value}&rdquo;)</span>
              ) : null}
              {entity.detail ? <span className="text-ink-2">— {entity.detail}</span> : null}
              {entity.review_required ? (
                <span className="inline-flex items-center gap-0.5 text-2xs font-semibold text-tone-warning-fg">
                  <ShieldAlert className="h-3 w-3" aria-hidden /> Review
                </span>
              ) : null}
              <button
                type="button"
                onClick={() => onShowSource(entity.ref, entity.value)}
                className="ml-auto inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-2xs font-semibold text-ink-3 transition hover:bg-aqua-soft hover:text-brand"
              >
                <Link2 className="h-3 w-3" aria-hidden />
                Sources
              </button>
            </li>
          ))}
        </ul>
      </div>
    </article>
  )
}
