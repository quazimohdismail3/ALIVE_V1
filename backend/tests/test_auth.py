import pytest
import time
import jwt as pyjwt
from backend.auth import validate_token, AuthError

SECRET = "test-secret-32-chars-exactly!!!!"

def _make_token(sub="user-123", exp_offset=3600, secret=SECRET, role="authenticated"):
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
    monkeypatch.setenv("SUPABASE_JWT_SECRET", SECRET)
    token = _make_token()
    result = validate_token(token)
    assert result["sub"] == "user-123"
    assert result["email"] == "test@example.com"


def test_expired_token_raises(monkeypatch):
    monkeypatch.setenv("SUPABASE_JWT_SECRET", SECRET)
    token = _make_token(exp_offset=-10)
    with pytest.raises(AuthError, match="expired"):
        validate_token(token)


def test_wrong_secret_raises(monkeypatch):
    monkeypatch.setenv("SUPABASE_JWT_SECRET", SECRET)
    token = _make_token(secret="wrong-secret-32-chars-exactly!!!")
    with pytest.raises(AuthError, match="invalid"):
        validate_token(token)


def test_malformed_token_raises(monkeypatch):
    monkeypatch.setenv("SUPABASE_JWT_SECRET", SECRET)
    with pytest.raises(AuthError, match="invalid"):
        validate_token("not.a.token")


def test_missing_sub_raises(monkeypatch):
    monkeypatch.setenv("SUPABASE_JWT_SECRET", SECRET)
    payload = {"role": "authenticated", "exp": int(time.time()) + 3600, "aud": "authenticated"}
    token = pyjwt.encode(payload, SECRET, algorithm="HS256")
    with pytest.raises(AuthError, match="missing sub"):
        validate_token(token)
