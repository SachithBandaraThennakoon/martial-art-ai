from sqlalchemy import Column, DateTime, Integer, String, Text
from sqlalchemy.sql import func

from database import Base


class ContactMessage(Base):
    __tablename__ = "contact_messages"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), nullable=False)
    email = Column(String(160), nullable=False, index=True)
    topic = Column(String(80), nullable=False, default="General question")
    message = Column(Text, nullable=False)
    status = Column(String(24), nullable=False, default="new", index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), index=True)
