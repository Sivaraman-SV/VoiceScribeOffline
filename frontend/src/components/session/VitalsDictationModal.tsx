import { useEffect, useRef, useState } from 'react'
import { Activity, Check, Mic, RotateCcw, Square, X } from 'lucide-react'

import { Spinner } from '@/components/ui/primitives'
import { downsample, encodeWav } from '@/hooks/useAudioRecorder'
import { api } from '@/services/api'

interface Props {
  open: boolean
  onClose: () => void
  onAddVitals: (vitalsSummary: string, medsSummary: string) => Promise<void>
}

const TARGET_SAMPLE_RATE = 16000

export function VitalsDictationModal({ open, onClose, onAddVitals }: Props) {
  const [dictatedText, setDictatedText] = useState('')
  const [bp, setBp] = useState('')
  const [sugar, setSugar] = useState('')
  const [pulse, setPulse] = useState('')
  const [spo2, setSpo2] = useState('')
  const [temp, setTemp] = useState('')
  const [meds, setMeds] = useState('')
  const [isRecording, setIsRecording] = useState(false)
  const [transcribing, setTranscribing] = useState(false)
  const [audioLevel, setAudioLevel] = useState(0)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [showManual, setShowManual] = useState(false)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recognitionRef = useRef<any>(null)
  const isListeningRef = useRef(false)
  const finalTranscriptRef = useRef('')

  const audioContextRef = useRef<AudioContext | null>(null)
  const mediaStreamRef = useRef<MediaStream | null>(null)
  const processorRef = useRef<ScriptProcessorNode | null>(null)
  const audioChunksRef = useRef<Float32Array[]>([])

  const cleanupAudio = () => {
    isListeningRef.current = false
    setIsRecording(false)
    setAudioLevel(0)

    if (recognitionRef.current) {
      try {
        recognitionRef.current.abort()
      } catch {}
      recognitionRef.current = null
    }

    if (processorRef.current) {
      try {
        processorRef.current.disconnect()
      } catch {}
      processorRef.current = null
    }

    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop())
      mediaStreamRef.current = null
    }

    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      try {
        void audioContextRef.current.close()
      } catch {}
      audioContextRef.current = null
    }
  }

  useEffect(() => {
    if (!open) {
      cleanupAudio()
      setErrorMsg(null)
    }
    return () => cleanupAudio()
  }, [open])

  if (!open) return null

  const startListening = async () => {
    setErrorMsg(null)
    audioChunksRef.current = []

    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
      })
      mediaStreamRef.current = stream
    } catch {
      setErrorMsg('Microphone access was denied. Please allow microphone permissions in your browser.')
      return
    }

    // Setup AudioContext for live PCM capture and audio level metering
    try {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      const ctx = new AudioCtx()
      audioContextRef.current = ctx
      const source = ctx.createMediaStreamSource(stream)
      const processor = ctx.createScriptProcessor(4096, 1, 1)
      processorRef.current = processor

      processor.onaudioprocess = (e) => {
        const input = e.inputBuffer.getChannelData(0)
        audioChunksRef.current.push(new Float32Array(input))

        let sum = 0
        for (let i = 0; i < input.length; i++) {
          sum += input[i] * input[i]
        }
        const rms = Math.sqrt(sum / input.length)
        setAudioLevel(Math.min(1, rms * 5))
      }

      source.connect(processor)
      processor.connect(ctx.destination)
    } catch (err) {
      console.warn('AudioContext recording initialization issue:', err)
    }

    // Start Web Speech API in parallel for instant display
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const win = window as any
    const SpeechRecognition = win.SpeechRecognition || win.webkitSpeechRecognition

    if (SpeechRecognition) {
      try {
        const recognition = new SpeechRecognition()
        recognition.continuous = true
        recognition.interimResults = true
        recognition.maxAlternatives = 1
        recognition.lang = 'en-US'

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        recognition.onresult = (event: any) => {
          let interim = ''
          for (let i = event.resultIndex; i < event.results.length; i++) {
            const transcript = event.results[i][0].transcript
            if (event.results[i].isFinal) {
              finalTranscriptRef.current += (finalTranscriptRef.current ? ' ' : '') + transcript.trim()
            } else {
              interim += transcript
            }
          }
          const fullText = finalTranscriptRef.current + (interim ? ' ' + interim.trim() : '')
          if (fullText.trim()) {
            setDictatedText(fullText.trim())
          }
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        recognition.onerror = (event: any) => {
          if (event.error === 'no-speech' || event.error === 'audio-capture') return
        }

        recognition.onend = () => {
          if (isListeningRef.current) {
            try {
              recognition.start()
            } catch {}
          }
        }

        recognitionRef.current = recognition
        recognition.start()
      } catch (err) {
        console.warn('SpeechRecognition initialization issue:', err)
      }
    }

    isListeningRef.current = true
    setIsRecording(true)
  }

  const stopListening = async () => {
    isListeningRef.current = false
    setIsRecording(false)
    setAudioLevel(0)

    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop()
      } catch {}
    }

    const currentText = dictatedText.trim()
    const chunks = audioChunksRef.current

    // If Web Speech API already transcribed text, we're done
    if (currentText.length > 0) {
      cleanupAudio()
      return
    }

    // If no text was captured by Web Speech API, fallback to backend WAV transcription
    if (chunks.length > 0 && audioContextRef.current) {
      setTranscribing(true)
      try {
        const sampleRate = audioContextRef.current.sampleRate
        const totalSamples = chunks.reduce((acc, c) => acc + c.length, 0)
        const merged = new Float32Array(totalSamples)
        let offset = 0
        for (const chunk of chunks) {
          merged.set(chunk, offset)
          offset += chunk.length
        }
        const downsampled = downsample(merged, sampleRate, TARGET_SAMPLE_RATE)
        const wavBuffer = encodeWav(downsampled, TARGET_SAMPLE_RATE)
        const wavBlob = new Blob([wavBuffer], { type: 'audio/wav' })

        const res = await api.transcribeClip(wavBlob)
        if (res.detail?.text) {
          const text = res.detail.text.trim()
          setDictatedText((prev) => (prev ? `${prev} ${text}` : text))
          finalTranscriptRef.current = text
        } else if (res.message && !res.ok) {
          setErrorMsg(res.message)
        }
      } catch (err) {
        console.warn('Backend clip transcription failed:', err)
      } finally {
        setTranscribing(false)
      }
    }

    cleanupAudio()
  }

  const handleClear = () => {
    finalTranscriptRef.current = ''
    setDictatedText('')
  }

  const handleApply = async () => {
    if (isRecording) {
      await stopListening()
    }
    setSaving(true)
    try {
      const vitalsParts: string[] = []
      if (bp.trim()) vitalsParts.push(`BP: ${bp.trim()} mmHg`)
      if (sugar.trim()) vitalsParts.push(`Blood Sugar: ${sugar.trim()} mg/dL`)
      if (pulse.trim()) vitalsParts.push(`Pulse: ${pulse.trim()} bpm`)
      if (spo2.trim()) vitalsParts.push(`SpO2: ${spo2.trim()}%`)
      if (temp.trim()) vitalsParts.push(`Temp: ${temp.trim()} °F`)
      if (dictatedText.trim()) vitalsParts.push(dictatedText.trim())

      const vitalsText = vitalsParts.join(', ')
      await onAddVitals(vitalsText, meds.trim())
      onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="modal max-h-[90vh] max-w-lg overflow-y-auto">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="icon-badge">
              <Activity className="h-5 w-5" aria-hidden />
            </span>
            <div>
              <h3 className="text-base font-semibold tracking-tight text-ink">Clinical Dictation & Vitals Entry</h3>
              <p className="mt-0.5 text-xs text-ink-3">Record or enter patient vitals, physical observations, and medications.</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              cleanupAudio()
              onClose()
            }}
            className="btn-icon btn-icon-sm"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="mt-5 space-y-4">
          {errorMsg ? (
            <div className="tone-danger rounded-tile border px-4 py-3 text-xs">
              {errorMsg}
            </div>
          ) : null}

          <div className="tile p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <div
                  className={`grid h-9 w-9 shrink-0 place-items-center rounded-full transition ${
                    isRecording ? 'bg-tone-danger-bg text-tone-danger-fg animate-pulse' : 'bg-aqua-soft text-brand'
                  }`}
                >
                  <Mic className="h-4 w-4" aria-hidden />
                </div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h4 className="text-[13px] font-semibold text-ink">Voice Dictation</h4>
                    {isRecording ? (
                      <span className="badge tone-danger">
                        <span className="h-1.5 w-1.5 rounded-full bg-tone-danger-fg animate-ping" />
                        Listening Active
                      </span>
                    ) : transcribing ? (
                      <span className="badge tone-ai">
                        <Spinner className="h-3 w-3 text-brand" /> Transcribing Audio…
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-0.5 text-2xs text-ink-3">
                    Dictate clinical observations (e.g. &ldquo;BP 120/80, pulse 72, blood sugar 110, on Metformin 500mg&rdquo;)
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-1.5">
                {dictatedText ? (
                  <button
                    type="button"
                    onClick={handleClear}
                    title="Clear transcript"
                    className="btn-icon btn-icon-sm"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                  </button>
                ) : null}

                <button
                  type="button"
                  onClick={isRecording ? () => void stopListening() : () => void startListening()}
                  disabled={transcribing}
                  className={isRecording ? 'btn-danger btn-sm' : 'btn-teal btn-sm'}
                >
                  {isRecording ? (
                    <>
                      <Square className="h-3.5 w-3.5 fill-current" aria-hidden /> Stop Dictation
                    </>
                  ) : (
                    <>
                      <Mic className="h-3.5 w-3.5" aria-hidden /> Start Speaking
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* Live Audio Level Meter */}
            {isRecording ? (
              <div className="mt-3 flex items-center gap-2">
                <span className="text-2xs font-medium text-ink-3">Voice Input:</span>
                <div className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-surface-3">
                  <div
                    className="absolute inset-y-0 left-0 rounded-full bg-aqua transition-[width] duration-75"
                    style={{ width: `${Math.min(100, Math.round(audioLevel * 100))}%` }}
                  />
                </div>
              </div>
            ) : null}

            <textarea
              value={dictatedText}
              onChange={(e) => {
                setDictatedText(e.target.value)
                finalTranscriptRef.current = e.target.value
              }}
              placeholder="Spoken or typed vitals dictation... (e.g. Blood pressure is 120/80, pulse 72 bpm, random blood glucose 105 mg/dL, patient is on Aspirin 75mg once daily)"
              rows={3}
              className="field-input mt-3 resize-none text-xs"
            />
          </div>

          <div>
            <button
              type="button"
              onClick={() => setShowManual(!showManual)}
              className="btn-ghost btn-sm -ml-3"
            >
              <Activity className="h-3.5 w-3.5 text-ink-3" aria-hidden />
              <span>{showManual ? 'Hide Quick Fields' : 'Optional Structured Entry Fields'}</span>
            </button>

            {showManual ? (
              <div className="tile mt-2 grid grid-cols-2 gap-3 p-4 animate-fade-in sm:grid-cols-3">
                <label className="text-2xs font-semibold text-ink-2">
                  Blood Pressure (BP)
                  <input
                    type="text"
                    placeholder="e.g. 120/80"
                    value={bp}
                    onChange={(e) => setBp(e.target.value)}
                    className="field-input mt-1.5 py-2 text-xs"
                  />
                </label>

                <label className="text-2xs font-semibold text-ink-2">
                  Blood Sugar / Glucose
                  <input
                    type="text"
                    placeholder="e.g. 110 mg/dL"
                    value={sugar}
                    onChange={(e) => setSugar(e.target.value)}
                    className="field-input mt-1.5 py-2 text-xs"
                  />
                </label>

                <label className="text-2xs font-semibold text-ink-2">
                  Pulse / Heart Rate
                  <input
                    type="text"
                    placeholder="e.g. 74 bpm"
                    value={pulse}
                    onChange={(e) => setPulse(e.target.value)}
                    className="field-input mt-1.5 py-2 text-xs"
                  />
                </label>

                <label className="text-2xs font-semibold text-ink-2">
                  SpO2 (%)
                  <input
                    type="text"
                    placeholder="e.g. 98%"
                    value={spo2}
                    onChange={(e) => setSpo2(e.target.value)}
                    className="field-input mt-1.5 py-2 text-xs"
                  />
                </label>

                <label className="text-2xs font-semibold text-ink-2">
                  Temperature (°F)
                  <input
                    type="text"
                    placeholder="e.g. 98.6"
                    value={temp}
                    onChange={(e) => setTemp(e.target.value)}
                    className="field-input mt-1.5 py-2 text-xs"
                  />
                </label>

                <label className="text-2xs font-semibold text-ink-2 sm:col-span-3">
                  Current Medications & Supplements
                  <input
                    type="text"
                    placeholder="e.g. Metformin 500mg, Atorvastatin 10mg, Omega-3"
                    value={meds}
                    onChange={(e) => setMeds(e.target.value)}
                    className="field-input mt-1.5 py-2 text-xs"
                  />
                </label>
              </div>
            ) : null}
          </div>

          <div className="flex items-center justify-end gap-2.5 border-t border-line pt-4">
            <button
              type="button"
              onClick={() => {
                cleanupAudio()
                onClose()
              }}
              className="btn-secondary"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void handleApply()}
              disabled={saving || (!dictatedText.trim() && !bp.trim() && !sugar.trim() && !pulse.trim() && !meds.trim())}
              className="btn-primary"
            >
              {saving ? <Spinner className="text-brand-fg" /> : <Check className="h-3.5 w-3.5" aria-hidden />}
              Apply to Consultation Note
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

