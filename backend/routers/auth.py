from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from database import get_db
from models.user import User
from utils.security import hash_password, verify_password, create_access_token
from fastapi import Form
from datetime import datetime, timedelta
from sqlalchemy import func

router = APIRouter()


@router.post("/register")
def register(
    name: str = Form(...),
    email: str = Form(...),
    password: str = Form(...),
    db: Session = Depends(get_db)
):
    clean_name = " ".join(name.strip().split())
    clean_email = email.strip().lower()

    if len(clean_name) < 2:
        raise HTTPException(status_code=400, detail="Please enter your full name")
    if "@" not in clean_email or "." not in clean_email.rsplit("@", 1)[-1]:
        raise HTTPException(status_code=400, detail="Please enter a valid email address")
    if len(password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters")

    existing_user = db.query(User).filter(func.lower(User.email) == clean_email).first()
    if existing_user:
        raise HTTPException(status_code=400, detail="Email already registered")

    user = User(
        name=clean_name,
        email=clean_email,
        password_hash=hash_password(password),
        role="user",
        plan="FREE_PLAN",
        subscription_status="trial",
        trial_ends_at=datetime.utcnow() + timedelta(days=3)
    )

    db.add(user)
    db.commit()

    return {"message": "User created successfully"}


@router.post("/login")
def login(
    email: str = Form(...),
    password: str = Form(...),
    db: Session = Depends(get_db)
):
    clean_email = email.strip().lower()
    user = db.query(User).filter(func.lower(User.email) == clean_email).first()

    if not user or not verify_password(password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid credentials")

    access_token = create_access_token({"sub": user.email})

    return {
        "access_token": access_token,
        "token_type": "bearer",
        "plan": user.plan or "FREE_PLAN",
        "subscription_status": user.subscription_status or "trial",
        "role": user.role or "user",
        "name": user.name or ""
    }
