ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS email TEXT;
CREATE INDEX IF NOT EXISTS idx_user_profiles_email ON user_profiles(lower(email));