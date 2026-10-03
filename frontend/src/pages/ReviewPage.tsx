import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  ArrowLeft,
  BadgeCheck,
  CheckCircle2,
  FileText,
  History,
  Info,
  Link2,
  ListFilter,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
  X,
} from 'lucide-react'

import { ClinicalNotePanel } from '@/components/session/ClinicalNotePanel'
import { EvidenceViewer } from '@/components/session/EvidenceViewer'
import { SpeakerRoster } from '@/components/session/SpeakerRoster'
import { TranscriptPanel } from '@/components/session/TranscriptPanel'
import { EmptyState, InlineAlert, Spinner } from '@/components/ui/primitives'
import { MedicalPulseLoader, TabTransition } from '@/components/ui/MedicalAnimations'
import { ENTITY_STATUS_LABELS, ENTITY_STATUS_STYLES } from '@/constants'
import { api, downloadBlob } from '@/services/api'
import { useSessionStore } from '@/store/sessionStore'
import { useUiStore } from '@/store/uiStore'
import type { ExportFormat, NoteSectionKey, NoteVersion } from '@/types'
import { cn } from '@/utils/cn'
import { formatDateTime, formatDuration, formatTimestamp, titleCase } from '@/utils/format'

type SidebarTab = 'entities' | 'evidence' | 'versions' | 'info'

