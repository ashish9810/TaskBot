import { createClient } from '@/lib/supabase-server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import MembersClient from './MembersClient'

export default async function PeoplePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const admin = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const { data: membership } = await admin
    .from('workspace_members')
    .select('role, workspaces(*)')
    .eq('profile_id', user.id)
    .single()

  if (!membership) return null

  const workspace = {
    ...(membership.workspaces as unknown as { id: string; name: string; slack_team_id: string | null }),
    role: membership.role,
  }

  // Get workspace members with their profiles
  const { data: members } = await admin
    .from('workspace_members')
    .select('profile_id, role, profiles(id, name, email)')
    .eq('workspace_id', workspace.id)

  // Also get Slack users if workspace has Slack linked
  let slackUsers: { slack_user_id: string; name: string; email: string }[] = []
  if (workspace.slack_team_id) {
    const { data } = await admin
      .from('users')
      .select('slack_user_id, name, email')
      .eq('team_id', workspace.slack_team_id)
      .order('name', { ascending: true })
    slackUsers = data || []
  }

  // Get active task counts per workspace member
  const profileIds = (members || []).map((m: Record<string, unknown>) => {
    const profile = m.profiles as Record<string, string> | null
    return profile?.id || ''
  }).filter(Boolean)

  // Get slack_user_ids for these profiles to count tasks
  const { data: slackLinks } = await admin
    .from('profile_slack_links')
    .select('profile_id, slack_user_id')
    .in('profile_id', profileIds)

  const taskCountMap: Record<string, number> = {}
  if (slackLinks && slackLinks.length > 0) {
    const slackIds = slackLinks.map((l: { slack_user_id: string }) => l.slack_user_id)
    const { data: activeTasks } = await admin
      .from('tasks')
      .select('user_id')
      .in('user_id', slackIds)
      .in('status', ['active', 'in_progress'])

    for (const link of slackLinks) {
      const count = (activeTasks || []).filter(
        (t: { user_id: string }) => t.user_id === link.slack_user_id
      ).length
      taskCountMap[link.profile_id] = (taskCountMap[link.profile_id] || 0) + count
    }
  }

  const memberList = (members || []).map((m: Record<string, unknown>) => {
    const profile = m.profiles as Record<string, string> | null
    return {
      profileId: profile?.id || '',
      name: profile?.name || profile?.email || 'Unknown',
      email: profile?.email || '',
      role: m.role as string,
      activeTasks: taskCountMap[profile?.id || ''] || 0,
    }
  })

  return (
    <MembersClient
      members={memberList}
      slackUsers={slackUsers}
      workspaceId={workspace.id}
      workspaceName={workspace.name}
      currentUserId={user.id}
      isOwner={workspace.role === 'owner'}
    />
  )
}
