from sqlalchemy import Column, Float, ForeignKey, Integer, String, UniqueConstraint

from database import Base


class TargetPosition(Base):
    __tablename__ = "target_positions"
    __table_args__ = (UniqueConstraint("step_id", "body_part", name="uq_target_position_step_body_part"),)

    id = Column(Integer, primary_key=True)
    step_id = Column(Integer, ForeignKey("technique_steps.id", ondelete="CASCADE"), nullable=False, index=True)
    body_part = Column(String, nullable=False)
    x = Column(Float, nullable=False)
    y = Column(Float, nullable=False)
    z = Column(Float, nullable=False)
    tolerance = Column(Float, nullable=False, default=0.12)
    coordinate_space = Column(String, nullable=False, default="body_normalized_v1")
