from sqlalchemy import Column, Float, Integer, String
from database import Base

class Technique(Base):
    __tablename__ = "techniques"

    id = Column(Integer, primary_key=True)
    name = Column(String)
    category = Column(String)
    subcategory = Column(String)
    difficulty = Column(String)
    price = Column(Float, default=0)
    description = Column(String)
