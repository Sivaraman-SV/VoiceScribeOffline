"""Neural speaker diarization on CPU with sherpa-onnx speaker embeddings.

Every utterance (the ASR segments of the frame, else its VAD speech regions) is
turned into a speaker embedding (WeSpeaker ResNet34, ~26 MB ONNX, no PyTorch).
Whole utterances are used rather than short sliding windows: 1-2 s windows of
two similar male voices overlap heavily in embedding space, whole sentences do
not.

Voices are found by re-clustering every utterance heard so far in the session,
not by a fixed similarity threshold: a group is split in two only when the two
halves are clearly more alike inside than across (``DIARIZATION_SPLIT_MARGIN``).
Absolute cosine scores swing with microphone, room and voice pair (two male
voices can score 0.7, a male and a female 0.45); the within/between gap does
not. Labels stay stable across chunks by majority vote of earlier labels.

Optional doctor enrolment: when ``DOCTOR_VOICE_SAMPLE`` points at a short WAV of
the clinician speaking, that voice is always ``speaker_0`` and, in a two-voice
room, the other voice is the patient, so roles no longer depend on what was said.
"""

from __future__ import annotations

import threading
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from app.core.config import settings
from app.core.logging import get_logger, track_duration
from app.models.enums import SpeakerRole
from app.services.diarization.base import DiarizationService
from app.services.types import AudioFrame, DiarizationTurn

logger = get_logger(__name__)

# Utterances longer than this are cut into pieces so a speaker change inside
# one ASR segment is still caught.
_MAX_UNIT_SECONDS = 6.0
_PIECE_SECONDS = 3.0
# Shorter units are labelled by the nearest voice but never shape the clusters.
_RELIABLE_UNIT_SECONDS = 1.0
_MIN_UNIT_SECONDS = 0.3
_MERGE_GAP_SECONDS = 0.45
# Re-clustering cost is quadratic; older utterances beyond this are dropped.
_HISTORY_LIMIT = 400
# The enrolled sample counts as this many utterances in the doctor's cluster.
_ENROLMENT_WEIGHT = 3

DOCTOR_LABEL = "speaker_0"

_EXTRACTORS: dict[str, Any] = {}
_LOCK = threading.Lock()


class NeuralDiarizationUnavailable(RuntimeError):
    pass


def _model_path() -> Path:
    path = Path(settings.speaker_embedding_model)
    if not path.is_absolute():
        from app.core.config import BACKEND_ROOT

        path = BACKEND_ROOT / path
    return path


def load_extractor() -> Any:
    """Return the shared sherpa-onnx embedding extractor, loading it once."""
    path = _model_path()
    key = str(path)
    with _LOCK:
        if key in _EXTRACTORS:
            return _EXTRACTORS[key]
        try:
            import sherpa_onnx  # type: ignore import-not-found
        except ImportError as exc:
            raise NeuralDiarizationUnavailable("sherpa-onnx is not installed (pip install sherpa-onnx)") from exc
        if not path.is_file():
            raise NeuralDiarizationUnavailable(
                f"Speaker embedding model not found at {path}. Run INSTALL_A_TO_Z.bat or "
                "scripts/download_speaker_model.ps1."
            )
        config = sherpa_onnx.SpeakerEmbeddingExtractorConfig(
            model=key, num_threads=settings.diarization_num_threads, provider="cpu"
        )
        if not config.validate():
            raise NeuralDiarizationUnavailable(f"Invalid speaker embedding model: {path}")
        extractor = sherpa_onnx.SpeakerEmbeddingExtractor(config)
        _EXTRACTORS[key] = extractor
        return extractor


def embed(extractor: Any, samples: Any, sample_rate: int) -> Any:
    """L2-normalised embedding of float32 mono samples."""
    import numpy as np

    stream = extractor.create_stream()
    stream.accept_waveform(sample_rate=sample_rate, waveform=samples)
    stream.input_finished()
    vector = np.asarray(extractor.compute(stream), dtype=np.float32)
    norm = float(np.linalg.norm(vector))
    return vector / norm if norm > 0 else vector


