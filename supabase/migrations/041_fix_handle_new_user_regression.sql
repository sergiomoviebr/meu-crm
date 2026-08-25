-- ============================================================
-- 041_fix_handle_new_user_regression.sql
--
-- Local dev's public.handle_new_user() had regressed to its pre-017
-- body (a bare `INSERT INTO profiles (user_id, full_name, email)`
-- with no account_id/account_role) even though supabase_migrations
-- shows 017 as applied — the function had been overwritten outside
-- the migration flow (a raw SQL script run directly against the DB
-- after 017 already landed, most likely 001_initial_schema.sql's
-- version pasted into the SQL editor by hand).
--
-- Since 017 made profiles.account_id NOT NULL, the regressed
-- function's INSERT failed on every new signup, got swallowed by
-- the `EXCEPTION WHEN OTHERS` handler, and left the new auth.users
-- row with no profile/account at all (silently broken signup).
--
-- This just re-asserts 017's version of handle_new_user() and its
-- trigger. Idempotent (CREATE OR REPLACE / DROP ... IF EXISTS), safe
-- to run against a DB that never regressed.
-- ============================================================

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP FUNCTION IF EXISTS public.handle_new_user();

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_full_name TEXT;
  v_account_id UUID;
BEGIN
  v_full_name := COALESCE(NEW.raw_user_meta_data->>'full_name', '');

  INSERT INTO public.accounts (name, owner_user_id)
  VALUES (COALESCE(NULLIF(v_full_name, ''), NEW.email, 'My account'), NEW.id)
  RETURNING id INTO v_account_id;

  INSERT INTO public.profiles (user_id, full_name, email, account_id, account_role)
  VALUES (NEW.id, v_full_name, NEW.email, v_account_id, 'owner');

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Failed to bootstrap account/profile for user %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.handle_new_user() OWNER TO postgres;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
