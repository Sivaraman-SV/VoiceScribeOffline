"""Speaker diarization contract."""

from __future__ import annotations

import abc

from app.models.enums import SpeakerRole
from app.services.types import AudioFrame, DiarizationTurn


class DiarizationService(abc.ABC):
    """Segments audio into speaker turns."""

    name: str = "base"
    is_mock: bool = False
    # True when labels come from voice identity, so the pipeline keeps them
    # instead of relabelling utterances from their wording.
    separates_voices: bool = False

    @abc.abstractmethod
    async def diarize(self, audio: AudioFrame) -> list[DiarizationTurn]:
        """Return speaker turns for the supplied frame."""

    def known_roles(self, session_id: str) -> dict[str, SpeakerRole]:
        """Speaker roles fixed by the audio itself (e.g. an enrolled doctor voice)."""
        return {}

    def describe(self) -> dict[str, object]:
        return {"name": self.name, "mock": self.is_mock}