def read_audio(path: Path, rate: int = 16000) -> tuple[Any, int]:
    """Decode any audio file (WAV, M4A from Windows Sound Recorder, MP3...) to float32 mono."""
    import av
    import numpy as np

    resampler = av.AudioResampler(format="s16", layout="mono", rate=rate)
    pcm = bytearray()
    with av.open(str(path)) as container:
        for frame in container.decode(audio=0):
            for out in resampler.resample(frame):
                pcm += bytes(out.planes[0])[: out.samples * 2]
        for out in resampler.resample(None):
            pcm += bytes(out.planes[0])[: out.samples * 2]
    return np.frombuffer(bytes(pcm), dtype=np.int16).astype(np.float32) / 32768.0, rate


@dataclass
class _History:
    vectors: list[Any] = field(default_factory=list)
    labels: list[str] = field(default_factory=list)
    # Voices after the last pass: label -> unit-length centroid.
    centroids: dict[str, Any] = field(default_factory=dict)


class NeuralDiarizationProvider(DiarizationService):
    name = "neural"
    is_mock = False
    # Labels come from the voice itself, so the pipeline must not relabel single
    # utterances from their wording.
    separates_voices = True

    def __init__(
        self,
        max_speakers: int | None = None,
        margin: float | None = None,
        doctor_sample: str | None = None,
    ) -> None:
        self.max_speakers = max(1, min(max_speakers or settings.diarization_max_speakers, 6))
        self.margin = margin if margin is not None else settings.diarization_split_margin
        self.extractor = load_extractor()
        self.doctor_embedding = self._enrol(doctor_sample if doctor_sample is not None else settings.doctor_voice_sample)
        self._history: dict[str, _History] = {}

    def _enrol(self, sample: str | None) -> Any:
        if not sample:
            return None
        path = Path(sample)
        if not path.is_absolute():
            from app.core.config import REPO_ROOT

            path = REPO_ROOT / path
        try:
            samples, rate = read_audio(path)
            if len(samples) < rate * 3:
                raise ValueError("needs at least 3 seconds of speech")
            vector = embed(self.extractor, samples, rate)
        except Exception as exc:  # noqa: BLE001 - enrolment is optional
            logger.warning("doctor_voice_enrolment_failed", extra={"path": str(path), "error": str(exc)})
            return None
        logger.info("doctor_voice_enrolled", extra={"path": str(path)})
        return vector

    @property
    def enrolled(self) -> bool:
        return self.doctor_embedding is not None

    def known_roles(self, session_id: str) -> dict[str, SpeakerRole]:
        """Roles fixed by enrolment: the doctor's voice and, in a two-voice room, the patient."""
        if not self.enrolled:
            return {}
        roles = {DOCTOR_LABEL: SpeakerRole.DOCTOR}
        if self.max_speakers == 2:
            history = self._history.get(session_id)
            for label in history.centroids if history else ():
                if label != DOCTOR_LABEL:
                    roles[label] = SpeakerRole.PATIENT
        return roles

    def reset(self, session_id: str) -> None:
        self._history.pop(session_id, None)

    def describe(self) -> dict[str, object]:
        return {
            "name": self.name,
            "mock": self.is_mock,
            "model": _model_path().name,
            "max_speakers": self.max_speakers,
            "doctor_enrolled": self.enrolled,
        }

    async def diarize(self, audio: AudioFrame) -> list[DiarizationTurn]:
        with track_duration("diarization", logger, provider=self.name, session_id=audio.session_id):
            if audio.speech_ratio < 0.04 or not audio.pcm:
                return []
            import numpy as np

            samples = np.frombuffer(audio.pcm[: len(audio.pcm) - len(audio.pcm) % 2], dtype=np.int16)
            samples = samples.astype(np.float32) / 32768.0
            rate = max(audio.sample_rate, 1)
            units = self._units(audio, samples, rate)
            if not units:
                return []

            vectors = [embed(self.extractor, chunk, rate) for _, _, chunk in units]
            reliable = [end - start >= _RELIABLE_UNIT_SECONDS for start, end, _ in units]
            history = self._history.setdefault(audio.session_id, _History())
            if not any(reliable) and not history.vectors:
                reliable = [True] * len(units)

            new_index = len(history.vectors)
            for vector, keep in zip(vectors, reliable):
                if keep:
                    history.vectors.append(vector)
                    history.labels.append("")
            if new_index < len(history.vectors):
                self._recluster(history)

            labelled: list[tuple[float, float, str, float]] = []
            position = new_index
            for (start, end, _), vector, keep in zip(units, vectors, reliable):
                if keep:
                    label = history.labels[position]
                    position += 1
                else:
                    label = self._nearest(history, vector)
                labelled.append((start, end, label, self._confidence(history, vector, label)))
            if len(history.vectors) > _HISTORY_LIMIT:
                drop = len(history.vectors) - _HISTORY_LIMIT
                del history.vectors[:drop], history.labels[:drop]
            return _merge_turns(labelled)

    def _units(self, audio: AudioFrame, samples: Any, rate: int) -> list[tuple[float, float, Any]]:
        """Utterance spans in absolute seconds, with their samples."""
        spans: list[tuple[float, float]] = []
        for seg in audio.hints.get("asr_segments") or []:
            spans.append((float(seg["start_time"]), float(seg["end_time"])))
        if not spans:
            regions = audio.speech_regions or [(0.0, audio.duration)]
            spans = [(audio.start_time + a, audio.start_time + b) for a, b in regions]

        out: list[tuple[float, float, Any]] = []
        for start, end in sorted(spans):
            start, end = max(start, audio.start_time), min(end, audio.end_time)
            length = end - start
            if length < _MIN_UNIT_SECONDS:
                continue
            pieces = 1 if length <= _MAX_UNIT_SECONDS else round(length / _PIECE_SECONDS)
            step = length / pieces
            for k in range(pieces):
                a, b = start + k * step, start + (k + 1) * step
                i0 = max(0, int((a - audio.start_time) * rate))
                i1 = min(len(samples), int((b - audio.start_time) * rate))
                if i1 - i0 >= int(_MIN_UNIT_SECONDS * rate):
                    out.append((round(a, 3), round(b, 3), samples[i0:i1]))
        return out

    def _recluster(self, history: _History) -> None:
        """Re-group every utterance of the session and relabel it consistently."""
        import numpy as np

        points = list(history.vectors)
        previous = list(history.labels)
        if self.enrolled:
            points += [self.doctor_embedding] * _ENROLMENT_WEIGHT
            previous += [DOCTOR_LABEL] * _ENROLMENT_WEIGHT
        matrix = np.stack(points)
        groups = _split_voices(matrix @ matrix.T, self.max_speakers, self.margin)
        enrolled_rows = set(range(len(history.vectors), len(points)))

        # Name each group by the label most of its members carried before; the
        # enrolled doctor's group is always speaker_0.
        names: dict[int, str] = {}
        taken: set[str] = set()
        order = sorted(range(len(groups)), key=lambda g: -len(groups[g]))
        for g in order:
            if enrolled_rows & set(groups[g]):
                names[g] = DOCTOR_LABEL
                taken.add(DOCTOR_LABEL)
        for g in order:
            if g in names:
                continue
            votes = Counter(previous[i] for i in groups[g] if previous[i] and previous[i] not in taken)
            if votes:
                names[g] = votes.most_common(1)[0][0]
            else:
                index = 0
                while f"speaker_{index}" in taken or (self.enrolled and index == 0):
                    index += 1
                names[g] = f"speaker_{index}"
            taken.add(names[g])

        history.centroids = {}
        for g, members in enumerate(groups):
            centroid = matrix[members].mean(axis=0)
            history.centroids[names[g]] = centroid / max(float(np.linalg.norm(centroid)), 1e-9)
            for i in members:
                if i < len(history.labels):
                    history.labels[i] = names[g]

    @staticmethod
    def _nearest(history: _History, vector: Any) -> str:
        import numpy as np

        return max(history.centroids, key=lambda label: float(np.dot(history.centroids[label], vector)))

    @staticmethod
    def _confidence(history: _History, vector: Any, label: str) -> float:
        """How clearly the utterance sits with its voice rather than the next nearest."""
        import numpy as np

        own = float(np.dot(history.centroids[label], vector))
        others = [float(np.dot(c, vector)) for name, c in history.centroids.items() if name != label]
        if not others:
            return round(min(0.95, max(0.5, 0.5 + 0.5 * own)), 4)
        gap = own - max(others)
        return round(min(0.99, max(0.3, 0.6 + 2.0 * gap)), 4)


