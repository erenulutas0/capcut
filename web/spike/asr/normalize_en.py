"""Whisper's English text normaliser over a JSON list of strings (stdin → stdout).

The standard way English ASR word error rates are reported: numbers to
digits on both sides, contractions expanded, British → American spelling,
punctuation and casing removed. Package: whisper-normalizer (MIT), a copy of
openai/whisper's `EnglishTextNormalizer`. Used only for scoring.
"""
import json
import sys

from whisper_normalizer.english import EnglishTextNormalizer

normalizer = EnglishTextNormalizer()
texts = json.load(sys.stdin.buffer)
json.dump([normalizer(t) for t in texts], sys.stdout)
