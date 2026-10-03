import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ClipboardCheck, MonitorUp, Square, Video } from 'lucide-react'

import { ClinicalNotePanel } from '@/components/session/ClinicalNotePanel'
import { EvidenceViewer } from '@/components/session/EvidenceViewer'
import { IntelligencePanel } from '@/components/session/IntelligencePanel'
import { SpeakerRoster } from '@/components/session/SpeakerRoster'
import { TranscriptPanel } from '@/components/session/TranscriptPanel'
import { InlineAlert, Panel, Spinner } from '@/components/ui/primitives'
import { ENCOUNTER_TYPES } from '@/constants'
import { useMeetTabCapture } from '@/hooks/useMeetTabCapture'
import { api } from '@/services/api'
import { useSessionStore } from '@/store/sessionStore'
import { useUiStore } from '@/store/uiStore'
import { cn } from '@/utils/cn'
import { formatDuration } from '@/utils/format'

const DEFAULTS = {
  name: 'Google Meet session',
  patient_id: 'SIM-PT-GMEET',
  scenario: 'Remote doctor–patient encounter captured from Google Meet',
  simulation_type: 'OUTPATIENT',
  doctor_name: 'Dr. A. Rao',
}

/**
 * Standalone Google Meet capture. Creates a normal UPLOAD session and sends the
 * captured WAV through the existing transcription pipeline — no backend changes.
 */
