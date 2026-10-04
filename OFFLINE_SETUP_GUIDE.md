# VoiceScribe AI — offline edition (RTX 4050)

Runs air-gapped on a **6 GB RTX 4050 laptop**. No Gemini key. No cloud ASR.

## Pipeline (this is the whole stack)

```
Mic / upload WAV (16 kHz mono)
        │
        ▼
1. Preprocess          VAD, resample — CPU
        │
        ▼
2. Speech-to-text      Faster-Whisper large-v3-turbo, int8, **CPU**
                       Multilingual (Hindi / Tamil / English / mixed).
                       Tamil utterances → Tamil-trained Whisper small (IIT Madras)
        │
        ▼
3. Speakers            Neural speaker embeddings (sherpa-onnx, 26 MB) — CPU
                       Optional doctor voice enrolment → fixed Doctor / Patient
        │
        ▼
4. SOAP note           Gemma 4 E4B via Ollama, **GPU** (Gemma 4 E2B fallback)
                       Temperature 0.1. Documents what was said only.
        │
        ▼
5. Grounding           Invented meds / diagnoses / symptoms are DROPPED
                       if they are not in the transcript.
        │
        ▼
6. Workstation         React UI at http://localhost:5173
```

VRAM: Gemma 4 uses the GPU. Whisper stays on CPU so they do not share 6 GB. On a 6 GB card
E4B may spill partly into system RAM; set `LOCAL_LLM_MODEL=gemma4:e2b` if notes are too slow.

---

## One-time setup (friend's laptop)

**Double-click `INSTALL_A_TO_Z.bat`.**

That is the whole setup. It installs Python, Node.js, Ollama, the Gemma 4 note models named in `.env` (`LOCAL_LLM_MODEL` and `LOCAL_LLM_FALLBACK_MODELS`, by default `gemma4:e4b` and `gemma4:e2b`), CPU Whisper, the speaker recognition model and, for Tamil / Hindi, IndicConformer (CPU PyTorch; it asks once for a free Hugging Face token — press Enter to skip), then opens the app. No CUDA Toolkit. First run can take 15–40 minutes because the Gemma 4 models are several GB.

After that, use `START_VOICESCRIBE.bat` to open the app again.

- App: http://localhost:5173
- API: http://localhost:8000/docs

---

## Doctor voice enrolment (recommended)

Speakers are told apart by voice, but which voice is the doctor is otherwise
guessed from what is said. Enrolling the doctor makes the roles certain:

1. Record the doctor reading anything for 10–30 seconds in the consultation room,
   on the same microphone (Windows Sound Recorder is fine; it saves `.m4a`).
2. Copy the file into the repo, e.g. `voices/dr_kumar.m4a`.
3. In `.env` set `DOCTOR_VOICE_SAMPLE=voices/dr_kumar.m4a` and restart the app.

That voice is then always **Doctor** and, with two people in the room, the other
voice is **Patient**. The backend log shows `doctor_voice_enrolled` on startup.

---

## `.env` (already the default)

| Variable | Value | Why |
|---|---|---|
| `AI_MODE` | `local` | Ollama, not Gemini |
| `LOCAL_LLM_MODEL` | `gemma4:e4b` | Note model on GPU |
| `LOCAL_LLM_FALLBACK_MODELS` | `gemma4:e2b` | Tried if the primary is missing or returns unusable JSON |
| `ASR_PROVIDER` | `faster_whisper` | CTranslate2 Whisper |
| `FASTER_WHISPER_MODEL` | `large-v3-turbo` | Multilingual, including mixed Indian + English. `large-v3` is more accurate for Tamil but ~2x slower on CPU. Do not set this to `small`/`base` (generic Whisper small is poor at Tamil; the Tamil-trained small goes in `ASR_TAMIL_MODEL`) |
| `ASR_SECOND_PASS` | `indic_conformer` | Tamil/Hindi-heavy utterances go to AI4Bharat IndicConformer, far better than Whisper on Tamil. Packages in `backend/requirements-indic.txt` (installer adds them) and a `HUGGINGFACE_TOKEN` that accepted the model terms, needed only for the one-time download; falls back to Whisper if it cannot load |
| `ASR_TAMIL_MODEL` | `models/asr/whisper-tamil-small-ct2` | Tamil-trained Whisper (IIT Madras) for Tamil utterances; English-heavy ones stay on turbo. Half turbo's word errors on Tamil test clips, ~3x faster than real time on CPU. `whisper-tamil-medium-ct2` is ~10% more accurate but barely real time on CPU. The installer converts it; blank = turbo only |
| `ASR_LANGUAGES` | `ta,hi,en` | Language is detected per utterance among these only (Tanglish / Hinglish code-switching) |
| `INDIC_ASR_LANGUAGE` | `code_switching` | `code_switching`/`auto` = per-utterance detection; a code like `ta` forces one language |
| `ASR_DEVICE` | `cpu` | Leaves VRAM for Gemma 4. `auto`/`cuda` only on an 8 GB+ GPU with CUDA 12 + cuDNN 9 DLLs |
| `ASR_COMPUTE_TYPE` | `auto` | Resolves to `int8` on CPU |
| `DIARIZATION_PROVIDER` | `neural` | Speaker embeddings on CPU; tells apart two voices of the same gender. Falls back to `local` pitch clustering if the model file is missing |
| `DIARIZATION_SPLIT_MARGIN` | `0.12` | Raise if one person is split into two speakers; lower if two people are merged |
| `DOCTOR_VOICE_SAMPLE` | *(blank)* | Path to a 10–30 s recording of the doctor (WAV/M4A/MP3). That voice is then always Doctor and the other voice Patient |