def _split_voices(sims: Any, max_speakers: int, margin: float) -> list[list[int]]:
    """Divisive clustering on a cosine-similarity matrix.

    The group with the clearest bisection is split while that bisection leaves
    both halves more alike inside than across by at least ``margin``.
    """
    import numpy as np

    groups = [list(range(len(sims)))]
    while len(groups) < max_speakers:
        best: tuple[float, int, list[int], list[int]] | None = None
        for g, members in enumerate(groups):
            if len(members) < 3:
                continue
            left, right = _bisect(sims, members)
            if not left or not right:
                continue
            gap = _cohesion(sims, left, right) - float(sims[np.ix_(left, right)].mean())
            if gap >= margin and (best is None or gap > best[0]):
                best = (gap, g, left, right)
        if best is None:
            break
        _, g, left, right = best
        groups[g : g + 1] = [left, right]
    return groups


def _bisect(sims: Any, members: list[int]) -> tuple[list[int], list[int]]:
    """Two-way split by mean similarity, seeded with the least similar pair."""
    import numpy as np

    sub = sims[np.ix_(members, members)]
    a, b = np.unravel_index(int(np.argmin(sub)), sub.shape)
    side_b = sub[:, b] > sub[:, a]
    for _ in range(10):
        if side_b.all() or not side_b.any():
            break
        updated = sub[:, side_b].mean(axis=1) > sub[:, ~side_b].mean(axis=1)
        if (updated == side_b).all():
            break
        side_b = updated
    left = [members[i] for i in range(len(members)) if not side_b[i]]
    right = [members[i] for i in range(len(members)) if side_b[i]]
    return left, right


