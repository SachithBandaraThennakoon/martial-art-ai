from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from database import SessionLocal
from models.user import User
from utils.security import hash_password, verify_password, create_access_token
from fastapi import Form
from datetime import datetime, timedelta

router = APIRouter()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


@router.post("/register")
def register(
    name: str = Form(...),
    email: str = Form(...),
    password: str = Form(...),
    db: Session = Depends(get_db)
):
    existing_user = db.query(User).filter(User.email == email).first()
    if existing_user:
        raise HTTPException(status_code=400, detail="Email already registered")

    user = User(
        name=name,
        email=email,
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
    user = db.query(User).filter(User.email == email).first()

    if not user or not verify_password(password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid credentials")

    access_token = create_access_token({"sub": user.email})

    return {
        "access_token": access_token,
        "token_type": "bearer",
        "plan": user.plan or "FREE_PLAN",
        "subscription_status": user.subscription_status or "trial"
    }
