import { useEffect, useState } from 'react'
import { Activity, CheckCircle2, Cpu, Save, Server, ShieldAlert, TestTube2, UserCog, XCircle } from 'lucide-react'

import { ActiveEngines } from '@/components/system/ActiveEngines'
import { InlineAlert, PageHeader, Panel, Spinner, StatusDot } from '@/components/ui/primitives'
import { api } from '@/services/api'
import { useUiStore } from '@/store/uiStore'
import type { SystemStatus } from '@/types'
import { cn } from '@/utils/cn'

const ROLES = ['DOCTOR', 'STUDENT', 'FACULTY', 'ADMIN']

export function SettingsPage() {
  const { identityEmail, identityRole, identityName, setIdentity, pushToast } = useUiStore()
  const [email, setEmail] = useState(identityEmail)
  const [role, setRole] = useState(identityRole)
  const [name, setName] = useState(identityName)

  const [status, setStatus] = useState<SystemStatus | null>(null)
  const [aiCheck, setAiCheck] = useState<Record<string, unknown> | null>(null)
  const [checking, setChecking] = useState(false)
  const [metrics, setMetrics] = useState<Record<string, number> | null>(null)

  useEffect(() => {
    api.status().then(setStatus).catch(() => setStatus(null))
    api
      .metrics()
      .then((response) => setMetrics(response.counters))
      .catch(() => setMetrics(null))
  }, [])

  const runAiCheck = async () => {
    setChecking(true)
    try {
      const result = await api.checkAi()
      setAiCheck(result)
      pushToast({
        kind: result.ok ? 'success' : 'warning',
        title: result.ok ? 'AI provider reachable' : 'AI provider unavailable',
        detail: String(result.detail ?? result.message ?? ''),
      })
    } catch (error) {
      pushToast({ kind: 'error', title: 'AI check failed', detail: (error as Error).message })
    } finally {
      setChecking(false)
    }
  }

  return (
    <div className="page">
      <div className="page-inner max-w-5xl">
        <PageHeader
          title="Settings"
          subtitle={
            <>
              Runtime configuration lives in the backend <code className="mono">.env</code>. This screen shows the
              effective configuration and lets you switch the development identity used for RBAC and audit logging.
            </>
          }
        />

        <Panel
          title="Development identity"
          icon={<UserCog className="h-4 w-4" aria-hidden />}
          bodyClassName="grid gap-4 p-5 sm:grid-cols-3"
        >
          <label>
            <span className="field-label">Display name</span>
            <input className="field-input" value={name} onChange={(event) => setName(event.target.value)} />
          </label>
          <label>
            <span className="field-label">Email</span>
            <input className="field-input" value={email} onChange={(event) => setEmail(event.target.value)} />
          </label>
          <label>
            <span className="field-label">Role</span>
            <select className="field-input" value={role} onChange={(event) => setRole(event.target.value)}>
              {ROLES.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
          <div className="flex flex-col gap-3 border-t border-line pt-4 sm:col-span-3 sm:flex-row sm:items-center">
            <button
              type="button"
              className="btn-primary"
              onClick={() => {
                setIdentity(email.trim(), role, name.trim() || email.trim())
                pushToast({ kind: 'success', title: 'Identity updated', detail: `${name} · ${role}` })
              }}
            >
              <Save className="h-4 w-4" aria-hidden />
              Save identity
            </button>
            <p className="text-xs leading-relaxed text-ink-3">
              Sent as <code className="mono">X-User-Email</code> / <code className="mono">X-User-Role</code>. Only DOCTOR
              and FACULTY roles can approve clinical documentation.
            </p>
          </div>
        </Panel>

        <Panel title="Pipeline" icon={<Cpu className="h-4 w-4" aria-hidden />} bodyClassName="space-y-4 p-5">
          <ActiveEngines status={status} />
          <p className="text-xs text-ink-2">
            Invented medicines and diagnoses are dropped if they are not in the transcript.
          </p>

          {status?.pipeline ? (
            <ol className="tile space-y-2 p-4 text-xs text-ink-2 [&_span]:text-ink">
              <li>
                <span className="font-semibold">1. Capture</span> — {status.pipeline.audio}
              </li>
              <li>
                <span className="font-semibold">2. Transcribe</span> — {status.pipeline.asr}
                {status.pipeline.asr_second_pass && status.pipeline.asr_second_pass !== 'off'
                  ? ` + ${status.pipeline.asr_second_pass}`
                  : ''}
              </li>
              <li>
                <span className="font-semibold">3. Speakers</span> — {status.pipeline.diarization}
              </li>
              <li>
                <span className="font-semibold">4. Note</span> — {status.pipeline.llm}
              </li>
              <li>
                <span className="font-semibold">5. Ground</span> — {status.pipeline.grounding}
              </li>
            </ol>
          ) : (
            <p className="text-xs text-ink-3">Load the backend to see the live pipeline.</p>
          )}

          {status?.pipeline?.llm_server ? (
            <InlineAlert kind="info" title={`LLM server: ${status.pipeline.llm_server}`}>
              Model fallback chain: {status.pipeline.llm_fallback_chain}
            </InlineAlert>
          ) : null}

          <dl className="grid gap-2 text-xs sm:grid-cols-2">
            {status
              ? Object.entries(status.ai).map(([key, value]) => (
                  <div key={key} className="flex items-baseline gap-2 rounded-control bg-surface-2 px-3 py-2">
                    <dt className="shrink-0 text-xs font-medium text-ink-3">{key}</dt>
                    <dd className="mono ml-auto truncate text-ink">{String(value)}</dd>
                  </div>
                ))
              : null}
          </dl>

          <div className="flex flex-wrap items-center gap-3">
            <button type="button" className="btn-secondary" onClick={() => void runAiCheck()} disabled={checking}>
              {checking ? <Spinner /> : <TestTube2 className="h-4 w-4" aria-hidden />}
              Test local LLM (Ollama)
            </button>
            {aiCheck ? (
              <span
                className={cn('badge py-1', aiCheck.ok ? 'tone-success' : 'tone-warning')}
              >
                {aiCheck.ok ? (
                  <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
                ) : (
                  <XCircle className="h-3.5 w-3.5" aria-hidden />
                )}
                {String(aiCheck.detail ?? aiCheck.message ?? (aiCheck.ok ? 'Reachable' : 'Unavailable'))}
              </span>
            ) : null}
          </div>
        </Panel>

        <Panel
          title="Pipeline providers"
          icon={<Server className="h-4 w-4" aria-hidden />}
          bodyClassName="grid gap-3 p-5 sm:grid-cols-2"
        >
          <ProviderCard
            title="ASR"
            name={status?.providers.asr.name ?? '—'}
            mock={Boolean(status?.providers.asr.mock)}
            detail="Runs on the backend machine (your Kaggle GPU when using the runner). Details above."
          />
          <ProviderCard
            title="Diarization"
            name={status?.providers.diarization.name ?? '—'}
            mock={Boolean(status?.providers.diarization.mock)}
            detail="Two-speaker (doctor / patient) labelling from the transcript text."
          />
          <ProviderCard
            title="Terminology"
            name={String(status?.providers.terminology?.name ?? 'mock')}
            mock
            detail="SNOMED CT / ICD-10 / RxNorm / LOINC interfaces are defined; codes are never fabricated."
          />
          <ProviderCard
            title="Database"
            name={status?.database.dialect ?? '—'}
            mock={Boolean(status?.database.using_fallback)}
            detail={status?.database.using_fallback ? 'Running on the SQLite development fallback.' : 'PostgreSQL connected.'}
          />
        </Panel>

        {metrics ? (
          <Panel title="Counters" icon={<Activity className="h-4 w-4" aria-hidden />} bodyClassName="p-5">
            <dl className="grid gap-x-6 gap-y-0 text-xs sm:grid-cols-2 lg:grid-cols-3">
              {Object.entries(metrics)
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([key, value]) => (
                  <div key={key} className="flex items-baseline justify-between gap-2 border-b border-line/70 py-2">
                    <dt className="truncate text-ink-2">{key}</dt>
                    <dd className="mono font-semibold text-ink">{value}</dd>
                  </div>
                ))}
            </dl>
            <p className="mt-4 text-xs text-ink-3">
              Prometheus exposition is available at <code className="mono">/api/metrics?prometheus=true</code>.
            </p>
          </Panel>
        ) : null}

        <InlineAlert kind="info" title="Privacy and scope">
          <ul className="mt-1 list-disc space-y-0.5 pl-4">
            <li>Never enter real patient data.</li>
            <li>Audio and notes stay on the backend machine (Kaggle, when using the runner). No third-party AI API is called.</li>
            <li>Every clinical statement must cite transcript evidence or it is dropped / flagged.</li>
            <li>Approval is always an explicit human action.</li>
          </ul>
        </InlineAlert>
      </div>
    </div>
  )
}

function ProviderCard({
  title,
  name,
  mock,
  detail,
}: {
  title: string
  name: string
  mock: boolean
  detail: string
}) {
  return (
    <div className="tile p-4">
      <div className="flex items-center gap-2">
        <StatusDot className={mock ? 'bg-tone-warning-fg' : 'bg-tone-success-fg'} />
        <p className="text-[13px] font-semibold tracking-tight text-ink">{title}</p>
        <span className="chip mono ml-auto px-2.5 py-0.5 text-2xs">{name}</span>
      </div>
      <p className="mt-2 flex gap-1.5 text-xs leading-relaxed text-ink-3">
        {mock ? <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-tone-warning-fg" aria-hidden /> : null}
        {detail}
      </p>
    </div>
  )
}
