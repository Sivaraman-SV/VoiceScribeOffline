import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react'

import { useUiStore } from '@/store/uiStore'
import { cn } from '@/utils/cn'

const ICON_TONES = {
  info: 'bg-tone-info-bg text-tone-info-fg',
  success: 'bg-tone-success-bg text-tone-success-fg',
  warning: 'bg-tone-warning-bg text-tone-warning-fg',
  error: 'bg-tone-danger-bg text-tone-danger-fg',
} as const

const ICONS = {
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  error: XCircle,
} as const

export function ToastHost() {
  const { toasts, dismissToast } = useUiStore()
  if (toasts.length === 0) return null

  return (
    <div className="pointer-events-none fixed bottom-6 right-6 z-50 flex w-80 flex-col gap-2.5">
      {toasts.map((toast) => {
        const Icon = ICONS[toast.kind]
        return (
          <div
            key={toast.id}
            role="status"
            className="pointer-events-auto flex animate-slide-in items-start gap-3 rounded-tile border border-line bg-surface p-3 text-xs text-ink shadow-float"
          >
            <span className={cn('grid h-8 w-8 shrink-0 place-items-center rounded-full', ICON_TONES[toast.kind])}>
              <Icon className="h-4 w-4" aria-hidden />
            </span>
            <div className="min-w-0 flex-1 pt-0.5">
              <p className="text-[13px] font-semibold tracking-tight text-ink">{toast.title}</p>
              {toast.detail ? <p className="mt-0.5 leading-relaxed text-ink-2">{toast.detail}</p> : null}
            </div>
            <button
              type="button"
              onClick={() => dismissToast(toast.id)}
              className="shrink-0 rounded-full p-1 text-ink-3 transition hover:bg-surface-3 hover:text-ink"
              aria-label="Dismiss notification"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )
      })}
    </div>
  )
}
