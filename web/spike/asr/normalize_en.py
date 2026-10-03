"""Whisper's English text normaliser over a JSON list of strings (stdin → stdout).

The standard way English ASR word error rates are reported: numbers to
digits on both sides, contractions expanded, British → American spelling,
punctuation and casing removed. Package: whisper-normalizer (MIT), a copy of
openai/whisper's `EnglishTextNormalizer`. Used only for scoring.
"""
import json
import sys

from whisper_normalizer.english import EnglishTextNormalizer

import re

normalizer = EnglishTextNormalizer()
texts = json.load(sys.stdin.buffer)
# The normaliser deletes anything inside brackets (meant for "[music]" tags in
# model output). FLEURS references use parentheses for ordinary spoken text,
# so brackets become spaces first, on both sides.
BRACKETS = re.compile(r"[()\[\]{}<>]")
json.dump([normalizer(BRACKETS.sub(" ", t)) for t in texts], sys.stdout)
