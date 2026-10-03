import React, { useEffect, useState } from 'react'
import {
  Activity,
  CheckCircle2,
  FileCheck2,
  Loader2,
  Mic,
  Sparkles,
  Stethoscope,
  Volume2,
} from 'lucide-react'
import { cn } from '@/utils/cn'
import type { ProcessingStage } from '@/types'

interface Props {
  stage?: ProcessingStage
  stageDetail?: string
  isUploading?: boolean
  className?: string
}

export const ConsultationPipelineAnimation: React.FC<Props> = ({
  stage = 'IDLE',
  stageDetail,
  isUploading = false,
  className,
}) => {
  const [internalStep, setInternalStep] = useState(1)

  useEffect(() => {
    if (['ASR', 'DIARIZATION', 'ROLE_ATTRIBUTION', 'TRANSCRIPT_ASSEMBLY', 'AUDIO_PREPROCESSING'].includes(stage)) {
      setInternalStep(1)
    } else if (['CLINICAL_NLP', 'EVIDENCE_LINKING'].includes(stage)) {
      setInternalStep(2)
    } else if (['LLM_STRUCTURING', 'NOTE_STATE'].includes(stage)) {
      setInternalStep(3)
    } else if (isUploading) {
      const t1 = setTimeout(() => setInternalStep(2), 2200)
      const t2 = setTimeout(() => setInternalStep(3), 4800)
      return () => {
        clearTimeout(t1)
        clearTimeout(t2)
      }
    }
  }, [stage, isUploading])

  const steps = [
    {
      step: 1,
      title: 'Speech Diarization & Transcription',
      desc: 'Transcribing medical speech and separating doctor/patient utterances',
      icon: Volume2,
      active: internalStep === 1,
      done: internalStep > 1,
    },
    {
      step: 2,
      title: 'Clinical Entity Extraction',
      desc: 'Identifying symptoms, medications, dosages, and examination findings',
      icon: Stethoscope,
      active: internalStep === 2,
      done: internalStep > 2,
    },
    {
      step: 3,
      title: 'SOAP Note Synthesis',
      desc: 'Structuring Chief Complaint, HPI, Physical Exam & Assessment Plan',
      icon: FileCheck2,
      active: internalStep === 3,
      done: false,
    },
  ]

  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center p-6 text-center select-none animate-fade-in',
        className,
      )}
    >
      <div className="relative mb-6 flex items-center justify-center">
        <div className="absolute -inset-5 rounded-full bg-aqua/15 blur-xl animate-pulse" />
        <div className="absolute -inset-1.5 rounded-full border border-aqua/30 animate-ping opacity-40" />

        <div className="relative grid h-20 w-20 place-items-center rounded-full border border-aqua/40 bg-aqua-soft text-brand shadow-raised">
          {internalStep === 1 && <Mic className="h-8 w-8 animate-bounce" />}
          {internalStep === 2 && <Activity className="h-8 w-8 animate-pulse" />}
          {internalStep === 3 && <Sparkles className="h-8 w-8 animate-spin" />}

          <span className="absolute -top-0.5 right-2 h-2.5 w-2.5 rounded-full bg-aqua animate-ping" />
        </div>
      </div>

      <h3 className="flex items-center gap-2 text-base font-semibold tracking-tight text-ink">
        <span>
          {internalStep === 1
            ? 'Transcribing Audio...'
            : internalStep === 2
              ? 'Analyzing Clinical Entities...'
              : 'Assembling Structured Note...'}
        </span>
        <Loader2 className="h-4 w-4 shrink-0 animate-spin text-aqua" />
      </h3>

      <p className="mt-1.5 max-w-sm text-xs leading-relaxed text-ink-3">
        {stageDetail ||
          (internalStep === 1
            ? 'Translating acoustic signals into speaker-attributed dialogue turns'
            : internalStep === 2
              ? 'Extracting clinical terms, prescriptions, and ambulatory observations'
              : 'Synthesizing comprehensive SOAP clinical note with SNOMED mapping')}
      </p>

      <div className="tile mt-7 w-full max-w-sm space-y-1.5 p-2">
        {steps.map((s) => (
          <div
            key={s.step}
            className={cn(
              'flex items-center gap-3 rounded-control border p-2.5 text-left transition-all duration-300',
              s.active
                ? 'border-aqua/40 bg-surface shadow-card'
                : s.done
                  ? 'border-transparent opacity-90'
                  : 'border-transparent opacity-50',
            )}
          >
            <div
              className={cn(
                'grid h-8 w-8 shrink-0 place-items-center rounded-full text-xs font-semibold transition-colors',
                s.done
                  ? 'bg-tone-success-bg text-tone-success-fg'
                  : s.active
                    ? 'bg-aqua text-aqua-fg'
                    : 'bg-surface-3 text-ink-3',
              )}
            >
              {s.done ? (
                <CheckCircle2 className="h-4 w-4" />
              ) : s.active ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <span>{s.step}</span>
              )}
            </div>

            <div className="min-w-0 flex-1 leading-tight">
              <p
                className={cn(
                  'truncate text-xs font-semibold',
                  s.active ? 'text-ink' : s.done ? 'text-ink-2' : 'text-ink-3',
                )}
              >
                {s.title}
              </p>
              <p className="mt-0.5 truncate text-2xs text-ink-3">
                {s.desc}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
