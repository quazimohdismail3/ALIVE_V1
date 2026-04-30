import os
import jwt as pyjwt
from jwt.exceptions import ExpiredSignatureError, InvalidTokenError
from fastapi import HTTPException, Request


class AuthError(Exception):
    pass


def validate_token(token: str) -> dict:
    secret = os.environ["SUPABASE_JWT_SECRET"]
    try:
        payload = pyjwt.decode(
            token,
            secret,
            algorithms=["HS256"],
            audience="authenticated",
        )
    except ExpiredSignatureError:
        raise AuthError("expired")
    except InvalidTokenError:
        raise AuthError("invalid")
    if not payload.get("sub"):
        raise AuthError("missing sub")
    return payload


def get_current_user(request: Request) -> str:
    """FastAPI dependency — extracts Supabase JWT from Authorization: Bearer header,
    validates it, returns the user UUID (sub claim). Raises 401 on any failure.
    """
    header = request.headers.get("Authorization", "")
    if not header.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="missing or malformed bearer token")
    token = header[len("Bearer "):]
    try:
        payload = validate_token(token)
    except AuthError as e:
        raise HTTPException(status_code=401, detail=str(e))
    return payload["sub"]
