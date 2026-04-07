"""WHOOP API — OAuth2 + daily metrics.

V1 scope: minimal OAuth exchange + a single daily endpoint that returns
HRV, recovery, RHR, sleep, respiratory rate. Used by the landing screen.
Requires WHOOP_CLIENT_ID / SECRET in .env to function; otherwise endpoints
return a "not_configured" marker so the frontend can degrade gracefully.
"""
from __future__ import annotations
import httpx
from urllib.parse import urlencode

from .config import WHOOP_CLIENT_ID, WHOOP_CLIENT_SECRET, WHOOP_REDIRECT_URI


AUTH_URL = "https://api.prod.whoop.com/oauth/oauth2/auth"
TOKEN_URL = "https://api.prod.whoop.com/oauth/oauth2/token"
API_BASE = "https://api.prod.whoop.com/developer/v1"
SCOPES = "read:recovery read:cycles read:sleep read:profile"


def is_configured() -> bool:
    return bool(WHOOP_CLIENT_ID and WHOOP_CLIENT_SECRET)


def auth_url() -> str:
    params = {
        "response_type": "code",
        "client_id": WHOOP_CLIENT_ID,
        "redirect_uri": WHOOP_REDIRECT_URI,
        "scope": SCOPES,
        "state": "mission-alive",
    }
    return f"{AUTH_URL}?{urlencode(params)}"


async def exchange_code(code: str) -> dict:
    data = {
        "grant_type": "authorization_code",
        "code": code,
        "client_id": WHOOP_CLIENT_ID,
        "client_secret": WHOOP_CLIENT_SECRET,
        "redirect_uri": WHOOP_REDIRECT_URI,
    }
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.post(TOKEN_URL, data=data)
        r.raise_for_status()
        return r.json()


async def daily_metrics(access_token: str) -> dict:
    headers = {"Authorization": f"Bearer {access_token}"}
    async with httpx.AsyncClient(timeout=15) as client:
        recovery = await client.get(f"{API_BASE}/recovery", headers=headers)
        cycles = await client.get(f"{API_BASE}/cycle", headers=headers)
        sleep = await client.get(f"{API_BASE}/activity/sleep", headers=headers)
    rec = recovery.json() if recovery.status_code == 200 else {}
    cyc = cycles.json() if cycles.status_code == 200 else {}
    slp = sleep.json() if sleep.status_code == 200 else {}
    return {"recovery": rec, "cycle": cyc, "sleep": slp}
