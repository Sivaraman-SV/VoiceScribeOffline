import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  Activity,
  FileText,
  Mic,
  Sparkles,
  Square,
  Stethoscope,
} from 'lucide-react'

import { ConsultationPipelineAnimation } from '@/components/session/ConsultationPipelineAnimation'
import { NoteFallbackBanner, StreamingNotePreview } from '@/components/session/NoteStatusBlocks'
import { VitalsDictationModal } from '@/components/session/VitalsDictationModal'
import { InlineAlert } from '@/components/ui/primitives'
import { MedicalPulseLoader } from '@/components/ui/MedicalAnimations'
import { SECTION_LABELS, SECTION_ORDER } from '@/constants'
import { useAudioRecorder } from '@/hooks/useAudioRecorder'
import { api } from '@/services/api'
import { useSessionStore } from '@/store/sessionStore'
import { useUiStore } from '@/store/uiStore'
import type { NoteSectionKey } from '@/types'
import { cn } from '@/utils/cn'
import { formatDuration } from '@/utils/format'

export function LiveSessionPage() {
  const { id } = useParams<{ id: string }>()
  const pushToast = useUiStore((state) => state.pushToast)

  const {
    session,
    entities,
    note,
    stage,
    stageDetail,
    completed,
    loading,
    attach,
    detach,
    refresh,
    setSession,
    setNote,
    streamingSections,
  } = useSessionStore()

  const [loadError, setLoadError] = useState<string | null>(null)
  const [noteTab, setNoteTab] = useState<'draft' | 'final'>('draft')
  const [vitalsModalOpen, setVitalsModalOpen] = useState(false)

  const recorder = useAudioRecorder(id ?? null)

  useEffect(() => {
    if (!id) return
    attach(id).catch((error: Error) => setLoadError(error.message))
    return () => detach()
  }, [attach, detach, id])


  useEffect(() => {
    if (completed && session) {
      pushToast({
        kind: 'success',
        title: 'Session complete',
        detail: 'Open the review screen to verify evidence and approve the note.',
      })
    }
  }, [completed, pushToast, session])

  const handleStartRecording = async () => {
    if (!session) return
    try {
      if (session.status === 'CREATED') {
        const updated = await api.startSession(session.id)
        setSession(updated)
      }
      await recorder.start()
    } catch (err) {
      pushToast({ kind: 'error', title: 'Recording failed', detail: (err as Error).message })
    }
  }

  const handleStopRecording = async () => {
    try {
      await recorder.stop()
      await refresh()
    } catch (err) {
      pushToast({ kind: 'error', title: 'Could not stop recording', detail: (err as Error).message })
    }
  }

  const handleAddVitals = async (vitalsSummary: string, medsSummary: string) => {
    if (!session) return
    try {
      let currentNote = note
      if (!currentNote) {
        currentNote = await api.note(session.id)
        setNote(currentNote)
      }

      const content = currentNote.content as unknown as Record<string, { text?: string } | undefined>
      const changes: Partial<Record<NoteSectionKey, string>> = {}

      if (vitalsSummary) {
        const existing = content.physical_examination?.text?.trim() || ''
        const isPlaceholder = !existing || existing.toLowerCase() === 'not mentioned' || existing.toLowerCase().startsWith('not mentioned')
        changes.physical_examination = isPlaceholder ? `Vital signs: ${vitalsSummary}` : `${existing}. Vital signs: ${vitalsSummary}`
      }
      if (medsSummary) {
        const existing = content.current_medication?.text?.trim() || ''
        const isPlaceholder = !existing || existing.toLowerCase() === 'not mentioned' || existing.toLowerCase().startsWith('not mentioned')
        changes.current_medication = isPlaceholder ? medsSummary : `${existing}. ${medsSummary}`
      }

      if (Object.keys(changes).length > 0) {
        const updated = await api.editNote(currentNote.id, {
          ...changes,
          editor: 'Doctor (Dictation)',
        })
        setNote(updated)
        await refresh()
        pushToast({
          kind: 'success',
          title: 'Vitals & medications saved',
          detail: 'Updated Physical Examination & Medications in clinical note.',
        })
      }
    } catch (err) {
      pushToast({
        kind: 'error',
        title: 'Could not save vitals',
        detail: (err as Error).message,
      })
    }
  }

  const isProcessing = useMemo(() => {
    return (
      recorder.state === 'uploading' ||
      ['ASR', 'DIARIZATION', 'ROLE_ATTRIBUTION', 'TRANSCRIPT_ASSEMBLY', 'CLINICAL_NLP', 'LLM_STRUCTURING'].includes(
        stage,
      )
    )
  }, [recorder.state, stage])

  // Group entities by category
  const groupedEntities = useMemo(() => {
    const map: Record<string, typeof entities> = {
      Symptoms: [],
      'Medications & Treatments': [],
      Allergies: [],
      'Examination & Vitals': [],
      'Diagnoses & Assessment': [],
    }

    for (const ent of entities) {
      const type = String(ent.entity_type).toUpperCase()
      if (type.includes('SYMPTOM') || type.includes('COMPLAINT')) {
        map['Symptoms'].push(ent)
      } else if (type.includes('MEDIC') || type.includes('DRUG') || type.includes('TREATMENT') || type.includes('DOSE')) {
        map['Medications & Treatments'].push(ent)
      } else if (type.includes('ALLERG')) {
        map['Allergies'].push(ent)
      } else if (type.includes('EXAM') || type.includes('VITAL') || type.includes('SIGN')) {
        map['Examination & Vitals'].push(ent)
      } else {
        map['Diagnoses & Assessment'].push(ent)
      }
    }

    return Object.entries(map).filter(([_, items]) => items.length > 0)
  }, [entities])

  // Check if clinical note has any populated content
  const hasNoteContent = useMemo(() => {
    if (!note?.content) return false
    const content = note.content as unknown as Record<string, unknown>
    return Object.values(content).some((val) => {
      if (typeof val === 'string') return val.trim().length > 0
      if (typeof val === 'object' && val !== null && 'text' in val) {
        return Boolean((val as { text?: string }).text?.trim())
      }
      if (Array.isArray(val)) return val.length > 0
      return false
    })
  }, [note])

  if (loadError) {
    return (
      <div className="p-6">
        <InlineAlert kind="error" title="Could not load session">
          {loadError}
        </InlineAlert>
      </div>
    )
  }

  if (!session || loading) {
    return (
      <div className="flex h-full items-center justify-center p-12">
        <MedicalPulseLoader
          label="Connecting to Ambient Consultation..."
          sublabel="Establishing real-time clinical stream, audio diarization, and LLM synthesis"
        />
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-canvas text-ink">
      <header className="flex shrink-0 flex-col gap-4 px-5 pb-5 pt-6 sm:flex-row sm:items-end sm:justify-between md:px-8">
        <div className="min-w-0">
          <h1 className="truncate text-title text-ink">
            {session.name || 'Outpatient Consultation'}
          </h1>
          <p className="page-subtitle mt-1">
            Capture the conversation. Generate structured clinical notes.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 self-start sm:self-auto">
          <button
            type="button"
            onClick={() => setVitalsModalOpen(true)}
            className="btn-secondary"
            title="Dictate or enter patient vitals & medications"
          >
            <Activity className="h-4 w-4 text-brand" />
            <span>Dictate Vitals &amp; Meds</span>
          </button>

          <Link to={`/sessions/${session.id}/review`} className="btn-primary">
            <FileText className="h-4 w-4" />
            <span>Review &amp; Approve Note</span>
          </Link>
        </div>
      </header>

      {recorder.error && (
        <div className="shrink-0 px-5 pb-4 md:px-8">
          <InlineAlert kind="error" title="Recording Error" onDismiss={recorder.clearError}>
            {recorder.error}
          </InlineAlert>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-hidden px-5 pb-5 md:px-8 md:pb-8">
        <div className="grid h-full grid-cols-1 gap-5 md:grid-cols-3 lg:gap-6">
          <div className="card relative flex flex-col items-center justify-between overflow-y-auto p-7 text-center">
            <div className="flex w-full flex-col items-center">
              <div className="relative my-8 flex items-center justify-center">
                <div
                  className={cn(
                    'absolute -inset-8 rounded-full blur-2xl transition-all duration-700',
                    recorder.recording ? 'scale-125 bg-tone-danger-fg/20' : 'scale-100 bg-aqua/15',
                  )}
                />

                {recorder.recording && (
                  <>
                    <span className="absolute -inset-4 rounded-full border-2 border-tone-danger-fg/30 opacity-60 animate-ping" />
                    <span className="absolute -inset-9 rounded-full border border-tone-danger-fg/20 opacity-50 animate-pulse" />
                  </>
                )}

                <span className="absolute -right-2 -top-3 h-2 w-2 rounded-full bg-aqua animate-pulse" />
                <span className="absolute -left-5 top-8 h-2 w-2 rounded-full bg-aqua/70 animate-ping" />
                <span className="absolute -bottom-2 -right-4 h-2.5 w-2.5 rounded-full bg-lime" />
                <span className="absolute -left-4 bottom-6 h-1.5 w-1.5 rounded-full bg-aqua/80 animate-pulse" />

                <button
                  type="button"
                  onClick={recorder.recording ? () => void handleStopRecording() : () => void handleStartRecording()}
                  disabled={recorder.busy}
                  className={cn(
                    'relative grid h-28 w-28 select-none place-items-center rounded-full ring-8 transition-all duration-300 focus:outline-none focus-visible:ring-brand/30 disabled:cursor-not-allowed disabled:opacity-60',
                    recorder.recording
                      ? 'scale-105 bg-tone-danger-fg text-white shadow-raised ring-tone-danger-fg/15 dark:text-canvas'
                      : 'bg-brand text-brand-fg shadow-raised ring-brand/10 hover:scale-105 hover:bg-brand-hover',
                  )}
                  title={recorder.recording ? 'Click to stop recording' : 'Click to start recording'}
                >
                  <Mic className="h-11 w-11" />
                </button>
              </div>

              <h2
                className={cn(
                  'text-lg font-semibold tracking-tight',
                  recorder.recording ? 'mono text-tone-danger-fg' : 'text-ink',
                )}
              >
                {recorder.recording
                  ? `Recording... ${formatDuration(recorder.seconds)}`
                  : recorder.state === 'uploading'
                    ? 'Transcribing Audio...'
                    : 'Ready to Record'}
              </h2>
              <p className="mt-1 text-xs text-ink-3">
                Capture your consultation naturally
              </p>

              <div className="mt-6">
                {recorder.recording ? (
                  <button
                    type="button"
                    onClick={() => void handleStopRecording()}
                    disabled={recorder.busy}
                    className="btn-danger btn-lg min-w-[11rem]"
                  >
                    <Square className="h-3 w-3 fill-current" />
                    <span>Stop Recording</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => void handleStartRecording()}
                    disabled={recorder.busy}
                    className="btn-primary btn-lg min-w-[11rem]"
                  >
                    <Mic className="h-4 w-4" />
                    <span>Start Recording</span>
                  </button>
                )}
              </div>
            </div>

            <div className="mt-8 flex w-full flex-col items-center">
              <div className="flex h-8 w-full max-w-[240px] items-center justify-center gap-1 px-2">
                {[40, 60, 90, 45, 80, 100, 70, 30, 85, 95, 60, 40, 75, 90, 50, 65, 80, 40, 70, 95, 55, 35, 60, 80, 45, 60, 30].map(
                  (h, i) => (
                    <span
                      key={i}
                      className={cn(
                        'w-1 rounded-full transition-all duration-150',
                        recorder.recording ? 'bg-tone-danger-fg/80' : 'bg-line-strong',
                      )}
                      style={{
                        height: recorder.recording
                          ? `${Math.max(6, Math.min(32, Math.round((h / 100) * (20 + (i % 3) * 6))))}px`
                          : '6px',
                        animation: recorder.recording
                          ? `pulse ${0.4 + (i % 5) * 0.15}s infinite alternate`
                          : undefined,
                      }}
                    />
                  ),
                )}
              </div>

              <p className="mt-4 text-2xs font-medium text-ink-3">
                Audio will be transcribed after you stop recording
              </p>
            </div>
          </div>

          <div className="panel">
            <div className="panel-header shrink-0">
              <div className="panel-title">
                <span className="grid h-7 w-7 place-items-center rounded-full bg-aqua-soft text-brand">
                  <FileText className="h-3.5 w-3.5" />
                </span>
                <span className="text-xs tracking-[0.06em]">
                  CLINICAL NOTES
                </span>
              </div>

              <div className="seg p-0.5">
                <button
                  type="button"
                  onClick={() => setNoteTab('draft')}
                  className={cn('seg-item px-3 py-1 text-2xs', noteTab === 'draft' && 'seg-item-active')}
                >
                  Draft Note
                </button>
                <button
                  type="button"
                  onClick={() => setNoteTab('final')}
                  className={cn('seg-item px-3 py-1 text-2xs', noteTab === 'final' && 'seg-item-active')}
                >
                  Final Note
                </button>
              </div>
            </div>

            <div className="flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto p-5">
              {isProcessing && streamingSections ? (
                <div className="h-full w-full">
                  <StreamingNotePreview sections={streamingSections} />
                </div>
              ) : isProcessing ? (
                <ConsultationPipelineAnimation
                  stage={stage}
                  stageDetail={stageDetail}
                  isUploading={recorder.state === 'uploading'}
                />
              ) : hasNoteContent ? (
                <div className="h-full w-full space-y-3 text-left animate-fade-in">
                  <NoteFallbackBanner fallback={note?.content.fallback} />
                  {SECTION_ORDER.map((key) => {
                    const contentRecord = note?.content as unknown as Record<string, unknown> | undefined
                    const sectionContent = contentRecord?.[key] as { text?: string } | string | undefined
                    if (!sectionContent) return null
                    const text =
                      typeof sectionContent === 'object' && sectionContent !== null && 'text' in sectionContent
                        ? sectionContent.text
                        : String(sectionContent)
                    if (!text?.trim()) return null
                    const label = SECTION_LABELS[key as NoteSectionKey] || key.replace(/_/g, ' ')
                    return (
                      <div key={key} className="tile bg-surface-2/70 p-4">
                        <h4 className="mb-1.5 flex items-center gap-2 text-2xs font-semibold uppercase tracking-[0.06em] text-brand">
                          <span className="h-1.5 w-1.5 rounded-full bg-aqua" />
                          {label}
                        </h4>
                        <div className="whitespace-pre-wrap text-[13px] leading-relaxed text-ink-2">
                          {text}
                        </div>
                      </div>
                    )
                  })}
                </div>
              ) : (
                <div className="flex max-w-xs select-none flex-col items-center text-center animate-fade-in">
                  <div className="relative mb-5 grid h-20 w-20 place-items-center rounded-full bg-aqua-soft text-brand">
                    <FileText className="h-8 w-8" />
                    <span className="absolute -right-1 -top-1 grid h-7 w-7 place-items-center rounded-full bg-lime text-lime-fg ring-4 ring-surface">
                      <Sparkles className="h-3.5 w-3.5" />
                    </span>
                  </div>
                  <h3 className="text-sm font-semibold text-ink">
                    Your clinical note will appear here
                  </h3>
                  <p className="mt-1.5 text-xs leading-relaxed text-ink-3">
                    Once you stop recording, the conversation will be transcribed and structured into a clinical note.
                  </p>
                </div>
              )}
            </div>
          </div>

          <div className="panel">
            <div className="panel-header shrink-0">
              <div className="panel-title">
                <span className="grid h-7 w-7 place-items-center rounded-full bg-aqua-soft text-brand">
                  <Stethoscope className="h-3.5 w-3.5" />
                </span>
                <span className="text-xs tracking-[0.06em]">
                  CLINICAL FINDINGS
                </span>
              </div>
              {entities.length > 0 && (
                <span className="badge tone-ai">
                  {entities.length} Extracted
                </span>
              )}
            </div>

            <div className="flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto p-5">
              {isProcessing ? (
                <div className="flex select-none flex-col items-center p-6 text-center animate-fade-in">
                  <div className="relative mb-5 grid h-20 w-20 place-items-center rounded-full border border-aqua/40 bg-aqua-soft text-brand">
                    <span className="absolute -inset-1.5 rounded-full border border-aqua/30 opacity-40 animate-ping" />
                    <Activity className="h-8 w-8 animate-pulse" />
                  </div>
                  <h3 className="text-sm font-semibold text-ink">
                    Scanning Clinical Findings...
                  </h3>
                  <p className="mt-1.5 max-w-xs text-xs text-ink-3">
                    Extracting symptoms, medications, and examination metrics from dialogue
                  </p>
                </div>
              ) : entities.length > 0 ? (
                <div className="h-full w-full space-y-3 text-left animate-fade-in">
                  {groupedEntities.map(([groupTitle, items]) => (
                    <div key={groupTitle} className="tile bg-surface-2/70 p-4">
                      <h4 className="mb-2.5 flex items-center justify-between text-2xs font-semibold uppercase tracking-[0.06em] text-ink-3">
                        <span>{groupTitle}</span>
                        <span className="mono">({items.length})</span>
                      </h4>
                      <div className="flex flex-wrap gap-1.5">
                        {items.map((ent) => (
                          <span
                            key={ent.id}
                            className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-1 text-xs font-medium text-ink shadow-2xs"
                          >
                            <span>{ent.value || ent.ref}</span>
                            {ent.confidence ? (
                              <span className="mono text-2xs font-semibold text-brand">
                                {Math.round(ent.confidence * 100)}%
                              </span>
                            ) : null}
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex max-w-xs select-none flex-col items-center text-center animate-fade-in">
                  <div className="relative mb-5 grid h-20 w-20 place-items-center rounded-full bg-aqua-soft text-brand">
                    <Activity className="h-8 w-8" />
                    <span className="absolute -right-1 -top-1 grid h-7 w-7 place-items-center rounded-full bg-lime text-lime-fg ring-4 ring-surface">
                      <Sparkles className="h-3.5 w-3.5" />
                    </span>
                  </div>
                  <h3 className="text-sm font-semibold text-ink">
                    Key clinical information will appear here
                  </h3>
                  <p className="mt-1.5 text-xs leading-relaxed text-ink-3">
                    Symptoms, medications, allergies, examination findings and other relevant details will be organized here.
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Vitals Dictation & Entry Modal */}
      <VitalsDictationModal
        open={vitalsModalOpen}
        onClose={() => setVitalsModalOpen(false)}
        onAddVitals={handleAddVitals}
      />
    </div>
  )
}
