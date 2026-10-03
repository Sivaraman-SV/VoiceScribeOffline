import type { ReactNode } from 'react'
import { AudioLines, Languages, ShieldCheck, Sparkles } from 'lucide-react'

import type { SystemStatus } from '@/types'
import { cn } from '@/utils/cn'

type Tone = 'ok' | 'idle' | 'off' | 'bad'

const TONE_CLASS: Record<Tone, string> = {
  ok: 'tone-success',
  idle: 'tone-info',
  off: 'tone-neutral',
  bad: 'tone-warning',
}

function Row({
  icon,
  label,
  value,
  badge,
  tone,
  note,
}: {
  icon: ReactNode
  label: string
  value: string
  badge: string
  tone: Tone
  note?: string
}) {
  return (
    <li className="flex gap-3 py-3 first:pt-0 last:pb-0">
      <span className="icon-badge-soft h-9 w-9">{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold text-ink-2">{label}</span>
          <span className={cn('badge', TONE_CLASS[tone])}>{badge}</span>
        </div>
        <p className="mono mt-1 break-words text-xs text-ink">{value}</p>
        {note ? <p className="mt-1 text-[11px] leading-relaxed text-ink-3">{note}</p> : null}
      </div>
    </li>
  )
}

/** Read-only view of the models the backend will actually use; they are chosen in the server .env. */
export function ActiveEngines({ status }: { status: SystemStatus | null }) {
  if (!status) {
    return (
      <p className="rounded-tile border border-tone-warning-line bg-tone-warning-bg px-4 py-3 text-xs text-tone-warning-fg">
        Backend not reachable, so the active models cannot be shown. Start the server (or the Kaggle runner) first.
      </p>
    )
  }

  const { ai, pipeline = {} } = status
  const asr = status.providers.asr
  const second = asr.second_pass
  const llmMock = Boolean(ai.mock) || ai.mode === 'mock'
  const fallbacks = (pipeline.llm_fallback_chain ?? '').split('→').map((m) => m.trim()).filter((m) => m && m !== ai.model)

  let secondBadge = 'Off'
  let secondTone: Tone = 'off'
  let secondNote = 'Not enabled on this server. Whisper handles every language alone.'
  if (second?.status === 'loaded') {
    secondBadge = 'Loaded'
    secondTone = 'ok'
    secondNote = 'Transcribes mostly Tamil / Hindi / Telugu utterances, and re-does any Whisper output that looks broken.'
  } else if (second?.status === 'not_loaded') {
    secondBadge = 'Enabled · loads on first Indian-language speech'
    secondTone = 'idle'
    secondNote = 'Turned on in the server .env. It is downloaded/loaded the first time it is needed; if that fails this shows the reason.'
  } else if (second?.status === 'failed') {
    secondBadge = 'Failed · Whisper only'
    secondTone = 'bad'
    secondNote = second.error ?? 'Could not be loaded.'
  }

  return (
    <ul className="divide-y divide-line">
      <Row
        icon={<Sparkles className="h-4 w-4" aria-hidden />}
        label="Clinical note model"
        value={ai.model}
        badge={llmMock ? 'Mock (rules only)' : 'Ollama'}
        tone={llmMock ? 'bad' : 'ok'}
        note={
          fallbacks.length
            ? `If it is unreachable, ${fallbacks.join(', ')} is tried next; otherwise the note is marked as an offline fallback.`
            : undefined
        }
      />
      <Row
        icon={<AudioLines className="h-4 w-4" aria-hidden />}
        label="Speech-to-text"
        value={asr.model ? `Faster-Whisper ${asr.model} (${asr.compute_type} on ${asr.device})` : asr.name}
        badge={asr.mock ? 'Mock' : asr.loaded ? 'Loaded' : 'Loads on first recording'}
        tone={asr.mock ? 'bad' : asr.loaded ? 'ok' : 'idle'}
      />
      <Row
        icon={<Languages className="h-4 w-4" aria-hidden />}
        label="Languages"
        value={pipeline.languages ?? asr.language_mode ?? '—'}
        badge={asr.language_mode?.startsWith('per-utterance') ? 'Code-switching' : 'Fixed'}
        tone="ok"
      />
      <Row
        icon={<ShieldCheck className="h-4 w-4" aria-hidden />}
        label="Second recogniser (IndicConformer)"
        value={second?.model ?? 'not configured'}
        badge={secondBadge}
        tone={secondTone}
        note={secondNote}
      />
    </ul>
  )
}
