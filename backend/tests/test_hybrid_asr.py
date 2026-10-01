"""Whisper + IndicConformer routing, with fake engines (no model is loaded)."""

from __future__ import annotations

from types import SimpleNamespace

import pytest

from app.core.config import ASRProviderName, settings
from app.services.asr.code_switch import LanguagePolicy, style_prompt
from app.services.asr.faster_whisper_provider import FasterWhisperProvider, merge_spans
from app.services.asr.hypothesis import DecodeQuality, foreign_script_share, whisper_problem
from app.services.asr.indic_conformer_engine import IndicConformerEngine
from app.services.types import AudioFrame


def _segment(text: str, start: float = 0.0, end: float = 4.0, logprob: float = -0.2, ratio: float = 1.3):
    return SimpleNamespace(
        text=text, start=start, end=end, avg_logprob=logprob, compression_ratio=ratio, no_speech_prob=0.01, words=[]
    )


class FakeWhisper:
    def __init__(self, probabilities, segments):
        self.probabilities = probabilities
        self.segments = segments
        self.decoded_languages: list[str | None] = []
        self.detections = 0

    def detect_language(self, _piece):
        self.detections += 1
        best = max(self.probabilities, key=lambda item: item[1])
        return best[0], best[1], self.probabilities

    def transcribe(self, _piece, **kwargs):
        assert kwargs["condition_on_previous_text"] is False
        assert "hotwords" not in kwargs
        self.decoded_languages.append(kwargs["language"])
        return iter(self.segments), None


class FakeConformer(IndicConformerEngine):
    def __init__(self, text: str = "", error: Exception | None = None) -> None:
        super().__init__(model_name=f"fake-indic-conformer-{id(self)}", decoder="ctc")
        self.text = text
        self.error = error
        self.calls: list[str] = []

    def transcribe(self, audio, language: str) -> str:
        self.calls.append(language)
        if self.error:
            raise self.error
        return self.text


def _provider(second_pass=None, languages="ta,hi,te,en", utterances=((0.0, 4.0),)):
    provider = FasterWhisperProvider(
        model_name="fake", device="cpu", compute_type="int8",
        language="code_switching", languages=languages, second_pass=second_pass,
    )
    provider._utterances = lambda _audio: list(utterances)
    return provider


def _frame(seconds: float = 4.0) -> AudioFrame:
    return AudioFrame(
        session_id="s1", sequence=1, pcm=b"\x00\x00" * int(16000 * seconds),
        sample_rate=16000, channels=1, start_time=10.0, end_time=10.0 + seconds,
    )


def test_tamil_utterance_goes_to_indic_conformer_without_running_whisper() -> None:
    conformer = FakeConformer("எனக்கு ரெண்டு நாளா காய்ச்சல் இருக்கு")
    whisper = FakeWhisper([("ta", 0.8), ("en", 0.2)], [_segment("should not be used")])
    segments = _provider(conformer)._transcribe_sync(whisper, _frame())

    assert conformer.calls == ["ta"]
    assert whisper.decoded_languages == []
    assert [s.text for s in segments] == ["எனக்கு ரெண்டு நாளா காய்ச்சல் இருக்கு"]
    assert segments[0].language == "ta"
    assert (segments[0].start_time, segments[0].end_time) == (10.0, 14.0)


def test_english_utterance_stays_with_whisper() -> None:
    conformer = FakeConformer("unused")
    whisper = FakeWhisper([("en", 0.9), ("ta", 0.1)], [_segment("I have had fever for two days.")])
    segments = _provider(conformer)._transcribe_sync(whisper, _frame())

    assert conformer.calls == []
    assert whisper.decoded_languages == ["en"]
    assert segments[0].text == "I have had fever for two days."


def test_whisper_repetition_loop_is_rescued_by_the_second_recogniser() -> None:
    conformer = FakeConformer("தலை வலி இருக்கு doctor")
    loop = _segment("pain in the head pain in the head pain in the head pain in the head", ratio=3.1)
    whisper = FakeWhisper([("en", 0.72), ("ta", 0.28)], [loop])
    segments = _provider(conformer)._transcribe_sync(whisper, _frame())

    assert whisper.decoded_languages == ["en"]
    assert conformer.calls == ["ta"]
    assert segments[0].text == "தலை வலி இருக்கு doctor"


def test_without_a_second_recogniser_a_bad_decode_is_kept_but_marked_unreliable() -> None:
    whisper = FakeWhisper([("en", 0.9), ("ta", 0.1)], [_segment("something garbled", logprob=-1.6)])
    segments = _provider(None)._transcribe_sync(whisper, _frame())
    assert segments[0].text == "something garbled"
    assert segments[0].confidence <= 0.35


