CREATE TABLE IF NOT EXISTS rate_limit_buckets (
    scope VARCHAR(80) NOT NULL,
    subject_hash VARCHAR(64) NOT NULL,
    window_start BIGINT NOT NULL,
    request_count INTEGER NOT NULL DEFAULT 0,
    expires_at TIMESTAMP NOT NULL,
    PRIMARY KEY (scope, subject_hash, window_start)
);

CREATE INDEX IF NOT EXISTS ix_rate_limit_buckets_expires_at
    ON rate_limit_buckets (expires_at);