def _cohesion(sims: Any, left: list[int], right: list[int]) -> float:
    """Size-weighted mean within-group similarity; a singleton borrows the other side's."""
    import numpy as np

    def within(members: list[int]) -> float | None:
        if len(members) < 2:
            return None
        block = sims[np.ix_(members, members)]
        n = len(members)
        return float((block.sum() - np.trace(block)) / (n * (n - 1)))

    wl, wr = within(left), within(right)
    if wl is None:
        return float(wr)
    if wr is None:
        return float(wl)
    return (wl * len(left) + wr * len(right)) / (len(left) + len(right))


def _merge_turns(labelled: list[tuple[float, float, str, float]]) -> list[DiarizationTurn]:
    """Join consecutive units of the same voice into turns."""
    turns: list[DiarizationTurn] = []
    confidences: list[float] = []
    for start, end, label, confidence in labelled:
        if turns and turns[-1].speaker_id == label and start - turns[-1].end_time <= _MERGE_GAP_SECONDS:
            turns[-1].end_time = end
            confidences.append(confidence)
            turns[-1].confidence = round(sum(confidences) / len(confidences), 4)
            continue
        if turns and start < turns[-1].end_time:
            boundary = round((start + turns[-1].end_time) / 2, 3)
            turns[-1].end_time = boundary
            start = boundary
        turns.append(DiarizationTurn(speaker_id=label, start_time=start, end_time=end, confidence=confidence))
        confidences = [confidence]
    return turns
