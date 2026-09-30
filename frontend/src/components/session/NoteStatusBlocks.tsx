import { Loader2, WifiOff } from 'lucide-react'

import { SECTION_LABELS, SECTION_ORDER } from '@/constants'
import type { NoteFallback, NoteSectionKey } from '@/types'

export function NoteFallbackBanner({ fallback }: { fallback: NoteFallback | null | undefined }) {
  if (!fallback) return null
  return (
    <div
      role="alert"
      className="rounded-xl border-2 border-rose-400 dark:border-rose-700 bg-rose-50 dark:bg-rose-950/60 px-3.5 py-2.5 text-rose-900 dark:text-rose-200"
    >
      <p className="flex items-center gap-2 text-xs font-extrabold uppercase tracking-wide">
        <WifiOff className="h-4 w-4 shrink-0" aria-hidden />[{fallback.label}]
      </p>
      <p className="mt-1 text-2xs leading-relaxed">{fallback.message}</p>
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
      className="w-full rounded-xl border border-dashed border-sky-300 dark:border-sky-800 bg-sky-50/60 dark:bg-sky-950/30 p-3.5 text-left"
    >
      <p className="mb-2 flex items-center gap-1.5 text-2xs font-bold uppercase tracking-wider text-sky-700 dark:text-sky-300">
        <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
        Drafting — not yet verified against the transcript
      </p>
      <dl className="space-y-2">
        {keys.map((key) => (
          <div key={key}>
            <dt className="text-2xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              {SECTION_LABELS[key]}
            </dt>
            <dd className="whitespace-pre-wrap text-xs leading-relaxed text-slate-600 dark:text-slate-300">{sections[key]}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}
