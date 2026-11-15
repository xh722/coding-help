"""Small dependency-free transcript quality metrics for local ASR checks."""

from __future__ import annotations


def normalize_text(value: str) -> str:
    return " ".join(value.casefold().split())


def _edit_distance(reference: list[str], hypothesis: list[str]) -> int:
    previous = list(range(len(hypothesis) + 1))
    for reference_index, reference_item in enumerate(reference, start=1):
        current = [reference_index]
        for hypothesis_index, hypothesis_item in enumerate(hypothesis, start=1):
            current.append(
                min(
                    current[-1] + 1,
                    previous[hypothesis_index] + 1,
                    previous[hypothesis_index - 1] + (reference_item != hypothesis_item),
                )
            )
        previous = current
    return previous[-1]


def _error_rate(reference: list[str], hypothesis: list[str]) -> float:
    if not reference:
        return 0.0 if not hypothesis else 1.0
    return round(_edit_distance(reference, hypothesis) / len(reference), 4)


def score_transcript(reference: str, hypothesis: str) -> dict[str, int | float]:
    normalized_reference = normalize_text(reference)
    normalized_hypothesis = normalize_text(hypothesis)
    reference_chars = list(normalized_reference)
    hypothesis_chars = list(normalized_hypothesis)
    reference_words = normalized_reference.split()
    hypothesis_words = normalized_hypothesis.split()
    return {
        "cer": _error_rate(reference_chars, hypothesis_chars),
        "wer": _error_rate(reference_words, hypothesis_words),
        "reference_chars": len(reference_chars),
        "hypothesis_chars": len(hypothesis_chars),
        "reference_words": len(reference_words),
        "hypothesis_words": len(hypothesis_words),
    }
