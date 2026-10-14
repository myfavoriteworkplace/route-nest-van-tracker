ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS provider_event_created_at BIGINT;

ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS provider_plan_id TEXT;

UPDATE subscriptions s
   SET provider_plan_id=CASE
     WHEN s.billing_interval='annual' THEN p.provider_annual_plan_id
     ELSE p.provider_plan_id
   END
  FROM plans p
 WHERE s.plan_id=p.id AND s.provider_plan_id IS NULL;
