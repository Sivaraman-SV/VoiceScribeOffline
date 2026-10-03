import type {
  EntityStatus,
  EntityType,
  NoteSectionKey,
  NoteStatus,
  ProcessingStage,
  SessionStatus,
  SpeakerRole,
} from '@/types'

export const API_BASE = import.meta.env.VITE_API_BASE ?? '/api'
export const WS_BASE = import.meta.env.VITE_WS_BASE ?? ''

export const CONFIDENCE_TOOLTIP = 'Model confidence is not a measure of clinical correctness.'

export const SPEAKER_ROLES: SpeakerRole[] = [
  'DOCTOR',
  'PATIENT',
  'NURSE',
  'STAFF',
  'BACKGROUND',
  'UNKNOWN',
]

export const ROLE_STYLES: Record<SpeakerRole, { label: string; badge: string; accent: string; dot: string }> = {
  DOCTOR: {
    label: 'Doctor',
    badge: 'tone-brand',
    accent: 'border-l-brand',
    dot: 'bg-brand',
  },
  PATIENT: {
    label: 'Patient',
    badge: 'tone-info',
    accent: 'border-l-tone-info-fg',
    dot: 'bg-tone-info-fg',
  },
  NURSE: {
    label: 'Nurse',
    badge: 'tone-violet',
    accent: 'border-l-tone-violet-fg',
    dot: 'bg-tone-violet-fg',
  },
  STAFF: {
    label: 'Staff',
    badge: 'tone-warning',
    accent: 'border-l-tone-warning-fg',
    dot: 'bg-tone-warning-fg',
  },
  BACKGROUND: {
    label: 'Background',
    badge: 'tone-neutral',
    accent: 'border-l-line-strong',
    dot: 'bg-ink-3',
  },
  UNKNOWN: {
    label: 'Unknown',
    badge: 'border-line bg-surface text-ink-3',
    accent: 'border-l-line',
    dot: 'bg-line-strong',
  },
}

export const SESSION_STATUS_STYLES: Record<SessionStatus, string> = {
  CREATED: 'tone-neutral',
  LIVE: 'tone-danger',
  PAUSED: 'tone-warning',
  PROCESSING: 'tone-warning',
  REVIEW: 'tone-warning',
  APPROVED: 'tone-success',
  COMPLETED: 'tone-neutral',
}

export const NOTE_STATUS_STYLES: Record<NoteStatus, string> = {
  PROCESSING: 'tone-neutral',
  DRAFT: 'tone-info',
  REVIEW_REQUIRED: 'tone-warning',
  APPROVED: 'tone-success',
  EXPORTED: 'tone-ai',
}

export const NOTE_STATUS_LABELS: Record<NoteStatus, string> = {
  PROCESSING: 'Drafting Note',
  DRAFT: 'Draft Note',
  REVIEW_REQUIRED: 'Needs Review',
  APPROVED: 'Signed & Approved',
  EXPORTED: 'Exported to EHR',
}

export const SECTION_ORDER: NoteSectionKey[] = [
  'chief_complaint',
  'history_of_present_illness',
  'review_of_systems',
  'relevant_medical_history',
  'social_history',
  'family_history',
  'menstrual_history',
  'physical_examination',
  'current_medication',
  'allergies',
  'treatment_history',
  'previous_investigation',
  'assessment',
  'plan',
  'follow_up',
]

export const SECTION_LABELS: Record<NoteSectionKey, string> = {
  chief_complaint: 'Presenting Complaint',
  history_of_present_illness: 'History of Present Illness',
  review_of_systems: 'Review of Systems',
  relevant_medical_history: 'Past History',
  social_history: 'Social History',
  family_history: 'Family History',
  menstrual_history: 'Menstrual History',
  physical_examination: 'Physical Examination',
  current_medication: 'Current Medication',
  allergies: 'Allergies',
  treatment_history: 'Treatment History',
  previous_investigation: 'Previous Investigation',
  assessment: 'Assessment and Plan',
  plan: 'Plan Of Care',
  follow_up: 'Follow-up & Next Steps',
}

/** Always shown, as "Not mentioned" when undiscussed, so a gap is never mistaken for an omission. */
export const CORE_SECTIONS: NoteSectionKey[] = [
  'chief_complaint',
  'history_of_present_illness',
  'review_of_systems',
  'relevant_medical_history',
  'social_history',
  'current_medication',
  'allergies',
  'physical_examination',
  'assessment',
  'plan',
  'follow_up',
]

export const MOM_SECTION_LABELS: Partial<Record<NoteSectionKey, string>> = {
  chief_complaint: 'Meeting Agenda & Objectives',
  history_of_present_illness: 'Discussion & Member Contributions',
  relevant_medical_history: 'Context & Prior Follow-ups',
  assessment: 'Key Findings & Deliberations',
  plan: 'Decisions & Approved Resolutions',
  follow_up: 'Action Items & Assigned Responsibilities',
}

