import { useEffect, useRef, useState } from 'react'
import { AudioLines, Check, FileCheck2, Mic, Sparkles, Square } from 'lucide-react'

import { ROLE_STYLES } from '@/constants'
import type { TranscriptSegment } from '@/types'
import { cn } from '@/utils/cn'
import { formatDuration, formatTimestamp } from '@/utils/format'

/**
 * Number of items currently shown out of `total`. When `animate` is on, newly
 * arrived items are released one every `stepMs`; otherwise everything shows at once.
 */
export function useReveal(total: number, stepMs: number, animate: boolean): number {
  const [shown, setShown] = useState(animate ? 0 : total)

  useEffect(() => {
    if (!animate) {
      setShown(total)
      return
    }
    if (shown >= total) {
      if (shown > total) setShown(total)
      return
    }
    const timer = window.setTimeout(() => setShown((value) => Math.min(value + 1, total)), stepMs)
    return () => window.clearTimeout(timer)
  }, [animate, shown, stepMs, total])

  return shown
}

const STEPS = [
  { label: 'Listening', icon: Mic },
  { label: 'Transcribing', icon: AudioLines },
  { label: 'Clinical analysis', icon: Sparkles },
  { label: 'Report ready', icon: FileCheck2 },
] as const

/** Mic → transcript → analysis → report, with particles streaming along the active connector. */
export function FlowStepper({ step, className }: { step: number; className?: string }) {
  return (
    <ol className={cn('flex items-center', className)} aria-label="Consultation progress">
      {STEPS.map(({ label, icon: Icon }, index) => {
        const done = index < step || (index === STEPS.length - 1 && step >= STEPS.length - 1)
        const active = index === step && !done
        return (
          <li key={label} className={cn('flex items-center', index < STEPS.length - 1 && 'flex-1')}>
            <div className="flex shrink-0 items-center gap-2.5">
              <span
                className={cn(
                  'relative grid h-9 w-9 place-items-center rounded-full transition-all duration-500',
                  done && 'bg-brand text-brand-fg',
                  active && 'bg-aqua text-aqua-fg shadow-raised',
                  !done && !active && 'bg-surface-3 text-ink-3',
                )}
              >
                {active ? <span className="absolute inset-0 rounded-full bg-aqua animate-ring-out" aria-hidden /> : null}
                {done ? <Check className="relative h-4 w-4" /> : <Icon className={cn('relative h-4 w-4', active && 'animate-soft-bounce')} />}
              </span>
              <span
                className={cn(
                  'hidden text-xs font-semibold transition-colors sm:inline',
                  active ? 'text-ink' : done ? 'text-ink-2' : 'text-ink-3',
                )}
              >
                {label}
              </span>
            </div>
            {index < STEPS.length - 1 ? (
              <span className="relative mx-3 h-0.5 flex-1 overflow-hidden rounded-full bg-surface-3" aria-hidden>
                <span
                  className="absolute inset-y-0 left-0 rounded-full bg-brand transition-all duration-700"
                  style={{ width: index < step ? '100%' : '0%' }}
                />
                {index === step && !done ? (
                  <>
                    <span className="absolute top-1/2 h-1.5 w-1.5 -translate-y-1/2 rounded-full bg-aqua animate-flow-dot" />
                    <span className="absolute top-1/2 h-1.5 w-1.5 -translate-y-1/2 rounded-full bg-aqua animate-flow-dot [animation-delay:0.55s]" />
                    <span className="absolute top-1/2 h-1.5 w-1.5 -translate-y-1/2 rounded-full bg-lime animate-flow-dot [animation-delay:1.1s]" />
                  </>
                ) : null}
              </span>
            ) : null}
          </li>
        )
      })}
    </ol>
  )
}

const BAR_COUNT = 36

