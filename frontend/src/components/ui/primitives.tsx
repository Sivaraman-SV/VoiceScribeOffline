import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { AlertTriangle, CheckCircle2, Info, Loader2, X } from 'lucide-react'

import { CONFIDENCE_TOOLTIP } from '@/constants'
import { cn } from '@/utils/cn'
import { formatConfidence } from '@/utils/format'

/** Page title block: optional eyebrow line, large title, supporting copy and right-aligned actions. */
export function PageHeader({
  eyebrow,
  title,
  subtitle,
  actions,
  className,
}: {
  eyebrow?: ReactNode
  title: ReactNode
  subtitle?: ReactNode
  actions?: ReactNode
  className?: string
}) {
  return (
    <header className={cn('flex flex-col gap-4 md:flex-row md:items-end md:justify-between', className)}>
      <div className="min-w-0">
        {eyebrow ? <p className="page-eyebrow">{eyebrow}</p> : null}
        <h1 className={cn('page-title', eyebrow ? 'mt-1' : undefined)}>{title}</h1>
        {subtitle ? <p className="page-subtitle mt-2 max-w-2xl">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2.5">{actions}</div> : null}
    </header>
  )
}

export function Card({
  children,
  className,
  as: Tag = 'section',
}: {
  children: ReactNode
  className?: string
  as?: 'section' | 'div' | 'article' | 'aside'
}) {
  return <Tag className={cn('card', className)}>{children}</Tag>
}

export function CardHeader({
  title,
  subtitle,
  icon,
  actions,
  className,
}: {
  title: ReactNode
  subtitle?: ReactNode
  icon?: ReactNode
  actions?: ReactNode
  className?: string
}) {
  return (
    <div className={cn('card-header', className)}>
      <div className="flex min-w-0 items-center gap-3">
        {icon ? <span className="icon-badge-soft">{icon}</span> : null}
        <div className="min-w-0">
          <h2 className="card-title truncate">{title}</h2>
          {subtitle ? <p className="card-subtitle">{subtitle}</p> : null}
        </div>
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  )
}

export function IconButton({
  label,
  className,
  children,
  size = 'md',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; size?: 'sm' | 'md' }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cn('btn-icon', size === 'sm' && 'btn-icon-sm', className)}
      {...props}
    >
      {children}
    </button>
  )
}

export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  className,
  label,
}: {
  value: T
  options: { value: T; label: ReactNode; icon?: ReactNode }[]
  onChange: (value: T) => void
  className?: string
  label?: string
}) {
  return (
    <div className={cn('seg', className)} role="tablist" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="tab"
          aria-selected={option.value === value}
          onClick={() => onChange(option.value)}
          className={cn('seg-item', option.value === value && 'seg-item-active')}
        >
          {option.icon}
          {option.label}
        </button>
      ))}
    </div>
  )
}

export function Panel({
  title,
  icon,
  actions,
  children,
  className,
  bodyClassName,
}: {
  title: string
  icon?: ReactNode
  actions?: ReactNode
  children: ReactNode
  className?: string
  bodyClassName?: string
}) {
  return (
    <section className={cn('panel', className)}>
      <header className="panel-header">
        <h2 className="panel-title">
          {icon ? <span className="text-ink-3">{icon}</span> : null}
          {title}
        </h2>
        {actions ? <div className="flex items-center gap-1.5">{actions}</div> : null}
      </header>
      <div className={cn('min-h-0 flex-1 overflow-y-auto', bodyClassName)}>{children}</div>
    </section>
  )
}

export function Badge({
  children,
  className,
  title,
}: {
  children: ReactNode
  className?: string
  title?: string
}) {
  return (
    <span className={cn('badge', className)} title={title}>
      {children}
    </span>
  )
}

export function StatusDot({ className, pulse = false }: { className?: string; pulse?: boolean }) {
  return (
    <span
      className={cn('inline-block h-2 w-2 shrink-0 rounded-full', pulse && 'animate-pulse-dot', className)}
      aria-hidden
    />
  )
}

export function ConfidenceMeter({
  value,
  label,
  className,
}: {
  value: number
  label?: string
  className?: string
}) {
  const percentage = Math.round(Math.min(Math.max(value, 0), 1) * 100)
  const tone = percentage >= 85 ? 'bg-aqua' : percentage >= 65 ? 'bg-tone-warning-fg' : 'bg-tone-danger-fg'
  return (
    <span
      className={cn('inline-flex items-center gap-1.5 text-2xs text-ink-3', className)}
      title={CONFIDENCE_TOOLTIP}
    >
      <span className="relative h-1.5 w-10 overflow-hidden rounded-full bg-surface-3">
        <span className={cn('absolute inset-y-0 left-0 rounded-full', tone)} style={{ width: `${percentage}%` }} />
      </span>
      <span className="mono">{formatConfidence(value)}</span>
      {label ? <span>{label}</span> : null}
    </span>
  )
}

export function EmptyState({
  icon,
  title,
  detail,
  action,
}: {
  icon?: ReactNode
  title: string
  detail?: string
  action?: ReactNode
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2.5 px-6 py-12 text-center">
      {icon ? (
        <div className="mb-1 grid h-14 w-14 place-items-center rounded-full bg-surface-3 text-ink-3">{icon}</div>
      ) : null}
      <p className="text-sm font-semibold text-ink">{title}</p>
      {detail ? <p className="max-w-sm text-xs leading-relaxed text-ink-3">{detail}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  )
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn('h-4 w-4 animate-spin text-brand', className)} aria-hidden />
}

