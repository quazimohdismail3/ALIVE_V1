import os
import jwt as pyjwt
from jwt.exceptions import ExpiredSignatureError, InvalidTokenError


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
