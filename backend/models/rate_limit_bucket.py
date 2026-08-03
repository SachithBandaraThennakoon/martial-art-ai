from sqlalchemy import BigInteger, Column, DateTime, Integer, String

from database import Base


class RateLimitBucket(Base):
    __tablename__ = "rate_limit_buckets"

    scope = Column(String(80), primary_key=True)
    subject_hash = Column(String(64), primary_key=True)
    window_start = Column(BigInteger, primary_key=True)
    request_count = Column(Integer, nullable=False, default=0)
    expires_at = Column(DateTime, nullable=False, index=True)
