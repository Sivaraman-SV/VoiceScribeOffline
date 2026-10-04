"""ASR_TAMIL_MODEL routing: Tamil utterances to the Tamil-trained Whisper, with fake engines."""

from __future__ import annotations

from types import SimpleNamespace

from app.services.asr import faster_whisper_provider as fwp
from app.services.asr.code_switch import colloquial_glossary, romanize_loanwords
from app.services.asr.faster_whisper_provider import FasterWhisperProvider
from app.services.asr.hypothesis import DecodeQuality, compression_limit, tamil_is_garbled, whisper_problem
from app.services.asr.indic_conformer_engine import IndicConformerEngine
from app.services.types import AudioFrame


def _segment(text: str):
    return SimpleNamespace(
        text=text, start=0.0, end=4.0, avg_logprob=-0.2, compression_ratio=1.3, no_speech_prob=0.01, words=[]
    )


class FakeWhisper:
    def __init__(self, probabilities, text: str):
        self.probabilities = probabilities
        self.text = text
        self.calls: list[dict] = []

    def detect_language(self, _piece):
        best = max(self.probabilities, key=lambda item: item[1])
        return best[0], best[1], self.probabilities

    def transcribe(self, _piece, **kwargs):
        self.calls.append(kwargs)
        return iter([_segment(self.text)]), None


class FakeConformer(IndicConformerEngine):
    def __init__(self, text: str) -> None:
        super().__init__(model_name=f"fake-conformer-{id(self)}", decoder="ctc")
        self.text = text

    def transcribe(self, audio, language: str) -> str:
        return self.text


def _provider(tamil, languages="ta,en", second_pass=None):
    provider = FasterWhisperProvider(
        model_name="fake", device="cpu", compute_type="int8", language="code_switching",
        languages=languages, second_pass=second_pass, tamil_model="fake-tamil",
    )
    provider._utterances = lambda _audio: [(0.0, 4.0)]
    provider._tamil_model = tamil
    return provider


def _frame() -> AudioFrame:
    return AudioFrame(
        session_id="t1", sequence=1, pcm=b"\x00\x00" * 16000 * 4, sample_rate=16000, channels=1,
        start_time=0.0, end_time=4.0,
    )


def test_tamil_utterance_is_decoded_by_the_tamil_model_without_prompt_or_timestamps() -> None:
    main = FakeWhisper([("ta", 0.8), ("en", 0.2)], "should not be used")
    tamil = FakeWhisper([], "எனக்கு ரெண்டு நாளா காய்ச்சல் இருக்கு")
    segments = _provider(tamil)._transcribe_sync(main, _frame())

    assert main.calls == []
    assert [s.text for s in segments] == ["எனக்கு ரெண்டு நாளா காய்ச்சல் இருக்கு"]
    assert tamil.calls[0]["language"] == "ta"
    assert tamil.calls[0]["initial_prompt"] is None
    assert tamil.calls[0]["without_timestamps"] is True


def test_english_heavy_utterance_stays_with_the_main_model() -> None:
    main = FakeWhisper([("en", 0.9), ("ta", 0.1)], "I have had fever for two days.")
    tamil = FakeWhisper([], "unused")
    segments = _provider(tamil)._transcribe_sync(main, _frame())

    assert tamil.calls == []
    assert main.calls[0]["language"] == "en"
    assert [s.text for s in segments] == ["I have had fever for two days."]


def test_indic_conformer_still_takes_precedence() -> None:
    main = FakeWhisper([("ta", 0.8), ("en", 0.2)], "unused")
    tamil = FakeWhisper([], "unused")
    provider = _provider(tamil, second_pass=FakeConformer("நெஞ்சு வலி இருக்கு"))
    segments = provider._transcribe_sync(main, _frame())

    assert tamil.calls == [] and main.calls == []
    assert [s.text for s in segments] == ["நெஞ்சு வலி இருக்கு"]


