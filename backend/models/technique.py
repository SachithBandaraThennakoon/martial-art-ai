from sqlalchemy import Column, Integer, String, ForeignKey
from database import Base

class Technique(Base):
    __tablename__ = "techniques"

    id = Column(Integer, primary_key=True)
    name = Column(String)
    description = Column(String)