import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  AudioLines,
  ClipboardCheck,
  FileCheck2,
  FileClock,
  ListChecks,
  MessageSquareText,
  Radio,
  ScrollText,
  Stethoscope,
  Timer,
  Waves,
} from 'lucide-react'

import { SpeakerRoster } from '@/components/session/SpeakerRoster'
import { InlineAlert, PageHeader, Panel, Spinner, StatCard } from '@/components/ui/primitives'
import { ENTITY_STATUS_LABELS, ENTITY_STATUS_STYLES, NOTE_STATUS_LABELS, ROLE_STYLES, SESSION_STATUS_STYLES } from '@/constants'
import { api } from '@/services/api'
import type { AudioChunk, ClinicalEntity, ClinicalNote, Session, TranscriptSegment } from '@/types'
import { cn } from '@/utils/cn'
import { formatDateTime, formatDuration, formatTimestamp, titleCase } from '@/utils/format'

interface AuditEntry {
  id: string
  action: string
  actor_email: string
  created_at: string
  detail: unknown
}

export function SessionDetailPage() {
  const { id } = useParams<{ id: string }>()
  const [session, setSession] = useState<Session | null>(null)
  const [segments, setSegments] = useState<TranscriptSegment[]>([])
  const [entities, setEntities] = useState<ClinicalEntity[]>([])
  const [note, setNote] = useState<ClinicalNote | null>(null)
  const [chunks, setChunks] = useState<AudioChunk[]>([])
  const [audit, setAudit] = useState<AuditEntry[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!id) return
    let cancelled = false
    Promise.all([
      api.getSession(id),
      api.transcript(id),
      api.entities(id),
      api.note(id),
      api.audioChunks(id),
      api.audit(id),
    ])
      .then(([nextSession, nextSegments, nextEntities, nextNote, nextChunks, nextAudit]) => {
        if (cancelled) return
        setSession(nextSession)
        setSegments(nextSegments)
        setEntities(nextEntities)
        setNote(nextNote)
        setChunks(nextChunks.chunks)
        setAudit(nextAudit.entries as AuditEntry[])
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message)
      })
    return () => {
      cancelled = true
    }
  }, [id])

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

  if (!session) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-sm text-ink-3">
        <Spinner /> Loading session…
      </div>
    )
  }

  const speechSeconds = chunks.reduce((sum, chunk) => sum + (chunk.end_time - chunk.start_time) * chunk.speech_ratio, 0)

  return (
    <div className="page">
      <div className="page-inner">
        <PageHeader
          eyebrow={
            <span className="flex flex-wrap items-center gap-2">
              <span className={cn('badge', SESSION_STATUS_STYLES[session.status])}>{session.status}</span>
            </span>
          }
          title={<span className="mono">{session.reference}</span>}
          subtitle={`${session.name} · Patient ${session.patient_id} · Created ${formatDateTime(session.created_at)}`}
          actions={
            <>
              <Link to={`/sessions/${session.id}/live`} className="btn-secondary">
                <Radio className="h-4 w-4" aria-hidden />
                Live Workspace
              </Link>
              <Link to={`/sessions/${session.id}/review`} className="btn-primary">
                <ClipboardCheck className="h-4 w-4" aria-hidden />
                Review & Approve Note
              </Link>
            </>
          }
        />

        {session.last_error ? (
          <InlineAlert kind="warning" title="Last Recorded Note Warning">
            {session.last_error}
          </InlineAlert>
        ) : null}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <StatCard label="Duration" value={formatDuration(session.duration_seconds)} icon={<Timer className="h-5 w-5" />} />
          <StatCard
            label="Speech Lines"
            value={segments.length}
            tone="sky"
            icon={<MessageSquareText className="h-5 w-5" />}
          />
          <StatCard
            label="Clinical Facts"
            value={entities.length}
            tone="lavender"
            icon={<Stethoscope className="h-5 w-5" />}
          />
          <StatCard
            label="Note Status"
            value={note ? NOTE_STATUS_LABELS[note.status] : '—'}
            detail={note ? `Version ${note.version}` : undefined}
            tone="approved"
            icon={<FileCheck2 className="h-5 w-5" />}
          />
          <StatCard
            label="Speech Audio"
            value={formatDuration(speechSeconds)}
            detail={`${chunks.length} recording files`}
            tone="mint"
            icon={<AudioLines className="h-5 w-5" />}
          />
        </div>

        <div className="grid gap-5 lg:grid-cols-2">
          <Panel title="Conversation Transcript" icon={<ScrollText className="h-4 w-4" aria-hidden />} className="max-h-[28rem]">
            {segments.length === 0 ? (
              <p className="px-5 py-6 text-[13px] text-ink-3">No transcript recorded.</p>
            ) : (
              <ol className="space-y-2 p-3">
                {segments.map((segment) => {
                  const role = ROLE_STYLES[segment.role] ?? ROLE_STYLES.UNKNOWN
                  return (
                    <li key={segment.ref} className={cn('rounded-tile border-l-[3px] bg-surface-2 px-3.5 py-2.5', role.accent)}>
                      <div className="flex items-center gap-2">
                        <span className={cn('badge', role.badge)}>{role.label}</span>
                        <span className="mono text-2xs text-ink-3">{formatTimestamp(segment.start_time)}</span>
                      </div>
                      <p className="mt-1.5 text-[13px] leading-relaxed text-ink">{segment.text}</p>
                    </li>
                  )
                })}
              </ol>
            )}
          </Panel>

          <div className="flex flex-col gap-5">
            <SpeakerRoster speakers={session.speakers} editable={false} />

            <Panel title="Key Clinical Findings" icon={<ListChecks className="h-4 w-4" aria-hidden />} className="max-h-72">
              {entities.length === 0 ? (
                <p className="px-5 py-6 text-[13px] text-ink-3">No clinical findings extracted yet.</p>
              ) : (
                <ul className="divide-y divide-line/60">
                  {entities.map((entity) => (
                    <li key={entity.ref} className="flex items-center gap-2.5 px-5 py-2.5 text-[13px]">
                      <span className={cn('badge', ENTITY_STATUS_STYLES[entity.status])}>
                        {ENTITY_STATUS_LABELS[entity.status]}
                      </span>
                      <span className="font-medium text-ink">{entity.value}</span>
                      <span className="chip ml-auto py-0.5 text-2xs">{titleCase(entity.entity_type)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>
        </div>

        <div className="grid gap-5 lg:grid-cols-2">
          <Panel title="Audio chunks" icon={<Waves className="h-4 w-4" aria-hidden />} className="max-h-80">
            {chunks.length === 0 ? (
              <p className="px-5 py-6 text-[13px] text-ink-3">No audio processed.</p>
            ) : (
              <div className="px-1">
                <table className="data-table text-xs">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Source</th>
                      <th>Window</th>
                      <th className="text-right">Speech</th>
                      <th className="text-right">RMS</th>
                      <th className="text-right">Bytes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {chunks.map((chunk) => (
                      <tr key={chunk.id}>
                        <td className="mono !py-2.5">{chunk.sequence}</td>
                        <td className="!py-2.5">{chunk.source}</td>
                        <td className="mono !py-2.5">
                          {formatTimestamp(chunk.start_time)}–{formatTimestamp(chunk.end_time)}
                        </td>
                        <td className="mono !py-2.5 text-right">{Math.round(chunk.speech_ratio * 100)}%</td>
                        <td className="mono !py-2.5 text-right">{chunk.rms_dbfs.toFixed(1)} dB</td>
                        <td className="mono !py-2.5 text-right">{chunk.size_bytes}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>

          <Panel title="Audit trail" icon={<FileClock className="h-4 w-4" aria-hidden />} className="max-h-80">
            {audit.length === 0 ? (
              <p className="px-5 py-6 text-[13px] text-ink-3">No audit entries.</p>
            ) : (
              <ol className="relative space-y-0.5 px-5 py-3">
                {audit.map((entry) => (
                  <li key={entry.id} className="relative flex gap-3 py-2">
                    <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-aqua ring-4 ring-aqua-soft" aria-hidden />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="mono text-xs font-semibold text-ink">{entry.action}</span>
                        <span className="ml-auto whitespace-nowrap text-2xs text-ink-3">{formatDateTime(entry.created_at)}</span>
                      </div>
                      <p className="mt-0.5 text-2xs text-ink-3">{entry.actor_email}</p>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </Panel>
        </div>
      </div>
    </div>
  )
}
