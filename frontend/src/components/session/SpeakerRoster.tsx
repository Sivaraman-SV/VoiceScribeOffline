import { useState } from 'react'
import { UserCog } from 'lucide-react'

import { EmptyState, Panel, StatusDot } from '@/components/ui/primitives'
import { ROLE_STYLES, SPEAKER_ROLES } from '@/constants'
import { api } from '@/services/api'
import { useUiStore } from '@/store/uiStore'
import type { Speaker, SpeakerRole } from '@/types'
import { cn } from '@/utils/cn'
import { formatSpeakerDisplayName } from '@/utils/format'

/**
 * Diarization proposes speaker labels; the clinician owns the final role. A human
 * override re-runs clinical structuring so the note reflects the corrected roles.
 */
export function SpeakerRoster({
  speakers,
  editable = false,
  compact = false,
  onChanged,
}: {
  speakers: Speaker[]
  editable?: boolean
  compact?: boolean
  onChanged?: (speaker: Speaker) => void
}) {
  const [busy, setBusy] = useState<string | null>(null)
  const pushToast = useUiStore((state) => state.pushToast)

  const update = async (speaker: Speaker, role: SpeakerRole) => {
    if (role === speaker.role) return
    setBusy(speaker.id)
    try {
      const updated = await api.updateSpeakerRole(speaker.id, role)
      onChanged?.(updated)
      pushToast({
        kind: 'success',
        title: `${speaker.label} set to ${ROLE_STYLES[role].label}`,
        detail: 'Clinical note will re-structure with the updated speaker roles.',
      })
    } catch (error) {
      pushToast({ kind: 'error', title: 'Could not update speaker role', detail: (error as Error).message })
    } finally {
      setBusy(null)
    }
  }

  const body =
    speakers.length === 0 ? (
      <EmptyState title="Listening for voices" detail="Detected participants (Doctor, Patient) will appear here automatically." />
    ) : (
      <ul className={cn('divide-y divide-line', compact && 'text-xs')}>
        {speakers.map((speaker) => {
          const role = ROLE_STYLES[speaker.role] ?? ROLE_STYLES.UNKNOWN
          const speakerInfo = formatSpeakerDisplayName(speaker.label, speaker.role, speaker.display_name)
          return (
            <li key={speaker.id} className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-2">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-surface-3">
                <StatusDot className={role.dot} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-semibold text-ink">{speakerInfo.title}</p>
                <p className="text-2xs font-medium text-ink-3">
                  {speaker.role_source === 'HUMAN' ? 'Custom Assigned' : `Detected ${role.label}`}
                </p>
              </div>
              {editable ? (
                <select
                  value={speaker.role}
                  disabled={busy === speaker.id}
                  onChange={(event) => void update(speaker, event.target.value as SpeakerRole)}
                  className="rounded-full border border-line bg-surface px-3 py-1 text-2xs font-semibold text-ink-2 transition hover:border-line-strong focus:border-brand/50 focus:outline-none focus:ring-4 focus:ring-brand/10 disabled:opacity-50"
                  aria-label={`Role for ${speaker.label}`}
                >
                  {SPEAKER_ROLES.map((option) => (
                    <option key={option} value={option}>
                      {ROLE_STYLES[option].label}
                    </option>
                  ))}
                </select>
              ) : (
                <span className={cn('badge', role.badge)}>
                  {role.label}
                </span>
              )}
            </li>
          )
        })}
      </ul>
    )

  if (compact) return body

  return (
    <Panel title="Participants" icon={<UserCog className="h-3.5 w-3.5" aria-hidden />} className="shrink-0">
      {body}
    </Panel>
  )
}
