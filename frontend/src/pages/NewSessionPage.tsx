import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ClipboardPlus, Cpu, Mic, PlayCircle, Stethoscope } from 'lucide-react'

import { ActiveEngines } from '@/components/system/ActiveEngines'
import { Card, CardHeader, PageHeader, Spinner } from '@/components/ui/primitives'
import { ENCOUNTER_TYPES } from '@/constants'
import { api } from '@/services/api'
import { useAuthStore } from '@/store/authStore'
import { useUiStore } from '@/store/uiStore'
import type { SystemStatus } from '@/types'

const DEFAULTS = {
  name: 'Consultation',
  patient_id: 'PT-1042',
  patient_name: '',
  scenario: '',
  simulation_type: 'OUTPATIENT',
  doctor_name: '',
}

export function NewSessionPage() {
  const navigate = useNavigate()
  const pushToast = useUiStore((state) => state.pushToast)
  const user = useAuthStore((state) => state.user)
  const identityName = useUiStore((state) => state.identityName)

  const activeDoctorName = user?.full_name
    ? (user.full_name.startsWith('Dr.') ? user.full_name : `Dr. ${user.full_name}`)
    : (identityName || 'Dr. A. Rao')

  const [form, setForm] = useState({ ...DEFAULTS, doctor_name: activeDoctorName })
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<SystemStatus | null>(null)

  useEffect(() => {
    api.status().then(setStatus).catch(() => setStatus(null))
  }, [])

  // Standard clinical encounters only (filtered from non-clinical presets)
  const clinicalEncounterTypes = useMemo(() => {
    return ENCOUNTER_TYPES.filter((t) => t.value !== 'MEETING' && t.value !== 'MDT')
  }, [])

  const update = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((previous) => ({ ...previous, [key]: event.target.value }))

  const submit = async (autoStart: boolean) => {
    setSubmitting(true)
    setError(null)
    const consultationTitle = form.patient_name.trim()
      ? `${form.patient_name.trim()} - Consultation`
      : form.name.trim() || 'Consultation'

    try {
      const session = await api.createSession({
        name: consultationTitle,
        patient_id: form.patient_id.trim() || 'PT-1042',
        patient_name: form.patient_name.trim() || null,
        scenario: form.scenario.trim() || null,
        simulation_type: form.simulation_type,
        doctor_name: activeDoctorName,
        faculty_name: null,
        mode: 'MICROPHONE',
        audio_source: 'MICROPHONE',
      })
      if (autoStart) {
        await api.startSession(session.id)
        pushToast({
          kind: 'success',
          title: `${session.reference} started`,
          detail: status ? `Note model: ${status.ai.model}` : undefined,
        })
      } else {
        pushToast({ kind: 'success', title: `${session.reference} created` })
      }
      navigate(`/sessions/${session.id}/live`)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="page">
      <div className="page-inner max-w-6xl py-5 md:py-6">
        <PageHeader
          title="New Clinical Consultation"
          subtitle="Enter patient details and start ambient documentation."
        />

        {error ? (
          <div className="rounded-tile border px-4 py-3 text-xs tone-danger">
            {error}
          </div>
        ) : null}

        <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="space-y-5">
            <Card>
              <CardHeader
                title="Consultation Details"
                subtitle="Patient identity and encounter context"
                icon={<ClipboardPlus className="h-4 w-4" aria-hidden />}
              />
              <div className="grid gap-4 px-5 pb-5 pt-2 sm:grid-cols-2">
                <label>
                  <span className="field-label">Patient Name *</span>
                  <input
                    className="field-input"
                    value={form.patient_name}
                    onChange={update('patient_name')}
                    placeholder="e.g. Ramesh Kumar"
                    required
                    autoFocus
                  />
                </label>

                <label>
                  <span className="field-label">Patient ID / MRN *</span>
                  <input
                    className="field-input mono"
                    value={form.patient_id}
                    onChange={update('patient_id')}
                    placeholder="e.g. PT-1042"
                    required
                  />
                </label>

                <label className="sm:col-span-2">
                  <span className="field-label">Consultation Type</span>
                  <select className="field-input" value={form.simulation_type} onChange={update('simulation_type')}>
                    {clinicalEncounterTypes.map((type) => (
                      <option key={type.value} value={type.value}>
                        {type.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="sm:col-span-2">
                  <span className="field-label">Clinical Scenario / Chief Concern (Optional)</span>
                  <input
                    className="field-input"
                    value={form.scenario}
                    onChange={update('scenario')}
                    placeholder="Brief context (e.g. Follow-up for chest discomfort and hypertension)"
                  />
                </label>

                <div className="tile flex items-center justify-between gap-3 px-4 py-3 sm:col-span-2">
                  <span className="flex items-center gap-2.5 text-xs text-ink-3">
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-lime text-lime-fg">
                      <Stethoscope className="h-4 w-4" aria-hidden />
                    </span>
                    <span>Attending Clinician:</span>
                  </span>
                  <span className="text-[13px] font-semibold text-brand">{activeDoctorName}</span>
                </div>
              </div>
            </Card>

            <div className="card flex flex-wrap items-center justify-end gap-2.5 px-5 py-4">
              <button
                type="button"
                className="btn-primary btn-lg"
                disabled={submitting || !form.patient_name.trim()}
                onClick={() => void submit(true)}
              >
                {submitting ? <Spinner className="text-brand-fg" /> : <PlayCircle className="h-4 w-4" aria-hidden />}
                Start Consultation
              </button>
              <button
                type="button"
                className="btn-secondary btn-lg"
                disabled={submitting || !form.patient_name.trim()}
                onClick={() => void submit(false)}
              >
                Save as Draft
              </button>
            </div>
          </div>

          <div className="space-y-5 lg:sticky lg:top-6">
            <Card>
              <CardHeader title="Microphone" icon={<Mic className="h-4 w-4" aria-hidden />} />
              <ul className="ml-4 list-disc space-y-2 px-5 pb-5 pt-1 text-xs leading-relaxed text-ink-2 marker:text-ink-3">
                <li>Click <strong className="text-ink">Start Consultation</strong> to open the recording workspace.</li>
                <li>Tap the microphone when you are ready. That is the only recording control.</li>
                <li>Tap it again to stop. The transcript and clinical note then appear on the same screen.</li>
              </ul>
            </Card>

            <Card>
              <CardHeader title="AI engines on this server" icon={<Cpu className="h-4 w-4" aria-hidden />} />
              <div className="px-5 pb-5">
                <ActiveEngines status={status} />
                <p className="field-hint">
                  Models are set in the server <code className="mono">.env</code> (the Kaggle runner), not per consultation.
                </p>
              </div>
            </Card>
          </div>
        </div>
      </div>
    </div>
  )
}