export function InlineAlert({
  kind = 'info',
  title,
  children,
  onDismiss,
  action,
}: {
  kind?: 'info' | 'warning' | 'error' | 'success'
  title: string
  children?: ReactNode
  onDismiss?: () => void
  action?: ReactNode
}) {
  const tones = {
    info: 'tone-info',
    warning: 'tone-warning',
    error: 'tone-danger',
    success: 'tone-success',
  } as const
  const icons = {
    info: <Info className="h-4 w-4" aria-hidden />,
    warning: <AlertTriangle className="h-4 w-4" aria-hidden />,
    error: <AlertTriangle className="h-4 w-4" aria-hidden />,
    success: <CheckCircle2 className="h-4 w-4" aria-hidden />,
  } as const

  return (
    <div className={cn('flex items-start gap-3 rounded-tile border px-4 py-3 text-xs', tones[kind])} role="status">
      <span className="mt-0.5 shrink-0">{icons[kind]}</span>
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-semibold">{title}</p>
        {children ? <div className="mt-0.5 font-normal leading-relaxed opacity-90">{children}</div> : null}
      </div>
      {action}
      {onDismiss ? (
        <button
          type="button"
          onClick={onDismiss}
          className="shrink-0 rounded-full p-1 opacity-70 transition hover:bg-black/5 hover:opacity-100 dark:hover:bg-white/10"
          aria-label="Dismiss"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      ) : null}
    </div>
  )
}

const STAT_ICON_TONES = {
  default: 'bg-lime text-lime-fg',
  mint: 'bg-tone-success-bg text-tone-success-fg',
  rose: 'bg-tone-danger-bg text-tone-danger-fg',
  butter: 'bg-tone-warning-bg text-tone-warning-fg',
  lavender: 'bg-tone-violet-bg text-tone-violet-fg',
  sky: 'bg-tone-info-bg text-tone-info-fg',
  live: 'bg-tone-danger-bg text-tone-danger-fg',
  review: 'bg-tone-warning-bg text-tone-warning-fg',
  approved: 'bg-tone-success-bg text-tone-success-fg',
} as const

/** White card, tinted icon circle, large figure: the tone colours only the icon. */
export function StatCard({
  label,
  value,
  detail,
  icon,
  tone = 'default',
  action,
}: {
  label: string
  value: ReactNode
  detail?: string
  icon?: ReactNode
  tone?: keyof typeof STAT_ICON_TONES
  action?: ReactNode
}) {
  return (
    <div className="card flex flex-col gap-4 p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className={cn('grid h-11 w-11 shrink-0 place-items-center rounded-full', STAT_ICON_TONES[tone])}>
            {icon || <span className="text-xs font-bold">↗</span>}
          </span>
          <div className="min-w-0">
            <p className="text-xs font-medium text-ink-3">{label}</p>
            <p className="mono mt-0.5 text-2xl font-semibold leading-tight tracking-tight text-ink">{value}</p>
          </div>
        </div>
        {action}
      </div>
      {detail ? <p className="chip self-start">{detail}</p> : null}
    </div>
  )
}

export function SectionDivider({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 px-3 py-2">
      <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-3">{label}</span>
      <span className="h-px flex-1 bg-line" />
    </div>
  )
}

/** Shared dialog shell: backdrop, card, title row with close button. */
export function Modal({
  open,
  title,
  subtitle,
  icon,
  onClose,
  children,
  footer,
  className,
}: {
  open: boolean
  title: ReactNode
  subtitle?: ReactNode
  icon?: ReactNode
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  className?: string
}) {
  if (!open) return null
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" onClick={onClose}>
      <div className={cn('modal max-w-md', className)} onClick={(event) => event.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            {icon ? <span className="icon-badge-soft">{icon}</span> : null}
            <div>
              <h3 className="text-base font-semibold tracking-tight text-ink">{title}</h3>
              {subtitle ? <p className="mt-0.5 text-xs text-ink-3">{subtitle}</p> : null}
            </div>
          </div>
          <IconButton label="Close" size="sm" onClick={onClose}>
            <X className="h-3.5 w-3.5" />
          </IconButton>
        </div>
        <div className="mt-5">{children}</div>
        {footer ? <div className="mt-6 flex items-center justify-end gap-2.5">{footer}</div> : null}
      </div>
    </div>
  )
}

export function ConfirmModal({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  tone = 'danger',
  busy = false,
  onConfirm,
  onCancel,
}: {
  open: boolean
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  tone?: 'danger' | 'primary'
  busy?: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  if (!open) return null

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="modal max-w-sm">
        <div className="flex items-center gap-3">
          <div
            className={cn(
              'grid h-11 w-11 shrink-0 place-items-center rounded-full',
              tone === 'danger' ? 'bg-tone-danger-bg text-tone-danger-fg' : 'bg-brand-soft text-brand',
            )}
          >
            <AlertTriangle className="h-5 w-5" />
          </div>
          <h3 className="text-base font-semibold tracking-tight text-ink">{title}</h3>
        </div>
        <p className="mt-3 text-[13px] leading-relaxed text-ink-2">{message}</p>
        <div className="mt-6 flex items-center justify-end gap-2.5">
          <button type="button" disabled={busy} onClick={onCancel} className="btn-secondary">
            {cancelLabel}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onConfirm}
            className={tone === 'danger' ? 'btn-danger' : 'btn-primary'}
          >
            {busy ? 'Deleting…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
