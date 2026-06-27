from sqlalchemy import Column, Integer, String, ForeignKey
from database import Base

class TechniqueStep(Base):
    __tablename__ = "technique_steps"

    id = Column(Integer, primary_key=True)
    technique_id = Column(Integer, ForeignKey("techniques.id"))
    step_number = Column(Integer)
    step_name = Column(String)