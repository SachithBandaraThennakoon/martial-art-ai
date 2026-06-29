from sqlalchemy import Column, DateTime, Integer, String
from database import Base

class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String)
    email = Column(String, unique=True, index=True)
    password_hash = Column(String)
    role = Column(String, default="user")
    plan = Column(String, default="FREE_PLAN")
    subscription_status = Column(String, default="trial")
    paypal_subscription_id = Column(String, nullable=True)
    trial_ends_at = Column(DateTime, nullable=True)
    subscription_ends_at = Column(DateTime, nullable=True)
