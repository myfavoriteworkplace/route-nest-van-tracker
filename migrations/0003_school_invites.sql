CREATE TABLE IF NOT EXISTS school_invites (
 id BIGSERIAL PRIMARY KEY,
 school_id BIGINT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
 email TEXT NOT NULL,
 role TEXT NOT NULL CHECK (role IN ('school_admin','driver','parent')),
 student_id BIGINT REFERENCES students(id) ON DELETE CASCADE,
 invited_by TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','revoked')),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 accepted_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_school_invite_pending_unique ON school_invites(school_id,email,role) WHERE status='pending';
CREATE INDEX IF NOT EXISTS idx_school_invite_email ON school_invites(lower(email),status);