import { SupabaseClient } from '@supabase/supabase-js'

/**
 * After login, find the user's Slack identity by email and link it to their profile.
 * This is what makes web app data sync with Slack — same tables, same user_id.
 */
export async function syncSlackIdentity(supabase: SupabaseClient, profileId: string, email: string) {
  // Find all Slack users with this email
  const { data: slackUsers } = await supabase
    .from('users')
    .select('slack_user_id, team_id')
    .eq('email', email)

  if (!slackUsers || slackUsers.length === 0) return

  // Upsert all found Slack identities into profile_slack_links
  const links = slackUsers.map((u: { slack_user_id: string; team_id: string }) => ({
    profile_id: profileId,
    slack_user_id: u.slack_user_id,
    team_id: u.team_id,
  }))

  await supabase
    .from('profile_slack_links')
    .upsert(links, { onConflict: 'slack_user_id,team_id' })
}

/**
 * Unified sync: link Slack identities AND auto-join the matching workspace.
 *
 * MVP constraint: one email = one Ping workspace. If user already belongs to
 * any workspace, we only sync profile_slack_links (for data visibility) but
 * never create a second workspace membership.
 *
 * Call this from: auth callback (post-signup), sync-slack (post-login), dashboard layout.
 */
export async function autoJoinSlackWorkspace(
  admin: SupabaseClient,
  profileId: string,
  email: string
): Promise<{ workspaceId: string | null; linked: number }> {
  // 1. Find all Slack users with this email
  const { data: slackUsers } = await admin
    .from('users')
    .select('slack_user_id, team_id')
    .ilike('email', email)

  if (!slackUsers || slackUsers.length === 0) {
    return { workspaceId: null, linked: 0 }
  }

  // 2. Always upsert profile_slack_links (data sync — runs for ALL journeys)
  const links = slackUsers.map((u: { slack_user_id: string; team_id: string }) => ({
    profile_id: profileId,
    slack_user_id: u.slack_user_id,
    team_id: u.team_id,
  }))

  await admin
    .from('profile_slack_links')
    .upsert(links, { onConflict: 'slack_user_id,team_id' })

  // 3. Check if user already belongs to any workspace (MVP: one workspace per email)
  const { data: existingMembership } = await admin
    .from('workspace_members')
    .select('workspace_id')
    .eq('profile_id', profileId)
    .limit(1)
    .maybeSingle()

  if (existingMembership) {
    // Already has a workspace — don't auto-join another one
    return { workspaceId: existingMembership.workspace_id, linked: links.length }
  }

  // 4. No workspace yet — find the workspace linked to this Slack team and auto-join
  const teamIds = [...new Set(slackUsers.map(u => u.team_id))]

  for (const teamId of teamIds) {
    const { data: workspace } = await admin
      .from('workspaces')
      .select('id')
      .eq('slack_team_id', teamId)
      .maybeSingle()

    if (workspace) {
      // Auto-join as member (upsert to avoid duplicate key errors)
      await admin
        .from('workspace_members')
        .upsert(
          { workspace_id: workspace.id, profile_id: profileId, role: 'member' },
          { onConflict: 'workspace_id,profile_id' }
        )

      return { workspaceId: workspace.id, linked: links.length }
    }
  }

  // No matching workspace found (Slack not connected to any web workspace yet)
  return { workspaceId: null, linked: links.length }
}

export type SlackIdentity = {
  slack_user_id: string
  team_id: string
}

export async function getSlackIdentities(supabase: SupabaseClient, profileId: string): Promise<SlackIdentity[]> {
  const { data } = await supabase
    .from('profile_slack_links')
    .select('slack_user_id, team_id')
    .eq('profile_id', profileId)

  return data || []
}