export function GMeetRecordPage() {
  const navigate = useNavigate()
  const pushToast = useUiStore((state) => state.pushToast)
  const identityName = useUiStore((state) => state.identityName)

  const [form, setForm] = useState({ ...DEFAULTS, doctor_name: DEFAULTS.doctor_name })
  const [creating, setCreating] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const previewRef = useRef<HTMLVideoElement>(null)

  const {
    session,
    segments,
    speakers,
    entities,
    note,
    evidence,
    stage,
    stageDetail,
    errors,
    selectedSegmentRef,
    evidenceFocus,
    attach,
    detach,
    refresh,
    selectSegment,
    focusEvidence,
    dismissError,
  } = useSessionStore()

  const capture = useMeetTabCapture(session?.id ?? null)

  useEffect(() => {
    return () => detach()
  }, [detach])

  useEffect(() => {
    const node = previewRef.current
    if (!node) return
    node.srcObject = capture.previewStream
    return () => {
      node.srcObject = null
    }
  }, [capture.previewStream])

  const highlightedRefs = useMemo(() => {
    if (!evidenceFocus) return []
    return evidence
      .filter((link) => link.target_key === evidenceFocus.targetKey && link.segment_ref)
      .map((link) => link.segment_ref as string)
  }, [evidence, evidenceFocus])

  const update = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((previous) => ({ ...previous, [key]: event.target.value }))

  const createSession = async () => {
    setCreating(true)
    setFormError(null)
    try {
      const created = await api.createSession({
        name: form.name.trim(),
        patient_id: form.patient_id.trim(),
        scenario: form.scenario.trim() || null,
        simulation_type: form.simulation_type,
        doctor_name: form.doctor_name.trim() || identityName,
        faculty_name: null,
        mode: 'UPLOAD',
        audio_source: 'UPLOAD',
      })
      await api.startSession(created.id)
      await attach(created.id)
      pushToast({
        kind: 'success',
        title: `${created.reference} ready`,
        detail: 'Share the Google Meet tab to begin recording.',
      })
    } catch (err) {
      setFormError((err as Error).message)
    } finally {
      setCreating(false)
    }
  }

  const onStopCapture = useCallback(async () => {
    await capture.stop()
    await refresh()
  }, [capture, refresh])

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-canvas text-ink">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="page-inner space-y-5">
          <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div className="flex min-w-0 items-center gap-4">
              <span className="icon-badge h-12 w-12">
                <Video className="h-5 w-5" aria-hidden />
              </span>
              <div className="min-w-0">
                <h1 className="page-title">Record Google Meet</h1>
                <p className="page-subtitle mt-1 max-w-2xl">
                  Capture the Meet tab, then process it through the same transcript → note → evidence pipeline.
                </p>
              </div>
            </div>
            {session ? (
              <Link to={`/sessions/${session.id}/review`} className="btn-primary">
                <ClipboardCheck className="h-4 w-4" aria-hidden />
                Review & Approve
              </Link>
            ) : null}
          </header>
          <InlineAlert kind="info" title="How to capture a Meet">
            Open the Google Meet in Chrome or Edge. After the session is created, click Share Meet tab, select that tab,
            and tick <strong>Share tab audio</strong>. Keep this window open until you press Stop.
          </InlineAlert>

          {!session ? (
            <Panel title="Session details" bodyClassName="grid gap-4 p-5 sm:grid-cols-2">
              {formError ? (
                <div className="sm:col-span-2">
                  <InlineAlert kind="error" title="Could not create session" onDismiss={() => setFormError(null)}>
                    {formError}
                  </InlineAlert>
                </div>
              ) : null}
              <label className="sm:col-span-2">
                <span className="field-label">Session name</span>
                <input className="field-input" value={form.name} onChange={update('name')} />
              </label>
              <label>
                <span className="field-label">Patient ID</span>
                <input className="field-input mono" value={form.patient_id} onChange={update('patient_id')} />
              </label>
              <label>
                <span className="field-label">Encounter type</span>
                <select className="field-input" value={form.simulation_type} onChange={update('simulation_type')}>
                  {ENCOUNTER_TYPES.map((type) => (
                    <option key={type.value} value={type.value}>
                      {type.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="sm:col-span-2">
                <span className="field-label">Scenario</span>
                <input className="field-input" value={form.scenario} onChange={update('scenario')} />
              </label>
              <label>
                <span className="field-label">Doctor</span>
                <input className="field-input" value={form.doctor_name} onChange={update('doctor_name')} />
              </label>
              <div className="flex justify-end border-t border-line pt-4 sm:col-span-2">
                <button
                  type="button"
                  className="btn-primary btn-lg"
                  disabled={creating || !form.name.trim() || !form.patient_id.trim()}
                  onClick={() => void createSession()}
                >
                  {creating ? <Spinner className="text-brand-fg" /> : <MonitorUp className="h-4 w-4" aria-hidden />}
                  Create session
                </button>
              </div>
            </Panel>
          ) : (
            <Panel title="Meet capture" bodyClassName="space-y-4 p-5">
              <div className="flex flex-wrap items-center gap-2.5">
                <span className="badge tone-brand mono">{session.reference}</span>
                <span className="text-sm font-medium text-ink-2">{session.name}</span>
              </div>

              {capture.error ? (
                <InlineAlert kind="error" title="Capture error" onDismiss={capture.clearError}>
                  {capture.error}
                </InlineAlert>
              ) : null}

              {errors.map((item) => (
                <InlineAlert
                  key={item.code}
                  kind="warning"
                  title={item.code}
                  onDismiss={() => dismissError(item.code)}
                >
                  {item.message}
                </InlineAlert>
              ))}

              <div
                className={cn(
                  'flex items-center gap-2 rounded-tile border px-3.5 py-2.5 text-xs font-medium',
                  capture.micConnected ? 'tone-success' : 'tone-warning',
                )}
              >
                <span
                  className={cn(
                    'inline-block h-2 w-2 shrink-0 rounded-full',
                    capture.micConnected ? 'bg-tone-success-fg' : 'bg-tone-warning-fg',
                  )}
                />
                <span>
                  {capture.micConnected
                    ? 'Microphone connected — your voice is being recorded'
                    : capture.recording
                      ? 'Microphone not connected — only Meet tab audio is being recorded'
                      : 'Microphone will be captured automatically when recording starts'}
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  className={cn(capture.recording ? 'btn-danger' : 'btn-teal')}
                  disabled={session.status !== 'LIVE' || capture.busy}
                  onClick={() => (capture.recording ? void onStopCapture() : void capture.start())}
                >
                  {capture.state === 'uploading' ? (
                    <Spinner />
                  ) : capture.recording ? (
                    <Square className="h-4 w-4" aria-hidden />
                  ) : (
                    <Video className="h-4 w-4" aria-hidden />
                  )}
                  {capture.state === 'requesting'
                    ? 'Waiting for tab picker…'
                    : capture.state === 'uploading'
                      ? 'Transcribing Meet audio…'
                      : capture.recording
                        ? `Stop & transcribe · ${formatDuration(capture.seconds)}`
                        : 'Share Meet tab'}
                </button>
                {capture.recording ? (
                  <>
                    <span className="chip">
                      <span className="h-2 w-2 animate-pulse rounded-full bg-tone-danger-fg" aria-hidden />
                      Level
                      <span className="relative h-1.5 w-24 overflow-hidden rounded-full bg-surface-3">
                        <span
                          className="absolute inset-y-0 left-0 rounded-full bg-aqua"
                          style={{ width: `${Math.min(100, Math.round(capture.level * 160))}%` }}
                        />
                      </span>
                    </span>
                    <button type="button" className="btn-secondary" onClick={capture.cancel}>
                      Discard
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => {
                      capture.cancel()
                      void api.stopSession(session.id).then((stopped) => navigate(`/sessions/${stopped.id}/review`))
                    }}
                  >
                    End session
                  </button>
                )}
              </div>

              {capture.previewStream ? (
                <video
                  ref={previewRef}
                  className="h-44 w-full rounded-tile border border-line bg-black object-contain"
                  muted
                  autoPlay
                  playsInline
                  aria-label="Shared Meet tab preview"
                />
              ) : null}
            </Panel>
          )}

          {session ? (
            <div className="grid min-h-[28rem] grid-cols-1 gap-4 lg:grid-cols-3">
              <TranscriptPanel
                segments={segments}
                speakers={speakers}
                evidence={evidence}
                selectedRef={selectedSegmentRef}
                highlightedRefs={highlightedRefs}
                live={capture.recording}
                onSelect={selectSegment}
              />
              <ClinicalNotePanel
                note={note}
                changedSections={[]}
                onShowSource={(targetKey, statement) => focusEvidence({ targetKey, statement, kind: 'SECTION' })}
              />
              <div className="flex min-h-0 flex-col gap-4">
                <IntelligencePanel
                  entities={entities}
                  stage={stage}
                  stageDetail={stageDetail}
                  onShowSource={(targetKey, statement) => focusEvidence({ targetKey, statement, kind: 'ENTITY' })}
                />
                <SpeakerRoster speakers={speakers} onChanged={() => void refresh()} />
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {session && evidenceFocus ? (
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
