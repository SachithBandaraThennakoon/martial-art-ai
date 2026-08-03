from sqlalchemy import Column, DateTime, ForeignKey, Integer, String, UniqueConstraint, func

from database import Base


class ConsentRecord(Base):
    __tablename__ = "consent_records"
    __table_args__ = (
        UniqueConstraint("user_id", "document_type", "document_version", name="uq_consent_user_document_version"),
    )

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    document_type = Column(String(32), nullable=False, index=True)
    document_version = Column(String(32), nullable=False)
    accepted_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    withdrawn_at = Column(DateTime(timezone=True), nullable=True)
    source = Column(String(32), nullable=False, default="registration")
