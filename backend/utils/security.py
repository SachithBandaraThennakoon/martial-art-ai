from passlib.context import CryptContext
import jwt
from datetime import datetime, timedelta, timezone
import os
import secrets

APP_ENV = os.getenv("APP_ENV", "development").strip().lower()
SECRET_KEY = os.getenv("SECRET_KEY", "").strip()

if not SECRET_KEY:
    if APP_ENV == "production":
        raise RuntimeError("SECRET_KEY is required when APP_ENV=production")
    SECRET_KEY = "development-only-secret-change-before-production"

if APP_ENV == "production" and len(SECRET_KEY) < 32:
    raise RuntimeError("SECRET_KEY must contain at least 32 characters in production")

ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "15"))
if ACCESS_TOKEN_EXPIRE_MINUTES < 5 or ACCESS_TOKEN_EXPIRE_MINUTES > 60:
    if APP_ENV == "production":
        raise RuntimeError("ACCESS_TOKEN_EXPIRE_MINUTES must be between 5 and 60")
    ACCESS_TOKEN_EXPIRE_MINUTES = 15

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def hash_password(password: str):
    return pwd_context.hash(password)


def verify_password(plain_password, hashed_password):
    return pwd_context.verify(plain_password, hashed_password)


def create_access_token(data: dict):
    to_encode = data.copy()
    issued_at = datetime.now(timezone.utc)
    expire = issued_at + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.setdefault("type", "access")
    to_encode.update({"iat": issued_at, "exp": expire, "jti": secrets.token_urlsafe(16)})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
