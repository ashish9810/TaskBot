-- Run this in your Supabase SQL editor (Dashboard → SQL Editor → New query)

-- 1. Profiles table (linked to Supabase Auth users)
CREATE TABLE IF NOT EXISTS profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text UNIQUE NOT NULL,
  name text,
  created_at timestamptz DEFAULT now()
);

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.profiles (id, email, name)
  VALUES (
    new.id,
    new.email,
    COALESCE(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1))
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE handle_new_user();

-- 2. Links web profiles to Slack user identities (enables data sync)
CREATE TABLE IF NOT EXISTS profile_slack_links (
  profile_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  slack_user_id text NOT NULL,
  team_id text NOT NULL,
  created_at timestamptz DEFAULT now(),
  PRIMARY KEY (slack_user_id, team_id)
);

-- 3. RLS Policies

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own profile"
  ON profiles FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "Users can update own profile"
  ON profiles FOR UPDATE
  USING (auth.uid() = id);

CREATE POLICY "Users can insert own profile"
  ON profiles FOR INSERT
  WITH CHECK (auth.uid() = id);

ALTER TABLE profile_slack_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own slack links"
  ON profile_slack_links FOR SELECT
  USING (auth.uid() = profile_id);

CREATE POLICY "Users can insert own slack links"
  ON profile_slack_links FOR INSERT
  WITH CHECK (auth.uid() = profile_id);

CREATE POLICY "Users can update own slack links"
  ON profile_slack_links FOR UPDATE
  USING (auth.uid() = profile_id);

-- 4. Allow web app to read existing Slack data (tasks, users, updates, favorites)
--    These tables are written by the bot but need to be readable by web users via RLS.
--    A web user can read tasks/users/updates from their workspace (team_id they are linked to).

ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read tasks in their workspace"
  ON tasks FOR SELECT
  USING (
    team_id IN (
      SELECT team_id FROM profile_slack_links
      WHERE profile_id = auth.uid()
    )
  );

ALTER TABLE users ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read teammates in their workspace"
  ON users FOR SELECT
  USING (
    team_id IN (
      SELECT team_id FROM profile_slack_links
      WHERE profile_id = auth.uid()
    )
  );

ALTER TABLE updates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read updates in their workspace"
  ON updates FOR SELECT
  USING (
    team_id IN (
      SELECT team_id FROM profile_slack_links
      WHERE profile_id = auth.uid()
    )
  );

ALTER TABLE favorites ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own favorites"
  ON favorites FOR SELECT
  USING (
    team_id IN (
      SELECT team_id FROM profile_slack_links
      WHERE profile_id = auth.uid()
    )
    AND manager_user_id IN (
      SELECT slack_user_id FROM profile_slack_links
      WHERE profile_id = auth.uid()
    )
  );

-- NOTE: The bot uses the service_role key (SUPABASE_KEY in app.js) which bypasses RLS,
-- so existing bot functionality is unaffected by these policies.

-- ============================================================
-- PHASE 2: Web-native workspace layer
-- Run this block after the above is already applied.
-- ============================================================

-- 1. Workspaces (source of truth for web identity)
CREATE TABLE IF NOT EXISTS workspaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  created_by uuid REFERENCES profiles(id),
  slack_team_id text UNIQUE,        -- set when Slack bot is connected; 1:1 enforced
  created_at timestamptz DEFAULT now()
);

-- 2. Workspace membership
CREATE TABLE IF NOT EXISTS workspace_members (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  profile_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'member',  -- 'owner' | 'member'
  joined_at timestamptz DEFAULT now(),
  PRIMARY KEY (workspace_id, profile_id)
);

-- 3. Invite tokens (no expiry for MVP — owner regenerates manually)
CREATE TABLE IF NOT EXISTS workspace_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  created_by uuid REFERENCES profiles(id),
  token text UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(16), 'hex'),
  created_at timestamptz DEFAULT now()
);