def test_a_failing_second_recogniser_is_disabled_and_whisper_takes_over() -> None:
    conformer = FakeConformer(error=RuntimeError("onnxruntime missing"))
    whisper = FakeWhisper([("hi", 0.8), ("en", 0.2)], [_segment("मुझे बुखार है")])
    provider = _provider(conformer, utterances=((0.0, 4.0), (5.0, 9.0)))
    segments = provider._transcribe_sync(whisper, _frame(10.0))

    assert conformer.calls == ["hi"], "the broken engine must not be retried on every utterance"
    assert conformer.failed == "onnxruntime missing"
    assert whisper.decoded_languages == ["hi", "hi"]
    assert len(segments) == 2


def test_status_reports_whether_the_second_recogniser_really_loaded() -> None:
    engine = FakeConformer("x")
    assert engine.describe()["status"] == "not_loaded"
    engine.failed = "401 gated repo"
    assert IndicConformerEngine(model_name=engine.model_name, decoder="ctc").describe() == {
        "model": engine.model_name, "decoder": "ctc", "status": "failed", "error": "401 gated repo",
    }, "a failure is remembered for every later session"
    engine.failed = None


def test_english_only_mode_skips_language_detection_and_second_pass() -> None:
    whisper = FakeWhisper([("ta", 0.9)], [_segment("Any allergies?")])
    provider = _provider(FakeConformer("unused"), languages="en")
    segments = provider._transcribe_sync(whisper, _frame())
    assert whisper.detections == 0
    assert whisper.decoded_languages == ["en"]
    assert segments[0].text == "Any allergies?"


def test_language_choice_does_not_drift_over_a_long_consultation() -> None:
    policy = LanguagePolicy(allowed=("ta", "en", "hi"))
    for _ in range(40):
        policy.choose([("ta", 0.85), ("en", 0.15)], duration=6.0)
    assert policy.choose([("en", 0.78), ("ta", 0.22)], duration=6.0)[0] == "en"
    assert policy.choose([("en", 0.55), ("ta", 0.45)], duration=6.0)[0] == "ta"


def test_short_fragments_are_joined_for_context() -> None:
    spans = [(0.0, 0.6), (1.4, 2.0), (2.9, 6.5), (12.0, 13.0)]
    assert merge_spans(spans, duration=14.0) == [(0.0, 6.5), (12.0, 13.0)]
    long_turns = [(0.0, 20.0), (20.5, 40.0)]
    assert merge_spans(long_turns, duration=40.0) == long_turns


@pytest.mark.parametrize(
    ("text", "language", "quality", "expected"),
    [
        ("I have fever since two days", "en", DecodeQuality(-0.3, 1.4), None),
        ("pain pain pain", "en", DecodeQuality(-0.3, 3.0), "repetition loop"),
        ("a b c a b c a b c a b c", "en", DecodeQuality(-0.3, 1.4), "repetition loop"),
        ("x" * 200, "en", DecodeQuality(-0.3, 1.4), "more text than the audio could contain"),
        ("I have fever", "en", DecodeQuality(-1.4, 1.4), "low recognition confidence"),
        ("എനിക്ക് പനി ഉണ്ട്", "ta", DecodeQuality(-0.3, 1.4), "output in the wrong script"),
        ("எனக்கு fever இருக்கு", "ta", DecodeQuality(-0.3, 1.4), None),
    ],
)
def test_whisper_problem_detection(text, language, quality, expected) -> None:
    assert whisper_problem(text, language, 4.0, quality) == expected


def test_code_mixed_latin_is_not_a_foreign_script() -> None:
    assert foreign_script_share("मुझे BP problem है", "hi") == 0.0


def test_style_prompts_carry_no_clinical_content() -> None:
    for language in ("ta", "hi", "te", "en"):
        prompt = style_prompt(language).lower()
        for term in ("dolo", "paracetamol", "fever", "pain", "headache", "650", "tablet", "bp"):
            assert term not in prompt, f"{language} style prompt contains {term!r}"


def test_provider_factory_honours_the_configured_languages(monkeypatch) -> None:
    pytest.importorskip("faster_whisper")
    from app.services.asr import build_asr_provider
    from app.models.enums import AudioSource

    monkeypatch.setattr(settings, "asr_provider", ASRProviderName.FASTER_WHISPER)
    monkeypatch.setattr(settings, "indic_asr_language", "code_switching")
    monkeypatch.setattr(settings, "asr_languages", "ta,hi,te,en")
    monkeypatch.setattr(settings, "asr_second_pass", "indic_conformer")
    provider = build_asr_provider(audio_source=AudioSource.UPLOAD)
    assert isinstance(provider, FasterWhisperProvider)
    assert provider.fixed_language is None
    assert provider.languages == ("ta", "hi", "te", "en")
    assert isinstance(provider.second_pass, IndicConformerEngine)