export function ReviewPage() {
  const { id } = useParams<{ id: string }>()
  const pushToast = useUiStore((state) => state.pushToast)
  const identityName = useUiStore((state) => state.identityName)

  const {
    session,
    segments,
    speakers,
    entities,
    note,
    evidence,
    selectedSegmentRef,
    evidenceFocus,
    attach,
    detach,
    refresh,
    selectSegment,
    focusEvidence,
    setNote,
    streamingSections,
  } = useSessionStore()

  const [versions, setVersions] = useState<NoteVersion[]>([])
  const [acknowledged, setAcknowledged] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showApproveModal, setShowApproveModal] = useState(false)
  const [activeTab, setActiveTab] = useState<SidebarTab>('entities')

  useEffect(() => {
    if (!id) return
    attach(id).catch((err: Error) => setError(err.message))
    return () => detach()
  }, [attach, detach, id])

  const loadVersions = useCallback(() => {
    if (!id) return
    api
      .noteVersions(id)
      .then(setVersions)
      .catch(() => setVersions([]))
  }, [id])

  useEffect(loadVersions, [loadVersions, note?.version])

  const stats = useMemo(() => {
    const validated = evidence.filter((link) => link.validated).length
    return { validated, total: evidence.length }
  }, [evidence])

  const highlightedRefs = useMemo(() => {
    if (!evidenceFocus) return []
    return evidence
      .filter((link) => link.target_key === evidenceFocus.targetKey && link.segment_ref)
      .map((link) => link.segment_ref as string)
  }, [evidence, evidenceFocus])

  const saveSection = async (section: NoteSectionKey, text: string) => {
    if (!note) return
    try {
      const updated = await api.editNote(note.id, { [section]: text, editor: identityName })
      setNote(updated)
      pushToast({ kind: 'success', title: 'Section saved', detail: `Note is now version ${updated.version}.` })
      loadVersions()
    } catch (err) {
      pushToast({ kind: 'error', title: 'Could not save section', detail: (err as Error).message })
    }
  }

  const approve = async () => {
    if (!note) return
    setBusy(true)
    try {
      const updated = await api.approveNote(note.id, identityName)
      setNote(updated)
      setShowApproveModal(false)
      await refresh()
      loadVersions()
      pushToast({ kind: 'success', title: 'Note approved & signed', detail: `Signed by ${identityName}.` })
    } catch (err) {
      pushToast({ kind: 'error', title: 'Approval blocked', detail: (err as Error).message })
    } finally {
      setBusy(false)
    }
  }

  const reopen = async () => {
    if (!note) return
    setBusy(true)
    try {
      const updated = await api.reopenNote(note.id)
      setNote(updated)
      setAcknowledged(false)
      await refresh()
      loadVersions()
      pushToast({ kind: 'info', title: 'Note reopened for editing' })
    } catch (err) {
      pushToast({ kind: 'error', title: 'Could not reopen note', detail: (err as Error).message })
    } finally {
      setBusy(false)
    }
  }

  const exportAs = async (format: ExportFormat) => {
    if (!session) return
    setBusy(true)
    try {
      const { blob, filename } = await api.exportSession(session.id, format)
      downloadBlob(blob, filename)
      await refresh()
      pushToast({ kind: 'success', title: `${format} export downloaded`, detail: filename })
    } catch (err) {
      pushToast({ kind: 'error', title: `${format} export failed`, detail: (err as Error).message })
    } finally {
      setBusy(false)
    }
  }

  if (error) {
    return (
      <div className="page">
        <div className="page-inner">
          <InlineAlert kind="error" title="Could not load session">
            {error}
          </InlineAlert>
        </div>
      </div>
    )
  }

  if (!session || !note) {
    return (
      <div className="flex h-full items-center justify-center bg-canvas p-12">
        <MedicalPulseLoader
          label="Loading Clinical Review Workspace..."
          sublabel="Verifying EHR provenance, ambulatory care narrative, and diagnostic orders"
        />
      </div>
    )
  }

  const flags = note.review_flags ?? []
  const blockingFlags = flags.filter((f) => f.severity === 'ERROR' || f.severity === 'BLOCKING')
  const infoFlags = flags.filter((f) => f.severity === 'INFO' || f.severity === 'WARNING')
  const approvable = note.status === 'DRAFT' || note.status === 'REVIEW_REQUIRED'
  const isApproved = note.status === 'APPROVED' || note.status === 'EXPORTED'

  const tabClass = (tab: SidebarTab) =>
    cn('seg-item flex-1 justify-center gap-1.5 px-2 py-1.5 text-xs font-semibold', activeTab === tab && 'seg-item-active')

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 bg-canvas p-3 text-ink animate-fade-in-up md:p-4">
      <section className="card shrink-0 overflow-hidden">
        <header className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 md:px-5">
          <div className="flex min-w-0 items-center gap-3">
            <Link to={`/sessions/${session.id}/live`} className="btn-secondary btn-sm">
              <ArrowLeft className="h-4 w-4" aria-hidden />
              Return to Session
            </Link>
            <div className="h-6 w-px bg-line" />
            <div className="min-w-0 leading-tight">
              <div className="flex flex-wrap items-center gap-2">
                <span className="mono text-xs font-semibold text-brand">{session.reference}</span>
                <span className="text-2xs font-medium text-ink-3">·</span>
                <span className="text-sm font-semibold tracking-tight text-ink">
                  {session.patient_name ? `${session.patient_name} (${session.patient_id})` : `Patient ${session.patient_id}`}
                </span>
                <span className="text-2xs font-medium text-ink-3">·</span>
                <span className="mono text-2xs text-ink-3">{formatDuration(session.duration_seconds)}</span>
              </div>
              <p className="mt-0.5 truncate text-xs text-ink-3">{session.name}</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="btn-secondary btn-sm"
              disabled={busy}
              onClick={() => void exportAs('PDF')}
              title="Download formatted clinical PDF note"
            >
              <FileText className="h-3.5 w-3.5 text-tone-danger-fg" aria-hidden />
              PDF
            </button>

            {isApproved ? (
              <button
                type="button"
                className="btn-secondary btn-sm"
                disabled={busy}
                onClick={() => void reopen()}
                title="Reopen note for additional clinical edits"
              >
                <RotateCcw className="h-3.5 w-3.5 text-ink-3" aria-hidden />
                Reopen Note
              </button>
            ) : null}
          </div>
        </header>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line bg-surface-2 px-4 py-2.5 md:px-5">
          <div className="flex items-center gap-3">
            {isApproved ? (
              <span className="badge tone-success px-3 py-1 text-xs">
                <ShieldCheck className="h-4 w-4" />
                Approved & Signed by {note.approved_by ?? identityName}
                <span className="text-2xs font-normal opacity-80">({formatDateTime(note.approved_at)})</span>
              </span>
            ) : (
              <div className="flex flex-wrap items-center gap-2.5">
                <span className="badge tone-warning px-3 py-1 text-xs">
                  <ShieldAlert className="h-3.5 w-3.5" />
                  Pending Doctor Review & Approval
                </span>
                {blockingFlags.length > 0 ? (
                  <span className="text-xs font-semibold text-tone-warning-fg">({blockingFlags.length} items flagged)</span>
                ) : (
                  <span className="text-xs text-ink-3">
                    {infoFlags.length > 0 ? 'Clinical edits and vitals preserved · Ready to sign' : 'All statements cited with transcript evidence'}
                  </span>
                )}
              </div>
            )}
          </div>

          <div className="flex items-center gap-2">
            {!isApproved ? (
              <button
                type="button"
                className="btn-primary"
                disabled={busy || !approvable}
                onClick={() => setShowApproveModal(true)}
                title="Review, approve and sign clinical note"
              >
                <BadgeCheck className="h-4 w-4" aria-hidden />
                Approve & Sign Note
              </button>
            ) : null}
          </div>
        </div>
      </section>

      {blockingFlags.length > 0 ? (
        <div className="tone-warning shrink-0 rounded-tile border px-4 py-3 text-xs">
          <div className="flex items-center gap-2 text-[13px] font-semibold">
            <ShieldAlert className="h-4 w-4 shrink-0" />
            <span>Items requiring clinical review prior to approval:</span>
          </div>
          <ul className="ml-6 mt-1.5 list-disc space-y-0.5 text-xs opacity-90">
            {blockingFlags.map((flag) => (
              <li key={`${flag.section}-${flag.reason}`}>
                <span className="font-semibold">{flag.label}:</span> {flag.reason}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.2fr)_minmax(0,0.85fr)]">
        <div className="flex min-h-0 flex-col gap-3">
          <TranscriptPanel
            segments={segments}
            speakers={speakers}
            evidence={evidence}
            selectedRef={selectedSegmentRef}
            highlightedRefs={highlightedRefs}
            live={false}
            onSelect={selectSegment}
          />
          <SpeakerRoster speakers={speakers} editable={!isApproved} onChanged={() => void refresh()} />
        </div>

        <ClinicalNotePanel
          note={note}
          encounterType={session.simulation_type}
          changedSections={[]}
          editable={!isApproved}
          onShowSource={(targetKey, statement) => focusEvidence({ targetKey, statement, kind: 'SECTION' })}
          onSaveSection={saveSection}
          onExport={exportAs}
          exportBusy={busy}
          streamingSections={streamingSections}
        />

        <div className="panel">
          <div className="border-b border-line p-2.5">
            <div className="seg flex w-full bg-surface-2">
              <button type="button" onClick={() => setActiveTab('entities')} className={tabClass('entities')}>
                <ListFilter className="h-3.5 w-3.5" />
                Facts ({entities.length})
              </button>
              <button type="button" onClick={() => setActiveTab('evidence')} className={tabClass('evidence')}>
                <Link2 className="h-3.5 w-3.5" />
                Evidence ({stats.validated})
              </button>
              <button type="button" onClick={() => setActiveTab('versions')} className={tabClass('versions')}>
                <History className="h-3.5 w-3.5" />
                History ({versions.length})
              </button>
              <button type="button" onClick={() => setActiveTab('info')} className={tabClass('info')}>
                <Info className="h-3.5 w-3.5" />
                Encounter
              </button>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
            <TabTransition tabKey={activeTab}>
              {activeTab === 'entities' && (
              <div className="space-y-2">
                {entities.length === 0 ? (
                  <EmptyState
                    title="No clinical facts extracted"
                    detail="Structured symptoms, medications, and findings will appear here."
                  />
                ) : (
                  <ul className="divide-y divide-line">
                    {entities.map((entity) => (
                      <li key={entity.ref} className="py-2.5">
                        <div className="flex items-center gap-2">
                          <span className={cn('badge', ENTITY_STATUS_STYLES[entity.status])}>
                            {ENTITY_STATUS_LABELS[entity.status]}
                          </span>
                          <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-ink">
                            {entity.value}
                          </span>
                          <button
                            type="button"
                            onClick={() => focusEvidence({ targetKey: entity.ref, statement: entity.value, kind: 'ENTITY' })}
                            className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-ink-3 transition hover:bg-aqua-soft hover:text-brand"
                            title="View transcript citation"
                          >
                            <Link2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                        <div className="mt-1 flex items-center justify-between text-2xs text-ink-3">
                          <span>{titleCase(entity.entity_type)}</span>
                          {entity.detail ? <span className="text-ink-3">({entity.detail})</span> : null}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {activeTab === 'evidence' && (
              <div className="space-y-2">
                {evidence.length === 0 ? (
                  <EmptyState
                    title="No evidence citations"
                    detail="All clinical statements are linked to audio segments."
                  />
                ) : (
                  <ul className="space-y-1.5">
                    {evidence.map((link) => (
                      <li key={link.id}>
                        <button
                          type="button"
                          onClick={() => selectSegment(link.segment_ref)}
                          className="w-full rounded-tile border border-transparent px-3 py-2.5 text-left transition hover:border-line hover:bg-surface-2"
                        >
                          <div className="flex items-center gap-1.5 text-2xs text-ink-3">
                            <span className="mono font-semibold text-brand">{link.segment_ref ?? 'citation'}</span>
                            <span>·</span>
                            <span className="mono">{formatTimestamp(link.timestamp ?? 0)}</span>
                            {link.validated ? (
                              <span className="ml-auto flex items-center gap-0.5 text-2xs font-semibold text-tone-success-fg">
                                <CheckCircle2 className="h-3 w-3" /> Verified
                              </span>
                            ) : null}
                          </div>
                          <p className="mt-1 line-clamp-2 text-[13px] leading-relaxed text-ink">{link.clinical_statement}</p>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {activeTab === 'versions' && (
              <div className="space-y-2">
                {versions.length === 0 ? (
                  <EmptyState title="No version history" detail="Edits and AI updates will appear here." />
                ) : (
                  <ol className="divide-y divide-line">
                    {versions.map((version) => (
                      <li key={version.id} className="py-3 text-2xs">
                        <div className="flex items-center gap-2">
                          <span className="mono text-xs font-semibold text-ink">v{version.version}</span>
                          <span className="badge tone-neutral">
                            {version.author_type}
                          </span>
                          <span className="ml-auto text-ink-3">{formatDateTime(version.created_at)}</span>
                        </div>
                        <p className="mt-1.5 text-xs leading-relaxed text-ink-2">{version.change_summary ?? 'Clinical update'}</p>
                        {version.changed_sections?.length ? (
                          <p className="mono mt-1 text-ink-3">Sections: {version.changed_sections.join(', ')}</p>
                        ) : null}
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            )}

            {activeTab === 'info' && (
              <div className="space-y-3">
                <dl className="grid grid-cols-2 gap-2 text-2xs">
                  <Meta label="Patient ID" value={session.patient_id} />
                  <Meta label="Doctor" value={session.doctor_name ?? 'Dr. Clinician'} />
                  <Meta label="Encounter Type" value={session.simulation_type} />
                  <Meta label="Encounter Duration" value={formatDuration(session.duration_seconds)} />
                  <Meta label="Started" value={formatDateTime(session.started_at)} />
                  <Meta label="Ended" value={formatDateTime(session.ended_at)} />
                </dl>
                {session.scenario ? (
                  <div className="rounded-tile border border-aqua/40 bg-aqua-soft/60 px-3.5 py-3 text-2xs">
                    <p className="font-semibold text-ink-3">Scenario Context</p>
                    <p className="mt-1 text-xs leading-relaxed text-ink">{session.scenario}</p>
                  </div>
                ) : null}
              </div>
            )}
            </TabTransition>
          </div>
        </div>
      </div>

      {showApproveModal ? (
        <div className="modal-backdrop">
          <div className="modal max-w-md">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3 text-base font-semibold tracking-tight text-ink">
                <span className="icon-badge-soft">
                  <ShieldCheck className="h-5 w-5" />
                </span>
                Sign & Finalize Clinical Note
              </div>
              <button
                type="button"
                onClick={() => setShowApproveModal(false)}
                className="btn-icon btn-icon-sm"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>

            <div className="mt-5 space-y-4">
              <p className="text-[13px] leading-relaxed text-ink-2">
                You are approving documentation for <span className="font-semibold text-ink">Patient {session.patient_id}</span> ({session.reference}).
              </p>

              <label className="tile flex cursor-pointer items-start gap-3 p-4 text-[13px] leading-relaxed text-ink-2 transition hover:border-line-strong">
                <input
                  type="checkbox"
                  checked={acknowledged}
                  onChange={(event) => setAcknowledged(event.target.checked)}
                  className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer accent-brand"
                />
                <span>
                  I confirm that I have reviewed this note and its supporting evidence, and I accept clinical responsibility for this record.
                </span>
              </label>
            </div>

            <div className="mt-6 flex items-center justify-end gap-2.5">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setShowApproveModal(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn-primary"
                disabled={busy || !acknowledged}
                onClick={() => void approve()}
              >
                {busy ? <Spinner className="text-brand-fg" /> : <BadgeCheck className="h-4 w-4" />}
                Sign & Approve Note
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {evidenceFocus ? (
        <div className="pointer-events-none fixed inset-y-0 right-0 z-40 flex">
          <div className="pointer-events-auto flex">
            <EvidenceViewer
              sessionId={session.id}
              targetKey={evidenceFocus.targetKey}
              statement={evidenceFocus.statement}
              onClose={() => focusEvidence(null)}
              onHighlight={selectSegment}
            />
          </div>
        </div>
      ) : null}
    </div>
  )
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-tile bg-surface-2 px-3 py-2.5">
      <dt className="text-2xs font-medium text-ink-3">{label}</dt>
      <dd className="mt-0.5 truncate text-[13px] font-semibold text-ink">{value}</dd>
    </div>
  )
}
