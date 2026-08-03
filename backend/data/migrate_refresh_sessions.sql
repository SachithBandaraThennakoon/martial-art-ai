CREATE TABLE IF NOT EXISTS refresh_sessions (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    family_id VARCHAR(64) NOT NULL,
    token_hash VARCHAR(64) NOT NULL UNIQUE,
    replaced_by_hash VARCHAR(64),
    expires_at TIMESTAMP NOT NULL,
    revoked_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_used_at TIMESTAMP,
    user_agent_hash VARCHAR(64)
);

CREATE INDEX IF NOT EXISTS ix_refresh_sessions_user_id
    ON refresh_sessions (user_id);
CREATE INDEX IF NOT EXISTS ix_refresh_sessions_family_id
    ON refresh_sessions (family_id);
CREATE INDEX IF NOT EXISTS ix_refresh_sessions_expires_at
    ON refresh_sessions (expires_at);
CREATE INDEX IF NOT EXISTS ix_refresh_sessions_revoked_at
    ON refresh_sessions (revoked_at);

