"""Neural (speaker-embedding) diarization — clustering logic with synthetic embeddings, no model file."""

from __future__ import annotations

import numpy as np
import pytest

from app.core.config import DiarizationProviderName, settings
from app.models.enums import AudioSource, SpeakerRole
from app.services.diarization import build_diarization_provider
from app.services.diarization import neural_provider
from app.services.diarization.local_provider import LocalDiarizationProvider
from app.services.diarization.neural_provider import NeuralDiarizationProvider, _split_voices
from app.services.types import AudioFrame

RATE = 16000
_RNG = np.random.default_rng(7)
# Two voices whose embeddings are as close as two similar male voices (cosine ~0.7).
_BASE = _RNG.normal(size=64)
_VOICES = {}
for _code in (1, 2, 3):
    _v = 0.65 * _BASE / np.linalg.norm(_BASE) + 0.35 * _RNG.normal(size=64) / 8
    _VOICES[_code] = _v / np.linalg.norm(_v)


def _fake_embed(_extractor, samples, _rate):
    """The voice is encoded in the sample amplitude; each utterance gets fresh noise."""
    code = int(round(float(np.abs(samples).max()) * 10))
    noisy = _VOICES[code] + _RNG.normal(size=64) * 0.025
    return noisy / np.linalg.norm(noisy)


@pytest.fixture
def fake_model(monkeypatch):
    monkeypatch.setattr(neural_provider, "load_extractor", lambda: object())
    monkeypatch.setattr(neural_provider, "embed", _fake_embed)


def _frame(utterances: list[tuple[int, float]], start: float, seq: int) -> AudioFrame:
    """utterances: (voice code, seconds), separated by 0.5 s pauses."""
    pcm, hints, t = [], [], start
    for code, seconds in utterances:
        pcm.append(np.full(int(seconds * RATE), code / 10, dtype=np.float32))
        pcm.append(np.zeros(int(0.5 * RATE), dtype=np.float32))
        hints.append({"start_time": t, "end_time": t + seconds})
        t += seconds + 0.5
    audio = (np.concatenate(pcm) * 32767).astype(np.int16)
    frame = AudioFrame(
        session_id="neural", sequence=seq, pcm=audio.tobytes(), sample_rate=RATE, channels=1,
        start_time=start, end_time=t, source=AudioSource.MICROPHONE, speech_ratio=0.8,
    )
    frame.hints["asr_segments"] = hints
    return frame


async def _run(provider, frames):
    out = []
    for frame in frames:
        for turn in await provider.diarize(frame):
            out.append(turn.speaker_id)
    return out


async def test_similar_voices_are_separated_and_keep_their_labels(fake_model) -> None:
    provider = NeuralDiarizationProvider(max_speakers=2, doctor_sample="")
    frames = [
        _frame([(1, 3.0), (2, 4.0), (1, 2.5)], 0.0, 0),
        _frame([(2, 3.5), (1, 3.0), (2, 2.0)], 20.0, 1),
        _frame([(1, 4.0), (2, 3.0)], 40.0, 2),
    ]
    labels = await _run(provider, frames)
    voice_of = dict(zip(labels, [1, 2, 1, 2, 1, 2, 1, 2]))
    assert len(set(labels)) == 2
    assert labels == [next(k for k, v in voice_of.items() if v == code) for code in [1, 2, 1, 2, 1, 2, 1, 2]]


async def test_single_voice_is_never_split(fake_model) -> None:
    provider = NeuralDiarizationProvider(max_speakers=2, doctor_sample="")
    frames = [_frame([(1, 3.0), (1, 4.0), (1, 2.5)], 20.0 * i, i) for i in range(4)]
    assert set(await _run(provider, frames)) == {"speaker_0"}


async def test_enrolled_doctor_is_speaker_0_even_when_patient_speaks_first(fake_model, monkeypatch) -> None:
    monkeypatch.setattr(neural_provider, "read_audio", lambda _path: (np.full(RATE * 5, 0.1, dtype=np.float32), RATE))
    provider = NeuralDiarizationProvider(max_speakers=2, doctor_sample="doctor.wav")
    assert provider.enrolled
    labels = await _run(provider, [_frame([(2, 4.0), (1, 3.0), (2, 3.0)], 0.0, 0)])
    assert labels == ["speaker_1", "speaker_0", "speaker_1"]
    assert provider.known_roles("neural") == {"speaker_0": SpeakerRole.DOCTOR, "speaker_1": SpeakerRole.PATIENT}


def test_split_needs_a_clear_gap() -> None:
    same = np.full((6, 6), 0.8)
    np.fill_diagonal(same, 1.0)
    assert len(_split_voices(same, 2, 0.12)) == 1

    two = np.full((6, 6), 0.55)
    two[:3, :3] = two[3:, 3:] = 0.85
    np.fill_diagonal(two, 1.0)
    assert sorted(map(sorted, _split_voices(two, 2, 0.12))) == [[0, 1, 2], [3, 4, 5]]


def test_neural_falls_back_to_pitch_clustering_without_model(monkeypatch) -> None:
    monkeypatch.setattr(settings, "diarization_provider", DiarizationProviderName.NEURAL)
    monkeypatch.setattr(settings, "speaker_embedding_model", "models/speaker/missing.onnx")
    provider = build_diarization_provider(audio_source=AudioSource.MICROPHONE)
    assert isinstance(provider, LocalDiarizationProvider)
    assert provider.separates_voices is False
