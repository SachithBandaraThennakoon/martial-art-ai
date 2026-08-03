import re

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from database import get_db
from models.contact_message import ContactMessage
from services.rate_limits import (
    CONTACT_ACCOUNT,
    CONTACT_IP,
    client_ip,
    enforce_rate_limits,
)

router = APIRouter(prefix="/contact", tags=["Contact"])

ALLOWED_TOPICS = {
    "General question",
    "Studio support",
    "Membership and billing",
    "Coach or school partnership",
    "Privacy and safety",
}
EMAIL_PATTERN = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")


class ContactRequest(BaseModel):
    name: str = Field(min_length=2, max_length=100)
    email: str = Field(min_length=5, max_length=160)
    topic: str = Field(default="General question", max_length=80)
    message: str = Field(min_length=20, max_length=2000)
    company: str = Field(default="", max_length=120)


@router.post("", status_code=status.HTTP_201_CREATED)
def create_contact_message(
    data: ContactRequest,
    request: Request,
    db: Session = Depends(get_db),
):
    # Bots commonly complete this visually hidden field. Return a neutral response
    # without storing their payload so the endpoint is less useful to spammers.
    if data.company.strip():
        return {"message": "Message received. We’ll get back to you soon."}

    name = data.name.strip()
    email = data.email.strip().lower()
    topic = data.topic.strip()
    message = data.message.strip()
    enforce_rate_limits(
        db,
        (CONTACT_IP, client_ip(request)),
        (CONTACT_ACCOUNT, email),
    )

    if not EMAIL_PATTERN.fullmatch(email):
        raise HTTPException(status_code=422, detail="Enter a valid email address")
    if topic not in ALLOWED_TOPICS:
        raise HTTPException(status_code=422, detail="Choose a valid contact topic")
    if len(name) < 2 or len(message) < 20:
        raise HTTPException(status_code=422, detail="Please add a little more detail")

    record = ContactMessage(name=name, email=email, topic=topic, message=message)
    try:
        db.add(record)
        db.commit()
        db.refresh(record)
    except SQLAlchemyError as exc:
        db.rollback()
        raise HTTPException(status_code=503, detail="Contact service is temporarily unavailable") from exc

    return {"message": "Message received. We’ll get back to you soon.", "reference": record.id}
