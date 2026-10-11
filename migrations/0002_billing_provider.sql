ALTER TABLE plans ADD COLUMN IF NOT EXISTS provider_plan_id TEXT;
ALTER TABLE plans ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT 'One subscription for a school workspace';
CREATE UNIQUE INDEX IF NOT EXISTS idx_plans_provider_plan_id ON plans(provider_plan_id) WHERE provider_plan_id IS NOT NULL;