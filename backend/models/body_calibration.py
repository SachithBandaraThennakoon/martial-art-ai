from sqlalchemy import Column, DateTime, Float, ForeignKey, Integer, String, Text, func

from database import Base


class BodyCalibration(Base):
    __tablename__ = "body_calibrations"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), unique=True, nullable=False, index=True)
    ratios_json = Column(Text, nullable=False)
    sample_count = Column(Integer, nullable=False, default=0)
    stability_score = Column(Float, nullable=False, default=0)
    created_at = Column(DateTime, server_default=func.now(), nullable=False)
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now(), nullable=False)
