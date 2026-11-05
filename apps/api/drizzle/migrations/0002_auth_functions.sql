-- Custom SQL migration: auth paths that run before a user context exists,
-- and the rate-limit store (TDD Sections F and H; task TT-05).
--
-- Row-level security hides every users row while app.user_id is unset, so
-- registration, the login lookup and failed-login auditing go through narrow
-- SECURITY DEFINER functions owned by the schema owner. Each pins search_path
-- and returns only what the caller needs.

CREATE OR REPLACE FUNCTION auth_find_user_by_email(p_email text)
RETURNS TABLE (
  id uuid,
  email text,
  password_hash text,
  display_name text,
  email_verified_at timestamptz,
  settings jsonb,
  deletion_requested_at timestamptz,
  created_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT u.id, u.email::text, u.password_hash, u.display_name, u.email_verified_at,
         u.settings, u.deletion_requested_at, u.created_at
    FROM users u
   WHERE u.email = p_email::citext
     AND u.deleted_at IS NULL
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION auth_create_user(p_email text, p_password_hash text, p_display_name text)
RETURNS TABLE (
  id uuid,
  email text,
  display_name text,
  email_verified_at timestamptz,
  settings jsonb,
  deletion_requested_at timestamptz,
  created_at timestamptz
)
LANGUAGE sql VOLATILE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  INSERT INTO users (email, password_hash, display_name)
  VALUES (p_email::citext, p_password_hash, coalesce(p_display_name, ''))
  RETURNING users.id, users.email::text, users.display_name, users.email_verified_at,
            users.settings, users.deletion_requested_at, users.created_at
$$;--> statement-breakpoint

-- Audit rows for events with no user context (failed login for an unknown
-- email, refresh-token reuse). Only whitelisted actions are accepted.
CREATE OR REPLACE FUNCTION audit_write(
  p_user_id uuid, p_action text, p_ip inet, p_user_agent text, p_metadata jsonb
) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_action NOT IN ('auth.login_failed', 'auth.refresh_reuse') THEN
    RAISE EXCEPTION 'audit_write: action % not allowed', p_action USING ERRCODE = '22023';
  END IF;
  INSERT INTO audit_logs (user_id, action, ip, user_agent, metadata)
  VALUES (p_user_id, p_action, p_ip, left(p_user_agent, 512), coalesce(p_metadata, '{}'::jsonb));
END
$$;--> statement-breakpoint

REVOKE ALL ON FUNCTION auth_find_user_by_email(text) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION auth_create_user(text, text, text) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION audit_write(uuid, text, inet, text, jsonb) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION auth_find_user_by_email(text) TO nexus_api;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION auth_create_user(text, text, text) TO nexus_api;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION audit_write(uuid, text, inet, text, jsonb) TO nexus_api;--> statement-breakpoint

-- Store for rate-limiter-flexible (RateLimiterPostgres); not user data, no RLS.
CREATE TABLE IF NOT EXISTS rate_limits (
  key varchar(255) PRIMARY KEY,
  points integer NOT NULL DEFAULT 0,
  expire bigint
);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON rate_limits TO nexus_api, nexus_maint;

/* ===== down (manual rollback: psql -f) =====
DROP TABLE IF EXISTS rate_limits;
DROP FUNCTION IF EXISTS audit_write(uuid, text, inet, text, jsonb);
DROP FUNCTION IF EXISTS auth_create_user(text, text, text);
DROP FUNCTION IF EXISTS auth_find_user_by_email(text);
*/
