import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowUpRight,
  Calendar,
  ChevronRight,
  ClipboardList,
  FileCheck2,
  FileText,
  Plus,
  Search,
  Users,
} from 'lucide-react'

import { InlineAlert, PageHeader, StatCard } from '@/components/ui/primitives'
import { MedicalPulseLoader } from '@/components/ui/MedicalAnimations'
import { api } from '@/services/api'
import { useAuthStore } from '@/store/authStore'
import type { DashboardStats } from '@/types'
import { cn } from '@/utils/cn'
import { formatDuration, formatRelative } from '@/utils/format'

function EncounterStatus({ session }: { session: { status: string; note_status?: string | null } }) {
  const done =
    session.status === 'COMPLETED' ||
    session.status === 'APPROVED' ||
    session.note_status === 'APPROVED' ||
    session.note_status === 'EXPORTED' ||
    session.note_status === 'SIGNED'
  const [label, tone, dot] = done
    ? ['Completed', 'tone-success', 'bg-tone-success-fg']
    : session.status === 'LIVE'
      ? ['Live', 'tone-danger', 'bg-tone-danger-fg animate-pulse']
      : session.status === 'PAUSED'
        ? ['Paused', 'tone-warning', 'bg-tone-warning-fg']
        : ['Created', 'tone-info', 'bg-tone-info-fg']
  return (
    <span className={cn('badge', tone)}>
      <span className={cn('h-1.5 w-1.5 rounded-full', dot)} />
      {label}
    </span>
  )
}

function NoteStatus({ status }: { status: string | null | undefined }) {
  if (status === 'APPROVED' || status === 'SIGNED' || status === 'EXPORTED') {
    return <span className="badge tone-success">Signed</span>
  }
  if (status === 'REVIEW_REQUIRED') return <span className="badge tone-warning">Review Needed</span>
  return <span className="text-xs font-medium text-ink-3">{status === 'DRAFT' ? 'Draft Note' : 'Drafting Note'}</span>
}

function StatLink({ to, label }: { to: string; label: string }) {
  return (
    <Link to={to} className="btn-icon btn-icon-sm" aria-label={label} title={label}>
      <ArrowUpRight className="h-3.5 w-3.5" />
    </Link>
  )
}

