import os
import time
import httpx
import jwt as pyjwt
from jwt.algorithms import ECAlgorithm
from jwt.exceptions import ExpiredSignatureError, InvalidTokenError
from fastapi import HTTPException, Request

_jwks_cache: dict | None = None
_jwks_fetched_at: float = 0.0
_JWKS_TTL = 3600


def _get_jwks() -> dict:
    global _jwks_cache, _jwks_fetched_at
    now = time.monotonic()
    if _jwks_cache is None or (now - _jwks_fetched_at) > _JWKS_TTL:
        url = os.environ["SUPABASE_URL"] + "/auth/v1/.well-known/jwks.json"
        resp = httpx.get(url, timeout=5)
        resp.raise_for_status()
        _jwks_cache = resp.json()
        _jwks_fetched_at = now
    return _jwks_cache


class AuthError(Exception):
    pass


def validate_token(token: str) -> dict:
    try:
        header = pyjwt.get_unverified_header(token)
    except InvalidTokenError as e:
        raise AuthError(f"malformed: {e}")

    alg = header.get("alg", "ES256")

    if alg == "HS256":
        secret = os.environ["SUPABASE_JWT_SECRET"]
        try:
            payload = pyjwt.decode(token, secret, algorithms=["HS256"], audience="authenticated")
        except ExpiredSignatureError:
            raise AuthError("expired")
        except InvalidTokenError:
            raise AuthError("invalid")
    elif alg == "ES256":
        kid = header.get("kid")
        try:
            jwks = _get_jwks()
        except Exception as e:
            raise AuthError(f"jwks fetch failed: {e}")
        jwk = {k.get("kid"): k for k in jwks.get("keys", [])}.get(kid)
        if not jwk:
            raise AuthError(f"unknown kid: {kid}")
        public_key = ECAlgorithm.from_jwk(jwk)
        try:
            payload = pyjwt.decode(token, public_key, algorithms=["ES256"], audience="authenticated")
        except ExpiredSignatureError:
            raise AuthError("expired")
        except InvalidTokenError:
            raise AuthError("invalid")
    else:
        raise AuthError(f"unsupported algorithm: {alg}")

    if not payload.get("sub"):
        raise AuthError("missing sub")
    return payload


def get_current_user(request: Request) -> str:
    """FastAPI dependency — returns user UUID from Supabase JWT (ES256 or HS256)."""
    header = request.headers.get("Authorization", "")
    if not header.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="missing or malformed bearer token")
    token = header[len("Bearer "):]
    try:
        payload = validate_token(token)
    except AuthError as e:
        raise HTTPException(status_code=401, detail=str(e))
    return payload["sub"]