/** The single recording control: one large mic that breathes with the speaker's voice. */
export function RecordingHero({
  recording,
  busy,
  seconds,
  level,
  onToggle,
}: {
  recording: boolean
  busy: boolean
  seconds: number
  level: number
  onToggle: () => void
}) {
  const [bars, setBars] = useState<number[]>(() => Array(BAR_COUNT).fill(0))
  const levelRef = useRef(level)
  levelRef.current = level

  useEffect(() => {
    if (!recording) {
      setBars(Array(BAR_COUNT).fill(0))
      return
    }
    const timer = window.setInterval(() => {
      setBars((previous) => [...previous.slice(1), Math.min(1, levelRef.current * 2.2)])
    }, 90)
    return () => window.clearInterval(timer)
  }, [recording])

  const boost = recording ? 1 + Math.min(level * 1.6, 0.45) : 1

  return (
    <div className="flex flex-col items-center text-center">
      <div className="relative grid h-48 w-48 place-items-center sm:h-56 sm:w-56">
        <span
          className={cn(
            'absolute inset-6 rounded-full blur-3xl transition-colors duration-700',
            recording ? 'bg-tone-danger-fg/25' : 'bg-aqua/25',
          )}
          aria-hidden
        />
        {recording ? (
          <>
            <span className="absolute inset-12 rounded-full border-2 border-tone-danger-fg/40 animate-ring-out" aria-hidden />
            <span className="absolute inset-12 rounded-full border-2 border-tone-danger-fg/30 animate-ring-out [animation-delay:0.8s]" aria-hidden />
            <span className="absolute inset-12 rounded-full border-2 border-tone-danger-fg/20 animate-ring-out [animation-delay:1.6s]" aria-hidden />
          </>
        ) : (
          <span className="absolute inset-12 rounded-full border border-aqua/40 animate-ring-out [animation-duration:3.2s]" aria-hidden />
        )}
        <span
          className={cn(
            'absolute inset-9 rounded-full transition-transform duration-100',
            recording ? 'bg-tone-danger-bg' : 'bg-aqua-soft',
          )}
          style={{ transform: `scale(${boost})` }}
          aria-hidden
        />
        <button
          type="button"
          onClick={onToggle}
          disabled={busy}
          className={cn(
            'relative grid h-24 w-24 place-items-center rounded-full shadow-float transition-all duration-300 focus:outline-none focus-visible:ring-4 focus-visible:ring-brand/30 disabled:cursor-not-allowed disabled:opacity-60 sm:h-28 sm:w-28',
            recording
              ? 'bg-tone-danger-fg text-white dark:text-canvas'
              : 'bg-brand text-brand-fg hover:scale-105 hover:bg-brand-hover',
          )}
          title={recording ? 'Click to stop recording' : 'Click to start recording'}
          aria-label={recording ? 'Stop Recording' : 'Start Recording'}
        >
          {recording ? <Square className="h-8 w-8 fill-current sm:h-9 sm:w-9" /> : <Mic className="h-10 w-10 sm:h-11 sm:w-11" />}
        </button>
      </div>

      <p className={cn('mono mt-1 text-3xl font-semibold tracking-tight sm:text-4xl', recording ? 'text-tone-danger-fg' : 'text-ink-3')}>
        {formatDuration(seconds)}
      </p>

      <div className="mt-5 flex h-10 items-center justify-center gap-[3px]" aria-hidden>
        {bars.map((value, index) => (
          <span
            key={index}
            className={cn(
              'w-1 rounded-full transition-[height] duration-100',
              recording ? 'bg-tone-danger-fg/80' : 'bg-line-strong',
            )}
            style={{ height: `${Math.max(4, Math.round(value * 40))}px` }}
          />
        ))}
      </div>

      <h2 className="mt-4 text-lg font-semibold tracking-tight text-ink sm:mt-5 sm:text-title">
        {busy && !recording ? 'Connecting microphone…' : recording ? 'Listening to the consultation' : 'Ready when you are'}
      </h2>
      <p className="mt-2 max-w-md text-sm text-ink-3">
        {recording
          ? 'Speak naturally in English, Tamil or Hindi. Tap the button to stop and generate the clinical report.'
          : 'Tap the microphone to start recording the doctor–patient conversation.'}
      </p>
    </div>
  )
}

const TRANSCRIBING_STAGES = new Set([
  'AUDIO_PREPROCESSING',
  'ASR',
  'DIARIZATION',
  'ROLE_ATTRIBUTION',
  'TRANSCRIPT_ASSEMBLY',
])

/** Which live-session surface to show. Transcript lines mean transcribing is done. */
export function liveWorkspaceMode(input: {
  recording: boolean
  processing: boolean
  hasTranscript: boolean
  hasNote: boolean
}): 'capture' | 'theater' | 'workspace' {
  if (input.recording) return 'capture'
  if (input.hasTranscript || input.hasNote) return 'workspace'
  if (input.processing) return 'theater'
  return 'capture'
}

export function containsTamil(text: string): boolean {
  return /[\u0B80-\u0BFF]/.test(text)
}

