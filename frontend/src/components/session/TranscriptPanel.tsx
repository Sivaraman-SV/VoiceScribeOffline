import { useEffect, useMemo, useRef } from 'react'
import { MessageSquare, Layers, Radio, Sparkles } from 'lucide-react'

import { EmptyState, Panel, StatusDot } from '@/components/ui/primitives'
import { ROLE_STYLES } from '@/constants'
import type { EvidenceLink, Speaker, TranscriptSegment } from '@/types'
import { cn } from '@/utils/cn'
import { formatSpeakerDisplayName, formatTimestamp } from '@/utils/format'

interface Props {
  segments: TranscriptSegment[]
  speakers: Speaker[]
  evidence: EvidenceLink[]
  selectedRef: string | null
  highlightedRefs: string[]
  live: boolean
  onSelect: (ref: string | null) => void
  actions?: React.ReactNode
}

export function TranscriptPanel({
  segments,
  speakers,
  evidence,
  selectedRef,
  highlightedRefs,
  live,
  onSelect,
  actions,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const pinnedToBottom = useRef(true)

  const evidenceCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const link of evidence) {
      if (!link.segment_ref) continue
      counts.set(link.segment_ref, (counts.get(link.segment_ref) ?? 0) + 1)
    }
    return counts
  }, [evidence])

  // Auto-follow the live feed, but stop fighting the user once they scroll up.
  useEffect(() => {
    const node = scrollRef.current
    if (!node || !pinnedToBottom.current) return
    node.scrollTop = node.scrollHeight
  }, [segments.length])

  const handleScroll = () => {
    const node = scrollRef.current
    if (!node) return
    pinnedToBottom.current = node.scrollHeight - node.scrollTop - node.clientHeight < 48
  }

  const highlighted = new Set(highlightedRefs)

  return (
    <Panel
      title="Conversation Transcript"
      icon={<MessageSquare className="h-4 w-4 text-brand" aria-hidden />}
      actions={
        <>
          {actions}
          <span className="chip mono px-2.5 py-0.5 text-2xs">
            <Layers className="h-3 w-3" aria-hidden />
            {segments.length} lines
          </span>
          {live ? (
            <span className="badge tone-danger">
              <StatusDot className="h-1.5 w-1.5 bg-tone-danger-fg" pulse />
              Live
            </span>
          ) : null}
        </>
      }
      bodyClassName="bg-surface-2 p-3"
    >
      <div ref={scrollRef} onScroll={handleScroll} className="h-full space-y-2.5 overflow-y-auto pr-1">
        {segments.length === 0 ? (
          <EmptyState
            icon={<Radio className="h-6 w-6" aria-hidden />}
            title="Waiting for speech"
            detail="Transcript will appear in real time as the doctor and patient speak."
          />
        ) : (
          <ol className="space-y-2.5">
            {segments.map((segment) => {
              const role = ROLE_STYLES[segment.role] ?? ROLE_STYLES.UNKNOWN
              const isSelected = selectedRef === segment.ref
              const isHighlighted = highlighted.has(segment.ref)
              const evidenceCount = evidenceCounts.get(segment.ref) ?? 0
              const speaker = speakers.find((s) => s.label === segment.speaker_label)
              const speakerInfo = formatSpeakerDisplayName(segment.speaker_label, segment.role, speaker?.display_name)

              return (
                <li key={segment.ref}>
                  <button
                    type="button"
                    onClick={() => onSelect(isSelected ? null : segment.ref)}
                    className={cn(
                      'group flex w-full flex-col gap-2 rounded-tile border p-3.5 text-left transition-all duration-150 focus:outline-none focus-visible:ring-4 focus-visible:ring-brand/15',
                      isSelected
                        ? 'border-aqua bg-aqua-soft shadow-xs ring-1 ring-aqua/40'
                        : isHighlighted
                          ? 'border-tone-warning-line bg-tone-warning-bg shadow-xs'
                          : 'border-line bg-surface hover:border-line-strong hover:shadow-xs',
                    )}
                    aria-current={isSelected}
                  >
                    <div className="flex items-center gap-2">
                      <span className={cn('badge', role.badge)}>
                        {speakerInfo.fullBadge}
                      </span>
                      <span className="mono text-2xs font-medium text-ink-3">
                        {formatTimestamp(segment.start_time)}
                      </span>
                      <span className="ml-auto flex items-center gap-1.5">
                        {evidenceCount > 0 ? (
                          <span className="badge tone-ai">
                            <Sparkles className="h-2.5 w-2.5" />
                            {evidenceCount} cited
                          </span>
                        ) : null}
                      </span>
                    </div>
                    <p className="pl-0.5 text-sm font-normal leading-relaxed text-ink">{segment.text}</p>
                  </button>
                </li>
              )
            })}
          </ol>
        )}
      </div>
    </Panel>
  )
}
