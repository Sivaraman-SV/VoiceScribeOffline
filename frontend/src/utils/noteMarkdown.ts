import { NOTE_STATUS_LABELS, SECTION_LABELS, SECTION_ORDER } from '@/constants'
import type { ClinicalEntity, ClinicalNote, ClinicalSection, EntityGroupKey, NoteSectionKey } from '@/types'

export const NOT_MENTIONED_TEXT = 'Not mentioned in consultation'

const UNDOCUMENTED_PHRASES = new Set([
  'not mentioned',
  'not mentioned in consultation',
  'not found',
  'not stated',
  'not discussed',
  'none mentioned',
  'not available',
  'n/a',
  'na',
  'none',
  'unknown',
])

export function isDocumented(section: ClinicalSection | undefined): section is ClinicalSection {
  const text = (section?.text ?? '').trim()
  if (!text) return false
  return !UNDOCUMENTED_PHRASES.has(text.toLowerCase().replace(/[.\s]+$/, ''))
}

const ENTITY_GROUPS: [EntityGroupKey, string][] = [
  ['symptoms', 'Symptoms'],
  ['medications', 'Medications'],
  ['findings', 'Physical Examination Findings'],
  ['investigations', 'Investigations'],
]

function entityLine(entity: ClinicalEntity) {
  const name = entity.normalized_value || entity.value
  const status = entity.status === 'NEGATED' ? ' (denied)' : ''
  const detail = entity.detail ? ` — ${entity.detail}` : ''
  const flag = entity.review_required ? ' ⚠ needs review' : ''
  return `- ${name}${status}${detail}${flag}`
}

/** Renders the note as Markdown; sections the doctor never discussed are written as "Not mentioned". */
export function noteToMarkdown(
  note: ClinicalNote,
  options: { title?: string; labels?: Partial<Record<NoteSectionKey, string>>; sections?: NoteSectionKey[] } = {},
): string {
  const labels = options.labels ?? SECTION_LABELS
  const content = note.content
  const lines: string[] = [`# ${options.title ?? 'Ambulatory Care Clinical Note'}`, '']
  lines.push(`- **Status:** ${NOTE_STATUS_LABELS[note.status]}`)
  lines.push(`- **Version:** ${note.version}`)
  if (content.model) lines.push(`- **Model:** ${content.model}`)
  if (note.approved_by) lines.push(`- **Approved by:** ${note.approved_by}`)
  if (content.fallback) lines.push(`- **Warning:** [${content.fallback.label}] ${content.fallback.message}`)
  lines.push('')

  for (const key of options.sections ?? SECTION_ORDER) {
    const section = content[key]
    const documented = isDocumented(section)
    lines.push(`## ${labels[key] ?? SECTION_LABELS[key]}`, '')
    lines.push(documented ? section.text : `_${NOT_MENTIONED_TEXT}_`)
    if (documented && section.review_required) {
      lines.push('', `> ⚠ Review required${section.review_reason ? `: ${section.review_reason}` : ''}`)
    }
    lines.push('')
  }

  for (const [groupKey, title] of ENTITY_GROUPS) {
    const entities = content[groupKey] ?? []
    if (entities.length === 0) continue
    lines.push(`## ${title}`, '', ...entities.map(entityLine), '')
  }

  const flags = note.review_flags ?? []
  if (flags.length > 0) {
    lines.push('## Review Flags', '', ...flags.map((flag) => `- **${flag.label}:** ${flag.reason}`), '')
  }
  return lines.join('\n').trimEnd() + '\n'
}

export function downloadText(text: string, filename: string, mime = 'text/markdown') {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}
