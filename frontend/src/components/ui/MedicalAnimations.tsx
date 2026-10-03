import React from 'react'
import { cn } from '@/utils/cn'

interface MedicalPulseLoaderProps {
  label?: string
  sublabel?: string
  className?: string
  size?: 'sm' | 'md' | 'lg'
}

export const MedicalPulseLoader: React.FC<MedicalPulseLoaderProps> = ({
  label = 'Processing Consultation...',
  sublabel = 'Synthesizing clinical documentation & entities',
  className,
  size = 'md',
}) => {
  const isSmall = size === 'sm'
  const isLarge = size === 'lg'

  return (
    <div className={cn('flex select-none flex-col items-center justify-center p-6 text-center', className)}>
      <div className="relative mb-4 flex items-center justify-center">
        <div className="absolute inset-0 -m-3 rounded-full bg-aqua/20 blur-xl animate-pulse-dot" />

        <div
          className={cn(
            'relative flex items-center justify-center overflow-hidden rounded-full border border-aqua/40 bg-aqua-soft shadow-card',
            isSmall ? 'h-12 w-12' : isLarge ? 'h-24 w-24' : 'h-18 w-18 px-3 py-3',
          )}
        >
          <svg
            className={cn('text-brand', isSmall ? 'h-8 w-8' : isLarge ? 'h-16 w-16' : 'h-12 w-12')}
            viewBox="0 0 100 40"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <line x1="0" y1="20" x2="100" y2="20" stroke="currentColor" strokeOpacity="0.15" strokeWidth="1" />
            <path
              d="M0 20 L25 20 L32 10 L38 32 L44 5 L50 28 L56 16 L62 20 L100 20"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="animate-pulse"
            />
          </svg>

          <span className="absolute top-1/2 h-1.5 w-1.5 -translate-y-1/2 rounded-full bg-aqua opacity-75 animate-ping" />
        </div>
      </div>

      {label && <p className="text-sm font-semibold tracking-tight text-ink">{label}</p>}
      {sublabel && <p className="mt-1 max-w-xs text-xs leading-relaxed text-ink-3">{sublabel}</p>}
    </div>
  )
}

/**
 * Animated audio equalizer bars for active microphone capture or dictation.
 */
export const AudioEqualizerBars: React.FC<{ active?: boolean; className?: string }> = ({
  active = true,
  className,
}) => {
  return (
    <div className={cn('flex h-5 items-center gap-0.5 px-1', className)}>
      <span
        className={cn(
          'w-1 rounded-full bg-brand transition-all duration-150',
          active ? 'animate-equalizer-1' : 'h-1.5 opacity-40',
        )}
      />
      <span
        className={cn(
          'w-1 rounded-full bg-aqua transition-all duration-150',
          active ? 'animate-equalizer-2' : 'h-2 opacity-40',
        )}
      />
      <span
        className={cn(
          'w-1 rounded-full bg-aqua transition-all duration-150',
          active ? 'animate-equalizer-3' : 'h-1.5 opacity-40',
        )}
      />
      <span
        className={cn(
          'w-1 rounded-full bg-brand transition-all duration-150',
          active ? 'animate-equalizer-4' : 'h-1 opacity-40',
        )}
      />
    </div>
  )
}

/**
 * Animated wrapper for tab panels so switching tabs feels tactile and fluid.
 */
export const TabTransition: React.FC<{
  tabKey: string | number
  children: React.ReactNode
  direction?: 'horizontal' | 'vertical'
  className?: string
}> = ({ tabKey, children, direction = 'vertical', className }) => {
  return (
    <div
      key={tabKey}
      className={cn(
        direction === 'vertical' ? 'animate-fade-in-up' : 'animate-tab-slide',
        'will-change-transform',
        className,
      )}
    >
      {children}
    </div>
  )
}

/**
 * Skeleton placeholder for loading cards and clinical summaries.
 */
export const SkeletonCard: React.FC<{ className?: string }> = ({ className }) => {
  return (
    <div className={cn('card overflow-hidden p-5', className)}>
      <div className="mb-4 flex items-center justify-between">
        <div className="h-4 w-32 rounded-full shimmer-skeleton" />
        <div className="h-6 w-16 rounded-full shimmer-skeleton" />
      </div>
      <div className="space-y-2.5">
        <div className="h-3 w-full rounded-full shimmer-skeleton" />
        <div className="h-3 w-5/6 rounded-full shimmer-skeleton" />
        <div className="h-3 w-4/6 rounded-full shimmer-skeleton" />
      </div>
      <div className="mt-5 flex items-center justify-between border-t border-line pt-3">
        <div className="h-3 w-20 rounded-full shimmer-skeleton" />
        <div className="h-4 w-24 rounded-full shimmer-skeleton" />
      </div>
    </div>
  )
}

/**
 * Animated Beacon Indicator with breathing ping rings.
 */
export const StatusBeacon: React.FC<{
  variant?: 'teal' | 'rose' | 'amber' | 'emerald'
  pulse?: boolean
  className?: string
}> = ({ variant = 'teal', pulse = true, className }) => {
  const colorMap = {
    teal: { dot: 'bg-aqua', ping: 'bg-aqua/70' },
    rose: { dot: 'bg-tone-danger-fg', ping: 'bg-tone-danger-fg/60' },
    amber: { dot: 'bg-tone-warning-fg', ping: 'bg-tone-warning-fg/60' },
    emerald: { dot: 'bg-tone-success-fg', ping: 'bg-tone-success-fg/60' },
  }
  const { dot, ping } = colorMap[variant]

  return (
    <span className={cn('relative flex h-2.5 w-2.5 shrink-0', className)}>
      {pulse && <span className={cn('absolute inline-flex h-full w-full rounded-full opacity-75 animate-ping', ping)} />}
      <span className={cn('relative inline-flex h-2.5 w-2.5 rounded-full', dot)} />
    </span>
  )
}
