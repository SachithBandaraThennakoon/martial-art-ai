ALTER TABLE users
ADD COLUMN IF NOT EXISTS role VARCHAR DEFAULT 'user',
ADD COLUMN IF NOT EXISTS plan VARCHAR DEFAULT 'FREE_PLAN',
ADD COLUMN IF NOT EXISTS subscription_status VARCHAR DEFAULT 'trial',
ADD COLUMN IF NOT EXISTS paypal_subscription_id VARCHAR,
ADD COLUMN IF NOT EXISTS trial_ends_at TIMESTAMP,
ADD COLUMN IF NOT EXISTS subscription_ends_at TIMESTAMP;

UPDATE users
SET role = COALESCE(role, 'user'),
    plan = COALESCE(plan, 'FREE_PLAN'),
    subscription_status = COALESCE(subscription_status, 'trial');
