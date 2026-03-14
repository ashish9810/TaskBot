import { createClient } from '@/lib/supabase-server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import AllTasksClient from './AllTasksClient'

export default async function AllTasksPage() {
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

  // Get all members of this workspace
  const { data: members } = await admin
    .from('workspace_members')
    .select('profile_id, role, profiles(id, name, email)')
    .eq('workspace_id', workspace.id)

  // Get all tasks in this workspace
  let allTasks: Record<string, unknown>[] = []

  if (workspace.slack_team_id) {
    const { data } = await admin
      .from('tasks')
      .select('*')
      .or(`workspace_id.eq.${workspace.id},team_id.eq.${workspace.slack_team_id}`)
      .not('status', 'in', '("deleted")')
      .order('created_at', { ascending: false })
    allTasks = data || []
  } else {
    const { data } = await admin
      .from('tasks')
      .select('*')
      .eq('workspace_id', workspace.id)
      .not('status', 'eq', 'deleted')
      .order('created_at', { ascending: false })
    allTasks = data || []
  }

  // Get current user's Slack IDs
  const { data: slackLinks } = await admin
    .from('profile_slack_links')
    .select('slack_user_id')
    .eq('profile_id', user.id)
  const mySlackIds = (slackLinks || []).map((l: { slack_user_id: string }) => l.slack_user_id)
  mySlackIds.push(user.id)

  // Build member name/email map
  const memberProfiles = (members || []).map((m: Record<string, unknown>) => {
    const profile = m.profiles as Record<string, string> | null
    return { profileId: profile?.id || '', name: profile?.name || profile?.email || 'Unknown', email: profile?.email || '' }
  })

  // Get Slack users for name resolution
  const { data: slackUsers } = workspace.slack_team_id ? await admin
    .from('users')
    .select('slack_user_id, name, email')
    .eq('team_id', workspace.slack_team_id) : { data: [] }

  function resolveAssignee(task: Record<string, unknown>): { name: string; email: string } {
    const uid = task.user_id as string
    const webMember = memberProfiles.find(m => m.profileId === uid)
    if (webMember) return { name: webMember.name, email: webMember.email }
    const slackUser = (slackUsers || []).find((u: Record<string, unknown>) => u.slack_user_id === uid)
    if (slackUser) return { name: (slackUser.name as string) || uid, email: (slackUser.email as string) || '' }
    return { name: uid, email: '' }
  }

  // Group tasks by assignee
  const grouped = new Map<string, { name: string; email: string; tasks: Record<string, unknown>[] }>()
  for (const task of allTasks) {
    const uid = task.user_id as string
    if (!grouped.has(uid)) {
      const { name, email } = resolveAssignee(task)
      grouped.set(uid, { name, email, tasks: [] })
    }
    grouped.get(uid)!.tasks.push(task)
  }

  return (
    <AllTasksClient
      groups={Array.from(grouped.entries())}
      mySlackIds={mySlackIds}
    />
  )
}