/** Full-viewport beat after the mic stops: listen → transcribe → write the note. */
export function ProcessingTheater({
  stage,
  stageDetail,
  uploading = false,
  hasTranscript = false,
}: {
  stage: string
  stageDetail?: string | null
  uploading?: boolean
  hasTranscript?: boolean
}) {
  const transcribing = !hasTranscript && (uploading || TRANSCRIBING_STAGES.has(stage))
  const step = transcribing ? 1 : 2
  const title = transcribing ? 'Transcribing the consultation' : 'Writing the clinical analysis'
  const detail =
    stageDetail?.trim() ||
    (transcribing
      ? 'Speech is being turned into speaker-attributed dialogue.'
      : 'Findings are being structured into the ambulatory care note.')

  return (
    <div className="flex h-full min-h-0 flex-col items-center justify-center px-6 text-center">
      <div className="relative mb-8 grid h-40 w-40 place-items-center">
        <span className="absolute inset-0 rounded-full bg-aqua/20 blur-3xl" aria-hidden />
        <span className="absolute inset-6 rounded-full border border-aqua/50 animate-ring-out" aria-hidden />
        <span className="absolute inset-6 rounded-full border border-aqua/30 animate-ring-out [animation-delay:0.9s]" aria-hidden />
        <span className="relative grid h-24 w-24 place-items-center rounded-full bg-brand text-brand-fg shadow-float">
          {transcribing ? <AudioLines className="h-10 w-10 animate-soft-bounce" /> : <Sparkles className="h-10 w-10 animate-soft-bounce" />}
        </span>
      </div>
      <div className="mb-8 flex h-12 items-end justify-center gap-1" aria-hidden>
        {[0, 1, 2, 3, 4, 5, 6, 7, 8].map((bar) => (
          <span
            key={bar}
            className="w-1.5 rounded-full bg-aqua animate-equalizer-1"
            style={{ animationDelay: `${bar * 0.08}s` }}
          />
        ))}
      </div>
      <FlowStepper step={step} className="mb-6 w-full max-w-xl" />
      <h2 className="text-title text-ink">{title}</h2>
      <p className="mt-2 max-w-md text-sm text-ink-3">{detail}</p>
    </div>
  )
}

/** Compact left-pane beat used once the transcript is already on screen. */
export function WritingAnalysis({ stageDetail }: { stageDetail?: string | null }) {
  return (
    <div className="flex h-full flex-col items-center justify-center px-6 text-center">
      <div className="relative mb-6 grid h-28 w-28 place-items-center">
        <span className="absolute inset-0 rounded-full bg-aqua/20 blur-2xl" aria-hidden />
        <span className="absolute inset-3 rounded-full border border-aqua/50 animate-ring-out" aria-hidden />
        <span className="relative grid h-16 w-16 place-items-center rounded-full bg-brand text-brand-fg shadow-float">
          <Sparkles className="h-7 w-7 animate-soft-bounce" />
        </span>
      </div>
      <h3 className="text-sm font-semibold text-ink">Writing the clinical analysis</h3>
      <p className="mt-1.5 max-w-xs text-xs leading-relaxed text-ink-3">
        {stageDetail?.trim() || 'Findings are being structured into the ambulatory care note.'}
      </p>
    </div>
  )
}

/** Transcript lines released one by one, newest sliding in, auto-following the latest line. */
export function RevealTranscript({
  segments,
  shown,
  className,
}: {
  segments: TranscriptSegment[]
  shown: number
  className?: string
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const container = scrollRef.current
    if (container) container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' })
  }, [shown])

  return (
    <div ref={scrollRef} className={cn('space-y-2.5 overflow-y-auto', className)}>
      {segments.slice(0, shown).map((segment) => {
        const style = ROLE_STYLES[segment.role] ?? ROLE_STYLES.UNKNOWN
        return (
          <div key={segment.id} className="animate-reveal">
            <div className="mb-1 flex items-center gap-2 text-2xs">
              <span className={cn('h-1.5 w-1.5 rounded-full', style.dot)} />
              <span className="font-semibold text-ink-2">{segment.speaker_label || style.label}</span>
              <span className="mono text-ink-3">{formatTimestamp(segment.start_time)}</span>
            </div>
            <p
              className={cn(
                'rounded-tile rounded-tl-sm bg-surface-2 px-3.5 py-2.5 text-[13px] leading-relaxed text-ink',
                containsTamil(segment.text) && 'font-tamil',
              )}
              lang={containsTamil(segment.text) ? 'ta' : undefined}
            >
              {segment.text}
            </p>
          </div>
        )
      })}
    </div>
  )
}
