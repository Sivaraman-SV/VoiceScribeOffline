import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Activity, AudioLines, FileText, Sparkles, Stethoscope } from 'lucide-react'

import { FlowStepper, ProcessingTheater, RecordingHero, RevealTranscript, useReveal } from '@/components/session/ConsultationFlow'
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

type MobileTab = 'transcript' | 'note' | 'findings'

const TRANSCRIBING_STAGES = ['AUDIO_PREPROCESSING', 'ASR', 'DIARIZATION', 'ROLE_ATTRIBUTION', 'TRANSCRIPT_ASSEMBLY']

function sectionText(value: unknown): string {
  if (typeof value === 'string') return value
  if (value && typeof value === 'object' && 'text' in value) return String((value as { text?: string }).text ?? '')
  return ''
}

function isMentioned(text: string): boolean {
  const trimmed = text.trim().toLowerCase()
  return trimmed.length > 0 && !trimmed.startsWith('not mentioned')
}

export function LiveSessionPage() {
  const { id } = useParams<{ id: string }>()
  const pushToast = useUiStore((state) => state.pushToast)

  const {
    session,
    segments,
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
  const [mobileTab, setMobileTab] = useState<MobileTab>('note')
  const [animateFlow, setAnimateFlow] = useState(false)

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
    setAnimateFlow(true)
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

    return Object.entries(map).filter(([, items]) => items.length > 0)
  }, [entities])

  const { mentionedSections, quietSections } = useMemo(() => {
    const record = (note?.content ?? {}) as unknown as Record<string, unknown>
    const mentioned: { key: NoteSectionKey; label: string; text: string }[] = []
    const quiet: string[] = []
    for (const key of SECTION_ORDER) {
      const label = SECTION_LABELS[key as NoteSectionKey] || key.replace(/_/g, ' ')
      const text = sectionText(record[key])
      if (isMentioned(text)) mentioned.push({ key: key as NoteSectionKey, label, text })
      else if (key in record) quiet.push(label)
    }
    return { mentionedSections: mentioned, quietSections: quiet }
  }, [note])

  const hasNoteContent = mentionedSections.length > 0

  const phase: 'capture' | 'processing' | 'report' = recorder.recording
    ? 'capture'
    : isProcessing
      ? 'processing'
      : hasNoteContent || segments.length > 0
        ? 'report'
        : 'capture'

  useEffect(() => {
    if (phase === 'processing') setAnimateFlow(true)
  }, [phase])

  const transcriptShown = useReveal(segments.length, 240, animateFlow)
  const transcriptDone = transcriptShown >= segments.length
  const sectionsShown = useReveal(
    phase === 'report' && transcriptDone ? mentionedSections.length : 0,
    420,
    animateFlow,
  )
  const sectionsDone = phase === 'report' && sectionsShown >= mentionedSections.length
  const entitiesShown = useReveal(sectionsDone ? entities.length : 0, 110, animateFlow)

  const flowStep =
    phase === 'processing'
      ? segments.length === 0 || TRANSCRIBING_STAGES.includes(stage)
        ? 1
        : 2
      : !transcriptDone
        ? 1
        : !sectionsDone
          ? 2
          : 3
  const reportReady = phase === 'report' && flowStep === 3

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

  const titleBlock = (
    <div className="min-w-0">
      <h1 className="truncate text-lg font-semibold tracking-tight text-ink md:text-xl">
        {session.name || 'Outpatient Consultation'}
      </h1>
      <p className="mt-0.5 truncate text-xs text-ink-3">
        <span className="mono">{session.reference}</span>
        {session.patient_name ? ` · ${session.patient_name}` : ''}
        {session.patient_id ? ` (${session.patient_id})` : ''}
      </p>
    </div>
  )

  const errorAlert = recorder.error ? (
    <div className="shrink-0 px-4 pb-3 md:px-6">
      <InlineAlert kind="error" title="Recording Error" onDismiss={recorder.clearError}>
        {recorder.error}
      </InlineAlert>
    </div>
  ) : null

  if (phase === 'capture') {
    return (
      <div className="flex h-full min-h-0 flex-col overflow-hidden bg-canvas text-ink">
        <header className="flex h-12 shrink-0 items-center justify-between gap-4 px-4 md:px-5">
          {titleBlock}
          {recorder.recording ? (
            <span className="badge tone-danger px-3 py-1 text-xs">
              <span className="h-1.5 w-1.5 rounded-full bg-tone-danger-fg animate-pulse-dot" />
              Recording
            </span>
          ) : null}
        </header>
        {errorAlert}
        <main className="grid min-h-0 flex-1 place-items-center overflow-hidden px-4 pb-4">
          <div key="hero" className="animate-scale-spring">
            <RecordingHero
              recording={recorder.recording}
              busy={recorder.busy}
              seconds={recorder.seconds}
              level={recorder.level}
              onToggle={recorder.recording ? () => void handleStopRecording() : () => void handleStartRecording()}
            />
          </div>
        </main>
      </div>
    )
  }

  if (phase === 'processing' && !hasNoteContent) {
    return (
      <div className="flex h-full min-h-0 flex-col overflow-hidden bg-canvas text-ink">
        <header className="flex h-12 shrink-0 items-center justify-between gap-4 px-4 md:px-5">
          {titleBlock}
        </header>
        {errorAlert}
        <main className="min-h-0 flex-1 overflow-hidden">
          <ProcessingTheater
            stage={stage}
            stageDetail={stageDetail}
            uploading={recorder.state === 'uploading'}
          />
        </main>
      </div>
    )
  }

  let entityCursor = 0

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-canvas text-ink">
      <header className="flex h-12 shrink-0 items-center gap-4 px-4 md:px-5">
        {titleBlock}
        <FlowStepper step={flowStep} className="hidden min-w-0 flex-1 md:flex" />
        <div className="ml-auto flex shrink-0 items-center gap-2">
          {reportReady ? (
            <button
              type="button"
              onClick={() => setVitalsModalOpen(true)}
              className="btn-secondary btn-sm"
              title="Dictate or enter patient vitals & medications"
            >
              <Activity className="h-3.5 w-3.5 text-brand" />
              <span className="hidden sm:inline">Vitals</span>
            </button>
          ) : null}
          <Link
            to={`/sessions/${session.id}/review`}
            className={cn('btn-sm', reportReady ? 'btn-primary' : 'btn-secondary')}
          >
            <FileText className="h-3.5 w-3.5" />
            <span>Review &amp; Approve</span>
          </Link>
        </div>
      </header>

      {errorAlert}

      <div className="shrink-0 px-4 pb-2 lg:hidden">
        <div className="seg flex w-full">
          {(
            [
              ['note', 'Clinical note'],
              ['transcript', `Transcript (${segments.length})`],
              ['findings', `Findings (${entities.length})`],
            ] as const
          ).map(([tab, label]) => (
            <button
              key={tab}
              type="button"
              onClick={() => setMobileTab(tab)}
              className={cn('seg-item flex-1 justify-center', mobileTab === tab && 'seg-item-active')}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 px-3 pb-3 md:px-4 md:pb-4 lg:grid-cols-[minmax(0,1.45fr)_minmax(0,0.9fr)]">
        <section className={cn('panel', mobileTab !== 'note' && 'hidden lg:flex')}>
          <div className="panel-header shrink-0">
            <div className="panel-title">
              <span className="grid h-7 w-7 place-items-center rounded-full bg-aqua-soft text-brand">
                <FileText className="h-3.5 w-3.5" />
              </span>
              Clinical analysis
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

          <div className="min-h-0 flex-1 overflow-y-auto p-4 md:p-5">
            {isProcessing && streamingSections ? (
              <StreamingNotePreview sections={streamingSections} />
            ) : isProcessing || (hasNoteContent && !transcriptDone) ? (
              <div className="flex h-full flex-col items-center justify-center">
                <ConsultationPipelineAnimation
                  stage={stage}
                  stageDetail={stageDetail}
                  isUploading={recorder.state === 'uploading'}
                  className="p-0"
                />
              </div>
            ) : hasNoteContent ? (
              <div className="space-y-3">
                <NoteFallbackBanner fallback={note?.content.fallback} />
                {mentionedSections.slice(0, sectionsShown).map((section) => (
                  <article key={section.key} className="animate-reveal rounded-tile border border-line bg-surface p-4">
                    <h3 className="mb-1.5 flex items-center gap-2 text-sm font-semibold tracking-tight text-ink">
                      <span className="h-4 w-1 rounded-full bg-aqua" />
                      {section.label}
                    </h3>
                    <p className="whitespace-pre-wrap text-[13.5px] leading-relaxed text-ink-2">{section.text}</p>
                  </article>
                ))}
                {sectionsShown < mentionedSections.length ? (
                  <div className="space-y-2 rounded-tile border border-dashed border-aqua/50 p-4" aria-hidden>
                    <div className="flex items-center gap-2 text-xs font-semibold text-brand">
                      <Sparkles className="h-3.5 w-3.5 animate-pulse" />
                      Writing {mentionedSections[sectionsShown]?.label ?? 'note'}…
                    </div>
                    <div className="shimmer-skeleton h-3 w-11/12 rounded-full" />
                    <div className="shimmer-skeleton h-3 w-8/12 rounded-full" />
                  </div>
                ) : quietSections.length > 0 ? (
                  <div className="animate-reveal rounded-tile bg-surface-2 p-3.5">
                    <p className="text-2xs font-semibold text-ink-3">Not discussed in this consultation</p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {quietSections.map((label) => (
                        <span key={label} className="chip text-2xs">
                          {label}
                        </span>
                      ))}
                    </div>
                  </div>
                ) : null}
                {entitiesShown > 0 ? (
                  <div className="hidden animate-reveal rounded-tile border border-line p-3 lg:block">
                    <p className="mb-2 text-2xs font-semibold text-ink-3">Clinical findings</p>
                    <div className="flex flex-wrap gap-1.5">
                      {entities.slice(0, entitiesShown).map((ent) => (
                        <span key={ent.id} className="chip text-2xs">
                          {ent.value || ent.ref}
                        </span>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="flex h-full flex-col items-center justify-center text-center">
                <div className="relative mb-4 grid h-16 w-16 place-items-center rounded-full bg-aqua-soft text-brand">
                  <FileText className="h-7 w-7" />
                </div>
                <h3 className="text-sm font-semibold text-ink">Your clinical note will appear here</h3>
                <p className="mt-1.5 max-w-xs text-xs leading-relaxed text-ink-3">
                  Once you stop recording, the conversation will be transcribed and structured into a clinical note.
                </p>
              </div>
            )}
          </div>
        </section>

        <section className={cn('panel', mobileTab !== 'transcript' && 'hidden lg:flex')}>
          <div className="panel-header shrink-0">
            <div className="panel-title">
              <span className="grid h-7 w-7 place-items-center rounded-full bg-aqua-soft text-brand">
                <AudioLines className="h-3.5 w-3.5" />
              </span>
              Transcript
            </div>
            {segments.length > 0 ? <span className="badge tone-neutral mono">{transcriptShown} lines</span> : null}
          </div>
          {segments.length === 0 ? (
            <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
              <div className="flex h-12 items-end gap-1" aria-hidden>
                {[0, 1, 2, 3, 4, 5, 6].map((bar) => (
                  <span
                    key={bar}
                    className="w-1.5 rounded-full bg-aqua animate-equalizer-1"
                    style={{ animationDelay: `${bar * 0.12}s` }}
                  />
                ))}
              </div>
              <div>
                <p className="text-sm font-semibold text-ink">
                  {isProcessing ? 'Transcribing Audio...' : 'No speech captured'}
                </p>
                <p className="mt-1 text-xs text-ink-3">
                  {isProcessing
                    ? 'Turning the recording into speaker-attributed dialogue'
                    : 'The conversation will appear here after recording.'}
                </p>
              </div>
            </div>
          ) : (
            <RevealTranscript segments={segments} shown={transcriptShown} className="min-h-0 flex-1 p-3" />
          )}
        </section>

        <section className={cn('panel', mobileTab === 'findings' ? 'flex lg:hidden' : 'hidden')}>
          <div className="panel-header shrink-0">
            <div className="panel-title">
              <span className="grid h-7 w-7 place-items-center rounded-full bg-aqua-soft text-brand">
                <Stethoscope className="h-3.5 w-3.5" />
              </span>
              Clinical findings
            </div>
            {entities.length > 0 ? <span className="badge tone-ai">{entities.length} Extracted</span> : null}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            {entities.length > 0 && entitiesShown > 0 ? (
              <div className="space-y-3">
                {groupedEntities.map(([groupTitle, items]) => {
                  const start = entityCursor
                  entityCursor += items.length
                  const visible = items.slice(0, Math.max(0, entitiesShown - start))
                  if (visible.length === 0) return null
                  return (
                    <div key={groupTitle} className="animate-reveal">
                      <h4 className="mb-2 flex items-center justify-between text-2xs font-semibold text-ink-3">
                        <span>{groupTitle}</span>
                        <span className="mono">{items.length}</span>
                      </h4>
                      <div className="flex flex-wrap gap-1.5">
                        {visible.map((ent) => (
                          <span
                            key={ent.id}
                            className="inline-flex animate-scale-spring items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-1 text-xs font-medium text-ink shadow-2xs"
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
                  )
                })}
              </div>
            ) : (
              <div className="flex h-full flex-col items-center justify-center p-4 text-center">
                <div
                  className={cn(
                    'relative mb-4 grid h-16 w-16 place-items-center rounded-full bg-aqua-soft text-brand',
                    phase === 'processing' || !sectionsDone ? 'border border-aqua/40' : undefined,
                  )}
                >
                  {phase === 'processing' || !sectionsDone ? (
                    <span className="absolute inset-0 rounded-full border border-aqua/40 animate-ring-out" aria-hidden />
                  ) : null}
                  <Activity className={cn('h-7 w-7', (phase === 'processing' || !sectionsDone) && 'animate-pulse')} />
                </div>
                <h3 className="text-sm font-semibold text-ink">
                  {phase === 'processing' || !sectionsDone ? 'Scanning Clinical Findings...' : 'No findings extracted'}
                </h3>
                <p className="mt-1.5 max-w-xs text-xs text-ink-3">
                  Symptoms, medications, allergies and examination findings are organised here.
                </p>
              </div>
            )}
          </div>
        </section>
      </div>

      <VitalsDictationModal
        open={vitalsModalOpen}
        onClose={() => setVitalsModalOpen(false)}
        onAddVitals={handleAddVitals}
      />
    </div>
  )
}
