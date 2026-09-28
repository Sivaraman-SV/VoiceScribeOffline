"""Code-switching: per-utterance language choice and ASR output repair."""

from app.services.asr.code_switch import (
    LanguagePolicy,
    clean_asr_text,
    is_prompt_echo,
    parse_languages,
    romanize_loanwords,
    style_prompt,
)
from app.services.asr.medical_normalizer import normalize_medical_transcript


def test_parse_languages() -> None:
    assert parse_languages("ta, en ,hi,ta") == ("ta", "en", "hi")
    assert parse_languages("") == ()


def test_policy_restricts_to_clinic_languages_and_folds_confusions() -> None:
    policy = LanguagePolicy(allowed=("ta", "en", "hi"))
    # Hindi speech that Whisper labels Urdu must be decoded as Hindi (Devanagari).
    language, _ = policy.choose([("ur", 0.55), ("hi", 0.30), ("en", 0.15)], duration=4.0)
    assert language == "hi"

    policy = LanguagePolicy(allowed=("ta", "en", "hi"))
    # Tamil mistaken for Malayalam/Telugu is still Tamil.
    language, _ = policy.choose([("ml", 0.40), ("te", 0.20), ("en", 0.35), ("ta", 0.05)], duration=4.0)
    assert language == "ta"


def test_policy_keeps_short_utterances_in_the_conversation_language() -> None:
    policy = LanguagePolicy(allowed=("ta", "en", "hi"))
    assert policy.choose([("ta", 0.9), ("en", 0.1)], duration=5.0)[0] == "ta"
    # A one-second "okay" that Whisper leans English on stays in the Tamil flow ...
    assert policy.choose([("en", 0.55), ("ta", 0.45)], duration=1.0)[0] == "ta"
    # ... but a clear English sentence switches.
    assert policy.choose([("en", 0.92), ("ta", 0.08)], duration=5.0)[0] == "en"


def test_style_prompts_keep_english_in_latin_script() -> None:
    assert "doctor" in style_prompt("ta")
    assert "doctor" in style_prompt("hi")
    assert style_prompt("ta", override="custom") == "custom"
    assert style_prompt("fr") is None


def test_tamil_script_loanwords_go_back_to_english() -> None:
    assert romanize_loanwords("எனக்கு சுகர் இருக்கு") == "எனக்கு sugar இருக்கு"
    # Attached case suffix is kept, hyphenated.
    assert romanize_loanwords("பிரஷர்ல problem") == "pressure-ல problem"
    # A different inflection (vowel sign after the stem) is left alone rather
    # than guessed at.
    assert romanize_loanwords("சுகரை") == "சுகரை"
    # Native Tamil words are untouched.
    assert romanize_loanwords("காய்ச்சல் இருக்கு") == "காய்ச்சல் இருக்கு"


def test_devanagari_loanwords_go_back_to_english() -> None:
    assert romanize_loanwords("मुझे बीपी और शुगर है") == "मुझे BP और sugar है"
    assert romanize_loanwords("बुखार है") == "बुखार है"


def test_clean_drops_hallucinations_and_prompt_echo() -> None:
    assert clean_asr_text("Thank you for watching!") == ""
    prompt = style_prompt("ta")
    assert is_prompt_echo(prompt, prompt)
    assert clean_asr_text(prompt, prompt) == ""
    kept = "எனக்கு ரெண்டு நாளா fever இருக்கு"
    assert clean_asr_text(kept, prompt) == kept


def test_clean_collapses_repetition_loops() -> None:
    assert clean_asr_text("fever fever fever fever fever fever") == "fever"
    assert clean_asr_text("I have pain. I have pain. I have pain. I have pain.").count("I have pain") == 1


def test_normalizer_is_idempotent() -> None:
    once = normalize_medical_transcript("take dolo 650 twice a day and crocin when needed")
    assert normalize_medical_transcript(once) == once
    assert "BD (twice daily)" in once and "SOS (as needed)" in once


def test_if_pain_is_not_rewritten() -> None:
    text = "if pain persists come back"
    assert normalize_medical_transcript(text) == text
