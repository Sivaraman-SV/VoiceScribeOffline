import { CircleStop, Cpu, Mic, MicOff, Pause, Play, RefreshCw, Wifi, WifiOff } from 'lucide-react'

import { StatusDot } from '@/components/ui/primitives'
import type { ConnectionState } from '@/services/socket'
import type { AiStatus, Session } from '@/types'
import { cn } from '@/utils/cn'
import { formatTimestamp } from '@/utils/format'

interface Props {
  session: Session
  elapsed: number
  connection: ConnectionState
  ai: AiStatus | null
  audioActive: boolean
  audioLabel: string
  busy: boolean
  onPause: () => void
  onResume: () => void
  onStop: () => void
  onRetryAi: () => void
}

export function SessionBar({
  session,
  elapsed,
  connection,
  ai,
  audioActive,
  audioLabel,
  busy,
  onPause,
  onResume,
  onStop,
  onRetryAi,
}: Props) {
  const isLive = session.status === 'LIVE'
  const isPaused = session.status === 'PAUSED'
  const canEnd = ['LIVE', 'PAUSED', 'PROCESSING'].includes(session.status)

  const aiLabel = !ai
    ? 'AI Scribe: Ready'
    : ai.mock
      ? 'AI Scribe: Local Demo'
      : ai.degraded
        ? 'AI Scribe: Degraded'
        : 'AI Scribe: Active'
  const aiOk = Boolean(ai && !ai.degraded)

  return (
    <header className="flex flex-wrap items-center justify-between gap-x-5 gap-y-3 rounded-card border border-line bg-surface px-5 py-3 text-ink shadow-card">
      <div className="flex min-w-0 items-center gap-3">
        <span className={cn('badge uppercase tracking-wider', isLive ? 'tone-danger' : isPaused ? 'tone-warning' : 'tone-neutral')}>
          <StatusDot
            className={cn('h-1.5 w-1.5', isLive ? 'bg-tone-danger-fg' : isPaused ? 'bg-tone-warning-fg' : 'bg-ink-3')}
            pulse={isLive}
          />
          {session.status}
        </span>
        <div className="min-w-0 leading-tight">
          <div className="flex items-center gap-2">
            <span className="mono text-xs font-semibold text-ink">{session.reference}</span>
            <span className="text-2xs text-ink-3">·</span>
            <span className="text-xs font-medium text-ink-2">Pt. {session.patient_id}</span>
          </div>
          <p className="mt-0.5 max-w-[16rem] truncate text-2xs text-ink-3">{session.name}</p>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <p
          className={cn('mono text-2xl font-semibold tracking-tight', isLive ? 'text-tone-danger-fg' : 'text-ink')}
          aria-label="Session timer"
        >
          {formatTimestamp(elapsed)}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-1.5 text-2xs">
        <span className={cn('badge py-1 font-medium', audioActive ? 'tone-ai' : 'tone-neutral')} title={`Audio source: ${audioLabel}`}>
          {audioActive ? (
            <Mic className="h-3.5 w-3.5 animate-pulse" aria-hidden />
          ) : (
            <MicOff className="h-3.5 w-3.5" aria-hidden />
          )}
          <span>{audioActive ? 'Mic Active' : 'Mic Idle'}</span>
        </span>
        <span className={cn('badge py-1 font-medium', aiOk ? 'tone-ai' : 'tone-warning')} title={aiLabel}>
          <Cpu className="h-3.5 w-3.5" aria-hidden />
          {aiLabel}
        </span>
        <span className={cn('badge py-1 font-medium', connection === 'open' ? 'tone-success' : 'tone-warning')}>
          {connection === 'open' ? (
            <Wifi className="h-3.5 w-3.5" aria-hidden />
          ) : (
            <WifiOff className="h-3.5 w-3.5" aria-hidden />
          )}
          {connection === 'open' ? 'Live Synced' : connection === 'reconnecting' ? 'Reconnecting…' : connection}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onRetryAi}
          disabled={busy}
          className="btn-ghost btn-sm"
          title="Force a clinical structuring pass now"
        >
          <RefreshCw className="h-3.5 w-3.5" aria-hidden />
          Refresh Note
        </button>
        {isLive ? (
          <button type="button" onClick={onPause} disabled={busy} className="btn-secondary btn-sm">
            <Pause className="h-3.5 w-3.5" aria-hidden />
            Pause
          </button>
        ) : null}
        {isPaused ? (
          <button type="button" onClick={onResume} disabled={busy} className="btn-primary btn-sm">
            <Play className="h-3.5 w-3.5" aria-hidden />
            Resume
          </button>
        ) : null}
        <button type="button" onClick={onStop} disabled={busy || !canEnd} className="btn-danger btn-sm">
          <CircleStop className="h-3.5 w-3.5" aria-hidden />
          End Encounter & Review
        </button>
      </div>
    </header>
  )
}
