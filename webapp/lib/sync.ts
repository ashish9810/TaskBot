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