-- 4. Public share token on profiles
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS
  public_token text UNIQUE DEFAULT encode(gen_random_bytes(8), 'hex');

-- 5. workspace_id on tasks (additive — bot still writes team_id as before)
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS workspace_id uuid REFERENCES workspaces(id);

-- 6. RLS for new tables

ALTER TABLE workspaces ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can read own workspace"
  ON workspaces FOR SELECT
  USING (id IN (
    SELECT workspace_id FROM workspace_members WHERE profile_id = auth.uid()
  ));

CREATE POLICY "Users can insert workspace"
  ON workspaces FOR INSERT
  WITH CHECK (created_by = auth.uid());

CREATE POLICY "Owner can update workspace"
  ON workspaces FOR UPDATE
  USING (id IN (
    SELECT workspace_id FROM workspace_members
    WHERE profile_id = auth.uid() AND role = 'owner'
  ));

ALTER TABLE workspace_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can read workspace members"
  ON workspace_members FOR SELECT
  USING (workspace_id IN (
    SELECT workspace_id FROM workspace_members WHERE profile_id = auth.uid()
  ));

CREATE POLICY "Users can insert own membership"
  ON workspace_members FOR INSERT
  WITH CHECK (profile_id = auth.uid());

ALTER TABLE workspace_invites ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can read invites"
  ON workspace_invites FOR SELECT
  USING (workspace_id IN (
    SELECT workspace_id FROM workspace_members WHERE profile_id = auth.uid()
  ));

CREATE POLICY "Members can create invites"
  ON workspace_invites FOR INSERT
  WITH CHECK (workspace_id IN (
    SELECT workspace_id FROM workspace_members WHERE profile_id = auth.uid()
  ));

CREATE POLICY "Members can delete invites"
  ON workspace_invites FOR DELETE
  USING (workspace_id IN (
    SELECT workspace_id FROM workspace_members WHERE profile_id = auth.uid()
  ));

-- 7. Tasks write policies (web-created tasks)
CREATE POLICY "Users can insert tasks in their workspace"
  ON tasks FOR INSERT
  WITH CHECK (
    workspace_id IN (
      SELECT workspace_id FROM workspace_members WHERE profile_id = auth.uid()
    )
  );

CREATE POLICY "Users can update own tasks"
  ON tasks FOR UPDATE
  USING (
    -- Tasks assigned via Slack (have slack user_id)
    user_id IN (
      SELECT slack_user_id FROM profile_slack_links WHERE profile_id = auth.uid()
    )
    OR
    -- Tasks created from web (user_id = profile_id stored as text, no Slack link yet)
    (user_id = auth.uid()::text)
  );

-- 8. Allow tasks to be read by workspace_id (in addition to existing team_id policy)
-- Drop and recreate the tasks read policy to handle both lookup paths
DROP POLICY IF EXISTS "Users can read tasks in their workspace" ON tasks;

CREATE POLICY "Users can read tasks in their workspace"
  ON tasks FOR SELECT
  USING (
    -- Path 1: Slack-linked workspace (existing bot tasks)
    team_id IN (
      SELECT team_id FROM profile_slack_links WHERE profile_id = auth.uid()
    )
    OR
    -- Path 2: Web-native workspace_id (new web-created tasks)
    workspace_id IN (
      SELECT workspace_id FROM workspace_members WHERE profile_id = auth.uid()
    )
  );

-- 9. Allow web users to read workspace members' profiles (for People page, task assignee display)
DROP POLICY IF EXISTS "Users can read teammates in their workspace" ON users;

CREATE POLICY "Users can read teammates in their workspace"
  ON users FOR SELECT
  USING (
    team_id IN (
      SELECT team_id FROM profile_slack_links WHERE profile_id = auth.uid()
    )
    OR
    team_id IN (
      SELECT w.slack_team_id FROM workspaces w
      JOIN workspace_members wm ON wm.workspace_id = w.id
      WHERE wm.profile_id = auth.uid() AND w.slack_team_id IS NOT NULL
    )
  );
