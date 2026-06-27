from sqlalchemy import Column, Integer, String, Float, ForeignKey
from database import Base

class TargetAngle(Base):
    __tablename__ = "target_angles"

    id = Column(Integer, primary_key=True)
    step_id = Column(Integer, ForeignKey("technique_steps.id"))
    body_part = Column(String)
    min_angle = Column(Float)
    max_angle = Column(Float)