export const SECTION_HINTS: Record<NoteSectionKey, string> = {
  chief_complaint: 'The main presenting symptoms or reasons for consultation.',
  history_of_present_illness: 'Detailed symptoms, timeline, laterality, and triggers.',
  review_of_systems: 'Other systems asked about: positives and pertinent negatives.',
  relevant_medical_history: 'Past health conditions, surgeries, and chronic illnesses.',
  social_history: 'Lifestyle, exercise, gym, diet, supplements, and habits.',
  family_history: 'Familial and hereditary conditions.',
  menstrual_history: 'Menstrual/gynecological history.',
  physical_examination: 'Physical exam findings and vitals (BP, glucose, pulse, temp, SpO2).',
  current_medication: 'Active medications, daily supplements, and vitamins.',
  allergies: 'Documented drug, food, or environmental allergies.',
  treatment_history: 'Prior treatments, OTC medications tried, and their relief.',
  previous_investigation: 'Past lab tests, radiology, MRI, CT, or ECG reports.',
  assessment: 'Clinical impressions and diagnostic observations stated by the doctor.',
  plan: 'Prescriptions, orders, lifestyle recommendations, and treatment plan.',
  follow_up: 'Follow-up timeline and return precautions.',
}

export const ENTITY_GROUPS: { key: EntityType[]; title: string }[] = [
  { title: 'Symptoms Reported', key: ['SYMPTOM'] },
  { title: 'Medications Discussed', key: ['MEDICATION'] },
  { title: 'Allergies Mentioned', key: ['ALLERGY'] },
  { title: 'Examination Findings', key: ['FINDING'] },
  { title: 'Lab & Diagnostic Tests', key: ['INVESTIGATION', 'PROCEDURE'] },
  { title: 'Symptom Qualifiers', key: ['DURATION', 'SEVERITY', 'FREQUENCY', 'CHARACTER'] },
  { title: 'Past Medical History', key: ['MEDICAL_HISTORY'] },
  { title: 'Treatment & Follow-up', key: ['PLAN', 'FOLLOW_UP'] },
  { title: 'Diagnoses Discussed', key: ['DIAGNOSIS_MENTIONED'] },
]

export const ENTITY_STATUS_STYLES: Record<EntityStatus, string> = {
  PRESENT: 'tone-ai',
  NEGATED: 'tone-danger',
  UNCERTAIN: 'tone-warning',
  HISTORICAL: 'tone-violet',
  UNKNOWN: 'tone-neutral',
}

export const ENTITY_STATUS_LABELS: Record<EntityStatus, string> = {
  PRESENT: 'Reported',
  NEGATED: 'Denied',
  UNCERTAIN: 'Uncertain',
  HISTORICAL: 'Past History',
  UNKNOWN: 'Noted',
}

export const PIPELINE_STAGES: { stage: ProcessingStage; label: string }[] = [
  { stage: 'AUDIO_CAPTURE', label: 'Audio Recording' },
  { stage: 'AUDIO_PREPROCESSING', label: 'Audio Cleanup' },
  { stage: 'DIARIZATION', label: 'Speaker Separation' },
  { stage: 'ROLE_ATTRIBUTION', label: 'Doctor/Patient Tagging' },
  { stage: 'ASR', label: 'Speech-to-Text' },
  { stage: 'TRANSCRIPT_ASSEMBLY', label: 'Transcript Generation' },
  { stage: 'CLINICAL_NLP', label: 'Medical Fact Extraction' },
  { stage: 'LLM_STRUCTURING', label: 'Clinical Note Structuring' },
  { stage: 'EVIDENCE_LINKING', label: 'Transcript Citation' },
  { stage: 'NOTE_STATE', label: 'Clinical Note Ready' },
]

export const ENCOUNTER_TYPES: { value: string; label: string }[] = [
  { value: 'MEETING', label: 'College Leadership / Department Heads Meeting (MoM)' },
  { value: 'MDT', label: 'Hospital Multi-Disciplinary Team / MDT Board' },
  { value: 'OUTPATIENT', label: 'Outpatient Visit / Clinic' },
  { value: 'WARD_ROUND', label: 'Inpatient / Ward Round' },
  { value: 'EMERGENCY', label: 'Emergency / Urgent Care' },
  { value: 'OSCE', label: 'Clinical Examination / OSCE' },
  { value: 'TEACHING', label: 'Academic / Case Review' },
  { value: 'OTHER', label: 'General Consultation' },
]

export const SAFETY_NOTICE =
  'VoiceScribe AI documents what was said in the encounter. It does not diagnose, ' +
  'recommend treatment, or replace clinical judgement. Human review is required.'
