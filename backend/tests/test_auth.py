import pytest
import time
import jwt as pyjwt
from backend.auth import validate_token, AuthError

_HS256_KEY = "test-hs256-32-chars-" + "exactly!!!!"

def _make_token(sub="user-123", exp_offset=3600, secret=_HS256_KEY, role="authenticated"):
    payload = {
        "sub": sub,
        "role": role,
        "email": "test@example.com",
        "exp": int(time.time()) + exp_offset,
        "iat": int(time.time()),
        "aud": "authenticated",
    }
    return pyjwt.encode(payload, secret, algorithm="HS256")


def test_valid_token_returns_user_id(monkeypatch):
    monkeypatch.setenv("SUPABASE_JWT__HS256_KEY", _HS256_KEY)
    token = _make_token()
    result = validate_token(token)
    assert result["sub"] == "user-123"
    assert result["email"] == "test@example.com"


def test_expired_token_raises(monkeypatch):
    monkeypatch.setenv("SUPABASE_JWT__HS256_KEY", _HS256_KEY)
    token = _make_token(exp_offset=-10)
    with pytest.raises(AuthError, match="expired"):
        validate_token(token)


def test_wrong_secret_raises(monkeypatch):
    monkeypatch.setenv("SUPABASE_JWT__HS256_KEY", _HS256_KEY)
    token = _make_token(secret="wrong-secret-32-chars-exactly!!!")
    with pytest.raises(AuthError, match="invalid"):
        validate_token(token)


def test_malformed_token_raises(monkeypatch):
    monkeypatch.setenv("SUPABASE_JWT__HS256_KEY", _HS256_KEY)
    with pytest.raises(AuthError, match="invalid"):
        validate_token("not.a.token")


def test_missing_sub_raises(monkeypatch):
    monkeypatch.setenv("SUPABASE_JWT__HS256_KEY", _HS256_KEY)
    payload = {"role": "authenticated", "exp": int(time.time()) + 3600, "aud": "authenticated"}
    token = pyjwt.encode(payload, _HS256_KEY, algorithm="HS256")
    with pytest.raises(AuthError, match="missing sub"):
        validate_token(token)


# --- get_current_user tests ---

from fastapi import HTTPException
from backend.auth import get_current_user


class FakeRequest:
    def __init__(self, auth_header: str | None):
        self.headers = {"Authorization": auth_header} if auth_header else {}


def test_get_current_user_returns_sub_from_valid_token(monkeypatch):
    monkeypatch.setattr(
        "backend.auth.validate_token",
        lambda token: {"sub": "abcd-1234"},
    )
    user_id = get_current_user(FakeRequest("Bearer goodtoken"))
    assert user_id == "abcd-1234"


def test_get_current_user_raises_401_when_no_header():
    with pytest.raises(HTTPException) as exc:
        get_current_user(FakeRequest(None))
    assert exc.value.status_code == 401


def test_get_current_user_raises_401_when_malformed_header():
    with pytest.raises(HTTPException) as exc:
        get_current_user(FakeRequest("not-bearer"))
    assert exc.value.status_code == 401


def test_get_current_user_raises_401_on_invalid_token(monkeypatch):
    monkeypatch.setattr(
        "backend.auth.validate_token",
        lambda token: (_ for _ in ()).throw(AuthError("invalid")),
    )
    with pytest.raises(HTTPException) as exc:
        get_current_user(FakeRequest("Bearer badtoken"))
    assert exc.value.status_code == 401