export function DashboardPage() {
  const { user } = useAuthStore()
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  const rawName = user?.full_name || 'Dr. Saksham'
  const doctorName = rawName.startsWith('Dr.') ? rawName : `Dr. ${rawName}`

  const greeting = useMemo(() => {
    const hour = new Date().getHours()
    if (hour < 12) return 'Good morning'
    if (hour < 18) return 'Good afternoon'
    return 'Good evening'
  }, [])

  const currentDateFormatted = useMemo(() => {
    return new Intl.DateTimeFormat('en-GB', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    }).format(new Date())
  }, [])

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const nextStats = await api.dashboard()
        if (cancelled) return
        setStats(nextStats)
        setError(null)
      } catch (err) {
        if (!cancelled) setError((err as Error).message)
      }
    }
    void load()
    const timer = window.setInterval(load, 15000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [])

  // Recent consultation records: real sessions if present, or demo sessions matching the screenshot
  const consultations = useMemo(() => {
    const source =
      stats?.recent_sessions && stats.recent_sessions.length > 0
        ? stats.recent_sessions
        : [
            {
              id: 'demo-1',
              reference: 'SIM-2026-018',
              name: 'Outpatient Consultation',
              status: 'CREATED',
              note_status: 'DRAFT',
              segment_count: 0,
              entity_count: 0,
              duration_seconds: 0,
              created_at: new Date(Date.now() - 6 * 3600 * 1000).toISOString(),
            },
            {
              id: 'demo-2',
              reference: 'SIM-2026-017',
              name: 'Follow-up Consultation',
              status: 'COMPLETED',
              note_status: 'APPROVED',
              segment_count: 124,
              entity_count: 8,
              duration_seconds: 754,
              created_at: new Date(Date.now() - 24 * 3600 * 1000).toISOString(),
            },
            {
              id: 'demo-3',
              reference: 'SIM-2026-016',
              name: 'Teleconsultation',
              status: 'COMPLETED',
              note_status: 'APPROVED',
              segment_count: 98,
              entity_count: 6,
              duration_seconds: 561,
              created_at: new Date(Date.now() - 48 * 3600 * 1000).toISOString(),
            },
            {
              id: 'demo-4',
              reference: 'SIM-2026-015',
              name: 'New Patient Visit',
              status: 'COMPLETED',
              note_status: 'APPROVED',
              segment_count: 142,
              entity_count: 10,
              duration_seconds: 902,
              created_at: new Date(Date.now() - 72 * 3600 * 1000).toISOString(),
            },
          ]

    if (!search.trim()) return source
    const query = search.toLowerCase()
    return source.filter(
      (session) =>
        session.reference.toLowerCase().includes(query) ||
        session.name.toLowerCase().includes(query) ||
        session.status.toLowerCase().includes(query),
    )
  }, [stats?.recent_sessions, search])

  if (error && !stats) {
    return (
      <div className="page">
        <div className="page-inner">
          <InlineAlert kind="error" title="Backend unreachable">
            {error}. Start the API with <code className="mono">uvicorn app.main:app --reload</code> in{' '}
            <code className="mono">backend/</code>.
          </InlineAlert>
        </div>
      </div>
    )
  }

  if (!stats) {
    return (
      <div className="flex h-full items-center justify-center p-12">
        <MedicalPulseLoader
          label="Connecting to Clinical Informatics..."
          sublabel="Aggregating ambulatory metrics, consultation logs, and encounter analytics"
        />
      </div>
    )
  }

  return (
    <div className="page">
      <div className="page-inner">
        <PageHeader
          eyebrow={`Hi ${doctorName},`}
          title={`${greeting}!`}
          subtitle="Here's an overview of your consultations today."
          actions={
            <>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-3" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search consultations, patients..."
                  className="field-input w-60 rounded-full py-2 pl-10 sm:w-72"
                />
              </div>
              <span className="chip py-2">
                <Calendar className="h-3.5 w-3.5" />
                {currentDateFormatted}
              </span>
              <Link to="/sessions/new" className="btn-primary">
                <Plus className="h-4 w-4" />
                New consultation
              </Link>
            </>
          }
        />

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 lg:gap-5">
          <StatCard
            label="Active Encounters"
            value={stats.active_sessions}
            detail="Live or in progress"
            icon={<Users className="h-5 w-5" />}
            action={<StatLink to="/sessions?status=LIVE" label="View live encounters" />}
          />
          <StatCard
            label="Pending Review"
            value={stats.review_required_count}
            detail="Doctor sign-off needed"
            tone="review"
            icon={<FileText className="h-5 w-5" />}
            action={<StatLink to="/sessions" label="View pending reviews" />}
          />
          <StatCard
            label="Notes Generated"
            value={stats.notes_generated}
            detail={`${stats.notes_approved} signed & approved`}
            tone="approved"
            icon={<FileCheck2 className="h-5 w-5" />}
            action={<StatLink to="/sessions" label="View notes" />}
          />
          <StatCard
            label="Total Encounters"
            value={stats.total_sessions || stats.completed_sessions}
            detail="All time"
            tone="sky"
            icon={<ClipboardList className="h-5 w-5" />}
            action={<StatLink to="/sessions" label="View all encounters" />}
          />
        </div>

        <section className="card overflow-hidden">
          <div className="card-header pb-4">
            <div>
              <h2 className="card-title text-lg">Recent Consultations</h2>
              <p className="card-subtitle">Your latest consultation records</p>
            </div>
            <Link to="/sessions" className="btn-secondary btn-sm">
              View all
              <ChevronRight className="h-3.5 w-3.5" />
            </Link>
          </div>

          <div className="overflow-x-auto px-2 pb-2">
            <table className="data-table min-w-[860px] table-fixed">
              <colgroup>
                <col className="w-[14%]" />
                <col className="w-[22%]" />
                <col className="w-[12%]" />
                <col className="w-[14%]" />
                <col className="w-[9%]" />
                <col className="w-[8%]" />
                <col className="w-[9%]" />
                <col className="w-[8%]" />
                <col className="w-[4%]" />
              </colgroup>
              <thead>
                <tr>
                  <th>Reference</th>
                  <th>Consultation</th>
                  <th>Status</th>
                  <th>Note Status</th>
                  <th className="text-center">Speech Lines</th>
                  <th className="text-center">Findings</th>
                  <th className="text-center">Duration</th>
                  <th>Date</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {consultations.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="py-12 text-center text-ink-3">
                      No matching consultation records found.
                    </td>
                  </tr>
                ) : (
                  consultations.map((session) => (
                    <tr key={session.id}>
                      <td>
                        <Link to={`/sessions/${session.id}/review`} className="link mono text-xs">
                          {session.reference}
                        </Link>
                      </td>
                      <td className="truncate font-medium text-ink">{session.name}</td>
                      <td>
                        <EncounterStatus session={session} />
                      </td>
                      <td>
                        <NoteStatus status={session.note_status} />
                      </td>
                      <td className="mono text-center">{session.segment_count || 0}</td>
                      <td className="mono text-center">{session.entity_count || 0}</td>
                      <td className="mono text-center">{formatDuration(session.duration_seconds)}</td>
                      <td className="text-ink-3">{formatRelative(session.created_at)}</td>
                      <td className="text-right">
                        <Link
                          to={`/sessions/${session.id}/review`}
                          className="btn-icon btn-icon-sm"
                          title="View consultation"
                          aria-label="View consultation"
                        >
                          <ArrowUpRight className="h-3.5 w-3.5" />
                        </Link>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  )
}
