import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowUpRight, ChevronLeft, ChevronRight, ClipboardList, PlusCircle, Trash2 } from 'lucide-react'

import { ConfirmModal, InlineAlert, PageHeader, Spinner, StatusDot } from '@/components/ui/primitives'
import { NOTE_STATUS_LABELS, SESSION_STATUS_STYLES } from '@/constants'
import { api } from '@/services/api'
import { useUiStore } from '@/store/uiStore'
import type { NoteStatus, SessionStatus, SessionSummary } from '@/types'
import { cn } from '@/utils/cn'
import { formatDateTime, formatDuration } from '@/utils/format'

const STATUS_FILTERS: (SessionStatus | 'ALL')[] = [
  'ALL',
  'CREATED',
  'LIVE',
  'PAUSED',
  'REVIEW',
  'APPROVED',
  'COMPLETED',
]

const PAGE_SIZE = 25

const CHECKBOX_CLASS = 'h-4 w-4 cursor-pointer rounded border-line-strong accent-brand'

export function SessionsPage() {
  const [items, setItems] = useState<SessionSummary[]>([])
  const [total, setTotal] = useState(0)
  const [offset, setOffset] = useState(0)
  const [filter, setFilter] = useState<SessionStatus | 'ALL'>('ALL')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [sessionToDelete, setSessionToDelete] = useState<SessionSummary | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [bulkDeleting, setBulkDeleting] = useState(false)
  const [showBulkDeleteModal, setShowBulkDeleteModal] = useState(false)
  const pushToast = useUiStore((state) => state.pushToast)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const page = await api.listSessions({
        limit: PAGE_SIZE,
        offset,
        status: filter === 'ALL' ? undefined : filter,
      })
      setItems(page.items)
      setTotal(page.total)
      setSelectedIds(new Set())
      setError(null)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [filter, offset])

  useEffect(() => {
    void load()
  }, [load])

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  const toggleSelectAll = () => {
    if (selectedIds.size === items.length && items.length > 0) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(items.map((item) => item.id)))
    }
  }

  const confirmDelete = async () => {
    if (!sessionToDelete) return
    setDeleting(true)
    try {
      await api.deleteSession(sessionToDelete.id)
      pushToast({ kind: 'success', title: `${sessionToDelete.reference} deleted` })
      setSessionToDelete(null)
      void load()
    } catch (err) {
      pushToast({ kind: 'error', title: 'Delete failed', detail: (err as Error).message })
    } finally {
      setDeleting(false)
    }
  }

  const confirmBulkDelete = async () => {
    if (selectedIds.size === 0) return
    setBulkDeleting(true)
    try {
      const count = selectedIds.size
      await Promise.all(Array.from(selectedIds).map((id) => api.deleteSession(id)))
      pushToast({ kind: 'success', title: `Deleted ${count} consultation${count > 1 ? 's' : ''}` })
      setSelectedIds(new Set())
      setShowBulkDeleteModal(false)
      void load()
    } catch (err) {
      pushToast({ kind: 'error', title: 'Bulk delete failed', detail: (err as Error).message })
    } finally {
      setBulkDeleting(false)
    }
  }

  return (
    <div className="page">
      <div className="page-inner">
        <PageHeader
          title="Consultation History"
          subtitle={`${total} consultation record(s).`}
          actions={
            <Link to="/sessions/new" className="btn-primary">
              <PlusCircle className="h-4 w-4" aria-hidden />
              New Consultation
            </Link>
          }
        />

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="seg flex-wrap">
            {STATUS_FILTERS.map((status) => (
              <button
                key={status}
                type="button"
                onClick={() => {
                  setFilter(status)
                  setOffset(0)
                }}
                className={cn('seg-item', filter === status && 'seg-item-active')}
              >
                {status === 'ALL' ? 'All Records' : status}
              </button>
            ))}
          </div>
        </div>

        {selectedIds.size > 0 ? (
          <div className="card flex flex-wrap items-center justify-between gap-3 px-5 py-3 animate-fade-in-down">
            <span className="flex items-center gap-2.5 text-[13px] font-semibold text-ink">
              <span className="grid h-7 w-7 place-items-center rounded-full bg-tone-danger-bg text-tone-danger-fg">
                <Trash2 className="h-3.5 w-3.5" aria-hidden />
              </span>
              {selectedIds.size} consultation{selectedIds.size > 1 ? 's' : ''} selected
            </span>
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => setSelectedIds(new Set())} className="btn-secondary btn-sm">
                Deselect All
              </button>
              <button type="button" onClick={() => setShowBulkDeleteModal(true)} className="btn-danger btn-sm">
                <Trash2 className="h-3.5 w-3.5" />
                Delete Selected ({selectedIds.size})
              </button>
            </div>
          </div>
        ) : null}

        {error ? (
          <InlineAlert kind="error" title="Could not load consultations">
            {error}
          </InlineAlert>
        ) : null}

        <section className="card overflow-hidden">
          <div className="card-header pb-4">
            <div className="flex items-center gap-3">
              <span className="icon-badge-soft">
                <ClipboardList className="h-4 w-4" aria-hidden />
              </span>
              <h2 className="card-title text-lg">Consultation Records</h2>
            </div>
          </div>

          {loading ? (
            <div className="flex items-center gap-2 px-5 pb-6 text-[13px] text-ink-3">
              <Spinner /> Loading consultations…
            </div>
          ) : items.length === 0 ? (
            <p className="px-5 pb-10 pt-4 text-center text-[13px] text-ink-3">No consultations match this filter.</p>
          ) : (
            <div className="overflow-x-auto px-2 pb-2">
              <table className="data-table min-w-[1040px]">
                <thead>
                  <tr>
                    <th className="w-10">
                      <input
                        type="checkbox"
                        aria-label="Select all consultations"
                        checked={selectedIds.size === items.length && items.length > 0}
                        onChange={toggleSelectAll}
                        className={CHECKBOX_CLASS}
                      />
                    </th>
                    <th>Reference</th>
                    <th>Consultation</th>
                    <th>Patient</th>
                    <th>Source</th>
                    <th>Status</th>
                    <th>Note Status</th>
                    <th className="text-right">Lines</th>
                    <th className="text-right">Duration</th>
                    <th className="text-right">Date</th>
                    <th className="text-right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((session) => (
                    <tr key={session.id} className={cn(selectedIds.has(session.id) && 'bg-brand-soft/60 hover:bg-brand-soft/60')}>
                      <td>
                        <input
                          type="checkbox"
                          aria-label={`Select ${session.reference}`}
                          checked={selectedIds.has(session.id)}
                          onChange={() => toggleSelect(session.id)}
                          className={CHECKBOX_CLASS}
                        />
                      </td>
                      <td>
                        <Link to={`/sessions/${session.id}`} className="link mono text-xs">
                          {session.reference}
                        </Link>
                      </td>
                      <td className="max-w-[16rem] truncate font-medium text-ink">{session.name}</td>
                      <td className="mono text-xs">{session.patient_id}</td>
                      <td className="capitalize">{session.mode.toLowerCase()}</td>
                      <td>
                        <span className={cn('badge', SESSION_STATUS_STYLES[session.status])}>
                          <StatusDot
                            className={session.status === 'LIVE' ? 'bg-tone-danger-fg' : 'bg-current opacity-60'}
                            pulse={session.status === 'LIVE'}
                          />
                          {session.status}
                        </span>
                      </td>
                      <td>
                        {session.note_status ? NOTE_STATUS_LABELS[session.note_status as NoteStatus] : '—'}
                      </td>
                      <td className="mono text-right">{session.segment_count}</td>
                      <td className="mono text-right">{formatDuration(session.duration_seconds)}</td>
                      <td className="whitespace-nowrap text-right text-ink-3">{formatDateTime(session.created_at)}</td>
                      <td className="text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <Link
                            to={session.status === 'LIVE' ? `/sessions/${session.id}/live` : `/sessions/${session.id}/review`}
                            className={session.status === 'LIVE' ? 'btn-danger-soft btn-sm' : 'btn-secondary btn-sm'}
                          >
                            {session.status === 'LIVE' ? 'Open Live' : 'Review Note'}
                            <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
                          </Link>
                          <button
                            type="button"
                            onClick={() => setSessionToDelete(session)}
                            className="btn-icon btn-icon-sm border-transparent bg-transparent hover:border-tone-danger-line hover:bg-tone-danger-bg hover:text-tone-danger-fg"
                            aria-label={`Delete ${session.reference}`}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <ConfirmModal
          open={Boolean(sessionToDelete)}
          title="Delete Consultation?"
          message={`Are you sure you want to delete consultation ${sessionToDelete?.reference}? This permanently removes its transcript, clinical entities, and generated note.`}
          confirmLabel="Delete Record"
          cancelLabel="Cancel"
          tone="danger"
          busy={deleting}
          onConfirm={() => void confirmDelete()}
          onCancel={() => setSessionToDelete(null)}
        />

        <ConfirmModal
          open={showBulkDeleteModal}
          title={`Delete ${selectedIds.size} Consultations?`}
          message={`Are you sure you want to delete the ${selectedIds.size} selected consultation records? This permanently removes their transcripts, clinical entities, and generated notes.`}
          confirmLabel={`Delete ${selectedIds.size} Records`}
          cancelLabel="Cancel"
          tone="danger"
          busy={bulkDeleting}
          onConfirm={() => void confirmBulkDelete()}
          onCancel={() => setShowBulkDeleteModal(false)}
        />

        {total > PAGE_SIZE ? (
          <div className="flex items-center justify-between text-xs text-ink-2">
            <button
              type="button"
              className="btn-secondary"
              disabled={offset === 0}
              onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
            >
              <ChevronLeft className="h-4 w-4" aria-hidden />
              Previous
            </button>
            <span className="chip mono">
              {offset + 1}–{Math.min(offset + PAGE_SIZE, total)} of {total}
            </span>
            <button
              type="button"
              className="btn-secondary"
              disabled={offset + PAGE_SIZE >= total}
              onClick={() => setOffset(offset + PAGE_SIZE)}
            >
              Next
              <ChevronRight className="h-4 w-4" aria-hidden />
            </button>
          </div>
        ) : null}
      </div>
    </div>
  )
}