def test_tamil_model_that_fails_to_load_falls_back_to_the_main_model(monkeypatch) -> None:
    def boom(*_args, **_kwargs):
        raise RuntimeError("model folder missing")

    monkeypatch.setattr(fwp, "load_whisper_model", boom)
    main = FakeWhisper([("ta", 0.8), ("en", 0.2)], "காய்ச்சல் இருக்கு")
    provider = _provider(None)
    segments = provider._transcribe_sync(main, _frame())

    assert main.calls[0]["language"] == "ta"
    assert [s.text for s in segments] == ["காய்ச்சல் இருக்கு"]
    assert provider.describe()["tamil_model"]["status"] == "failed"


def test_tamil_model_is_ignored_for_an_english_only_clinic() -> None:
    provider = FasterWhisperProvider(model_name="fake", languages="en", tamil_model="fake-tamil")
    assert provider.tamil_model_name == ""
    assert provider.describe()["tamil_model"] is None


def test_clean_tamil_is_not_mistaken_for_a_repetition_loop() -> None:
    # Correct Tamil sentences often compress past 2.4 as UTF-8; real loops land near 4.
    sentence = "எனக்கு ரெண்டு நாளா காய்ச்சல் இருக்கு, தலைவலியும் இருக்கு, ராத்திரி தூக்கம் வரல"
    assert whisper_problem(sentence, "ta", 8.0, DecodeQuality(-0.3, 2.9)) is None
    assert whisper_problem(sentence, "ta", 8.0, DecodeQuality(-0.3, 4.2)) == "repetition loop"
    assert whisper_problem("I have fever since two days", "en", 3.0, DecodeQuality(-0.3, 2.9)) == "repetition loop"


def test_formal_tamil_is_not_rejected_as_garbled() -> None:
    # Virama-heavy, no clinic words: the old letter-ratio rule rejected sentences like these.
    for sentence in (
        "ஐரோப்பிய வரலாற்றின் இந்த காலகட்டத்தில் பணம் பொருந்தியதாகவும் சக்தி வாய்ந்ததாகவும் மாறியது",
        "காசாபிளாங்கா மொராக்கோவிலும் பொருட்கள் வாங்க மிகக் குறைந்த ஆர்வம் தரும் இடங்களில் ஒன்று",
    ):
        assert not tamil_is_garbled(sentence)
        assert whisper_problem(sentence, "ta", 8.0, DecodeQuality(-0.3, 2.0)) is None


def test_tamil_decodes_use_the_indic_compression_limit() -> None:
    main = FakeWhisper([("ta", 0.8), ("en", 0.2)], "காய்ச்சல் இருக்கு")
    _provider(None, second_pass=None)._decode_whisper(main, None, "ta")
    _provider(None, second_pass=None)._decode_whisper(main, None, "en")
    assert [call["compression_ratio_threshold"] for call in main.calls] == [
        compression_limit("ta"),
        compression_limit("en"),
    ]
    assert compression_limit("ta") > compression_limit("en") == 2.4
    assert compression_limit(None, "காய்ச்சல் இருக்கு") == compression_limit("ta")


def test_english_words_in_tamil_script_come_back_as_english() -> None:
    # The Tamil-trained model spells Tanglish English words in Tamil script.
    text = "மூணு நாளா கிட்டினஸ் இருக்கு, சுகர் லெவல் கூடிருச்சு, நைட்ல மெட்ஃபார்மின். சிடி ஸ்கேன்ல ஒன்னும் இல்ல"
    assert romanize_loanwords(text) == (
        "மூணு நாளா giddiness இருக்கு, sugar level கூடிருச்சு, night-ல Metformin. CT scan-ல ஒன்னும் இல்ல"
    )


def test_spoken_tamil_and_dosing_reach_the_glossary() -> None:
    glossary = colloquial_glossary("மூணு நாளா காச்சல், வயித்து வலி. மாத்திரை சாப்பிட்ட பிறகு ரெண்டு தடவை.")
    assert glossary["காச்சல்"] == "fever"
    assert glossary["வயித்து வலி"] == "abdominal pain"
    assert glossary["சாப்பிட்ட பிறகு"] == "after food"
    assert glossary["ரெண்டு தடவை"] == "twice"
    assert colloquial_glossary("sapta apram rendu thadava maathirai")["sapta apram"] == "after food"
