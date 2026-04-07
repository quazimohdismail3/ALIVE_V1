"""Gemini Strategy B mapper — STUB.

In V1 this is intentionally stubbed. The architectural seam is preserved
so V1.5 can drop in the real Gemini-2.5-Flash + Pydantic-schema implementation
without touching music_engine.py or any caller.

To revive in V1.5:
  1. Add GEMINI_API_KEY to .env
  2. Replace the stub body with: build a Pydantic schema for the 16
     music params, prompt Gemini at temperature=0 with the state vector,
     enforce schema, return dict on success or None on timeout/error.
  3. music_engine.py already falls through to Strategy A on None.

Reason for stubbing:
  - Strategy A is reproducible (same input → same output) which is required
    for the V1 closed-loop physiological claims.
  - LLM latency variance (400–1500ms) is incompatible with a 1Hz control loop.
  - Zero API dependency = offline-capable.
"""
from __future__ import annotations

from .state_estimation import StateVector


def map_state_to_params(state: StateVector, session: str) -> dict | None:
    """V1 stub. Always returns None — caller falls back to Strategy A."""
    return None
