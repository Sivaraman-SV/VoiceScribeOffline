import { useMemo } from 'react'
import { Activity, Brain, Link2 } from 'lucide-react'

import { EmptyState, Panel } from '@/components/ui/primitives'
import {
  ENTITY_GROUPS,
  ENTITY_STATUS_LABELS,
  ENTITY_STATUS_STYLES,
} from '@/constants'
import type { ClinicalEntity, ProcessingStage } from '@/types'
import { cn } from '@/utils/cn'
import { titleCase } from '@/utils/format'

interface Props {
  entities: ClinicalEntity[]
  stage: ProcessingStage
  stageDetail: string
  onShowSource: (targetKey: string, statement: string) => void
}

export function IntelligencePanel({ entities, stage, stageDetail, onShowSource }: Props) {
  const grouped = useMemo(() => {
    return ENTITY_GROUPS.map((group) => ({
      title: group.title,
      items: entities.filter((entity) => group.key.includes(entity.entity_type)),
    })).filter((group) => group.items.length > 0)
  }, [entities])

  const isWorking = stage !== 'IDLE' && stage !== 'NOTE_STATE' && Boolean(stage)

  return (
    <Panel title="Clinical Findings" icon={<Brain className="h-4 w-4 text-brand" aria-hidden />}>
      <div className="space-y-3 p-4">
        <div
          className={cn(
            'rounded-tile border p-3.5 transition-all duration-150',
            isWorking ? 'border-aqua/40 bg-aqua-soft text-ink' : 'border-line bg-surface-2 text-ink',
          )}
        >
          <div className="flex items-center gap-3">
            <span className="relative flex h-2.5 w-2.5">
              {isWorking ? (
                <>
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-aqua opacity-75" />
                  <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-brand" />
                </>
              ) : (
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-tone-success-fg" />
              )}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-semibold tracking-tight">
                {isWorking ? 'Listening & Structuring' : 'Scribe Ready'}
              </p>
              <p className="truncate text-2xs text-ink-3">
                {isWorking
                  ? stageDetail || 'Extracting clinical facts in real time...'
                  : 'Clinical facts linked to transcript'}
              </p>
            </div>
            {isWorking ? (
              <span className="badge tone-ai">
                <Activity className="h-3 w-3 animate-pulse" />
                Active
              </span>
            ) : null}
          </div>
        </div>

        {entities.length === 0 ? (
          <EmptyState
            title="Listening for clinical facts"
            detail="Symptoms, medications, allergies, and examination findings will automatically appear here as they are discussed."
          />
        ) : (
          grouped.map((group) => (
            <section key={group.title} className="overflow-hidden rounded-tile border border-line bg-surface">
              <header className="flex items-center gap-2 border-b border-line bg-surface-2 px-4 py-2.5">
                <h3 className="text-xs font-semibold tracking-tight text-ink">{group.title}</h3>
                <span className="badge tone-brand mono ml-auto">
                  {group.items.length}
                </span>
              </header>
              <ul className="divide-y divide-line">
                {group.items.map((entity) => (
                  <li key={entity.ref} className="px-4 py-2.5 transition-colors hover:bg-surface-2">
                    <div className="flex items-center gap-2">
                      <span className={cn('badge', ENTITY_STATUS_STYLES[entity.status])}>
                        {ENTITY_STATUS_LABELS[entity.status]}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-ink">
                        {entity.normalized_value ? titleCase(entity.normalized_value) : entity.value}
                      </span>
                      <button
                        type="button"
                        onClick={() => onShowSource(entity.ref, entity.value)}
                        className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-2xs font-semibold text-ink-3 transition hover:bg-aqua-soft hover:text-brand"
                        title="View transcript citation"
                        aria-label={`Show source for ${entity.value}`}
                      >
                        <Link2 className="h-3 w-3" aria-hidden />
                        Sources
                      </button>
                    </div>
                    <div className="mt-1 flex items-center gap-2">
                      <span className="text-2xs font-medium text-ink-3">{titleCase(entity.entity_type)}</span>
                      {entity.normalized_value && entity.normalized_value.toLowerCase() !== entity.value.toLowerCase() ? (
                        <span className="truncate text-2xs italic text-ink-3">Spoken: &ldquo;{entity.value}&rdquo;</span>
                      ) : null}
                      {entity.detail ? (
                        <span className="truncate text-2xs text-ink-2">— {entity.detail}</span>
                      ) : null}
                    </div>
                    {entity.review_required ? (
                      <p className="mt-1 text-2xs font-medium text-tone-warning-fg">{entity.review_reason ?? 'Review required'}</p>
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
          ))
        )}
      </div>
    </Panel>
  )
}
