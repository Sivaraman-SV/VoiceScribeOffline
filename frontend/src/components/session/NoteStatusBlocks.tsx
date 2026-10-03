import { Loader2, WifiOff } from 'lucide-react'

import { SECTION_LABELS, SECTION_ORDER } from '@/constants'
import type { NoteFallback, NoteSectionKey } from '@/types'

export function NoteFallbackBanner({ fallback }: { fallback: NoteFallback | null | undefined }) {
  if (!fallback) return null
  return (
    <div role="alert" className="tone-danger flex items-start gap-3 rounded-tile border px-4 py-3">
      <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-tone-danger-fg/10">
        <WifiOff className="h-3.5 w-3.5" aria-hidden />
      </span>
      <div className="min-w-0">
        <p className="text-[13px] font-semibold">[{fallback.label}]</p>
        <p className="mt-0.5 text-xs leading-relaxed opacity-90">{fallback.message}</p>
      </div>
    </div>
  )
}

export function StreamingNotePreview({ sections }: { sections: Partial<Record<NoteSectionKey, string>> | null }) {
  const keys = SECTION_ORDER.filter((key) => sections?.[key]?.trim())
  if (!sections || keys.length === 0) return null
  return (
    <section
      aria-live="polite"
      aria-label="Streaming draft"
      className="w-full rounded-tile border border-dashed border-aqua/60 bg-aqua-soft/60 p-4 text-left"
    >
      <p className="badge tone-ai mb-3">
        <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
        Drafting — not yet verified against the transcript
      </p>
      <dl className="space-y-3">
        {keys.map((key) => (
          <div key={key} className="rounded-control bg-surface/70 px-3.5 py-2.5">
            <dt className="text-2xs font-semibold text-ink-3">{SECTION_LABELS[key]}</dt>
            <dd className="mt-0.5 whitespace-pre-wrap text-xs leading-relaxed text-ink-2">{sections[key]}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}
