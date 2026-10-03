import { useEffect, useState } from 'react'
import { AlertTriangle, Link2, Quote, X } from 'lucide-react'

import { InlineAlert, Spinner, StatusDot } from '@/components/ui/primitives'
import { CONFIDENCE_TOOLTIP, ROLE_STYLES } from '@/constants'
import { api } from '@/services/api'
import type { EvidenceLink, SpeakerRole, TranscriptSegment } from '@/types'
import { cn } from '@/utils/cn'
import { formatTimestamp } from '@/utils/format'

interface ChainEntry {
  evidence: EvidenceLink
  segment: TranscriptSegment | null
  audio_chunk_id: string | null
}

interface Detail {
  target_key: string
  clinical_statement: string | null
  chain: ChainEntry[]
  validated_count: number
  total_count: number
}

/**
 * The "Show Source" surface: Clinical statement -> evidence -> transcript segment
 * -> speaker -> timestamp -> audio chunk. This is the provenance chain the whole
 * product is built around.
 */
export function EvidenceViewer({
  sessionId,
  targetKey,
  statement,
  onClose,
  onHighlight,
}: {
  sessionId: string
  targetKey: string
  statement: string
  onClose: () => void
  onHighlight: (ref: string | null) => void
}) {
  const [detail, setDetail] = useState<Detail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    api
      .evidenceDetail(sessionId, targetKey)
      .then((next) => {
        if (cancelled) return
        setDetail(next as Detail)
        const firstRef = (next as Detail).chain.find((entry) => entry.evidence.segment_ref)?.evidence.segment_ref
        onHighlight(firstRef ?? null)
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
    // onHighlight is stable enough (store action); re-running on it would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, targetKey])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <aside
      className="flex w-96 shrink-0 flex-col border-l border-line bg-surface text-ink shadow-float animate-fade-in"
      role="complementary"
      aria-label="Evidence viewer"
    >
      <header className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-aqua-soft text-brand">
            <Link2 className="h-4 w-4" aria-hidden />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold tracking-tight text-ink">Evidence</p>
            <p className="mono mt-0.5 truncate text-2xs text-ink-3">{targetKey}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="btn-icon btn-icon-sm"
          aria-label="Close evidence viewer"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="px-5 pt-4">
          <div className="rounded-tile border border-aqua/40 bg-aqua-soft/60 px-4 py-3">
            <p className="text-2xs font-semibold text-ink-3">Clinical statement</p>
            <p className="mt-1 text-sm leading-relaxed text-ink">
              {detail?.clinical_statement || statement || '—'}
            </p>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 px-5 py-4 text-xs text-ink-3">
            <Spinner /> Resolving provenance chain…
          </div>
        ) : null}

        {error ? (
          <div className="px-5 pt-4">
            <InlineAlert kind="error" title="Could not load evidence">
              {error}
            </InlineAlert>
          </div>
        ) : null}

        {detail && detail.chain.length === 0 && !loading ? (
          <div className="px-5 pt-4">
            <InlineAlert kind="warning" title="No transcript evidence">
              This statement is not linked to any transcript segment, so it is flagged{' '}
              <strong>REVIEW REQUIRED</strong> and must be verified or removed by a human before approval.
            </InlineAlert>
          </div>
        ) : null}

        {detail && detail.chain.length > 0 ? (
          <>
            <div className="flex items-center gap-3 px-5 pb-2 pt-4 text-2xs text-ink-3">
              <span className="mono font-semibold">
                {detail.validated_count}/{detail.total_count} validated
              </span>
              <span className="h-px flex-1 bg-line" />
            </div>
            <ol className="space-y-2.5 px-5 pb-5">
              {detail.chain.map((entry, index) => (
                <ChainCard key={entry.evidence.id ?? index} entry={entry} onHighlight={onHighlight} />
              ))}
            </ol>
          </>
        ) : null}
      </div>

      <footer className="border-t border-line bg-surface-2 px-5 py-3 text-2xs leading-relaxed text-ink-3">
        {CONFIDENCE_TOOLTIP}
      </footer>
    </aside>
  )
}

function ChainCard({ entry, onHighlight }: { entry: ChainEntry; onHighlight: (ref: string | null) => void }) {
  const { evidence, segment } = entry
  const role = ROLE_STYLES[(evidence.speaker_role as SpeakerRole) ?? 'UNKNOWN'] ?? ROLE_STYLES.UNKNOWN

  return (
    <li>
      <button
        type="button"
        onClick={() => onHighlight(evidence.segment_ref)}
        className={cn(
          'w-full rounded-tile border p-3.5 text-left transition hover:border-aqua hover:shadow-xs focus:outline-none focus-visible:ring-4 focus-visible:ring-brand/15',
          evidence.validated ? 'border-line bg-surface' : 'border-tone-warning-line bg-tone-warning-bg/60',
        )}
      >
        <div className="flex items-center gap-2">
          <StatusDot className={role.dot} />
          <span className={cn('badge', role.badge)}>{role.label}</span>
          <span className="mono text-2xs text-ink-3">{formatTimestamp(evidence.timestamp ?? 0)}</span>
          <span className="mono ml-auto text-2xs text-ink-3">{evidence.segment_ref ?? 'unlinked'}</span>
        </div>

        <p className="mt-2.5 flex gap-2 text-[13px] leading-relaxed text-ink">
          <Quote className="mt-1 h-3 w-3 shrink-0 text-aqua" aria-hidden />
          <span className="italic">{evidence.source_text || segment?.text || 'Source text unavailable'}</span>
        </p>

        <div className="mt-2.5 flex items-center justify-between text-2xs text-ink-3">
          {!evidence.validated ? (
            <span className="flex items-center gap-1 text-2xs font-semibold text-tone-warning-fg">
              <AlertTriangle className="h-3 w-3" aria-hidden />
              {evidence.validation_error ?? 'Unverified'}
            </span>
          ) : (
            <span className="font-semibold text-tone-success-fg">✓ Transcript verified</span>
          )}
        </div>
      </button>
    </li>
  )
}
