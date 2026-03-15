import { createClient } from '@/lib/supabase-server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { getSlackIdentities } from '@/lib/sync'
import DashboardClient from './DashboardClient'

export default async function DashboardPage() {
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

  const identities = await getSlackIdentities(supabase, user.id)
  const slackId = identities[0]?.slack_user_id || null
  const teamId = identities[0]?.team_id || null

  // Fetch all tasks for this user (both web-native and Slack-synced)
  let tasks: Record<string, unknown>[] = []

  if (slackId && teamId) {
    // Has Slack link: fetch tasks by slack_user_id OR profile_id (covers both origins)
    const { data } = await admin
      .from('tasks')
      .select('*')
      .or(`user_id.eq.${slackId},user_id.eq.${user.id}`)
      .not('status', 'eq', 'deleted')
      .order('created_at', { ascending: false })
    tasks = data || []

    // Migrate any web-created tasks (profile_id) to use slack_user_id for Slack sync
    const orphaned = (tasks || []).filter(t => t.user_id === user.id)
    if (orphaned.length > 0) {
      await admin
        .from('tasks')
        .update({ user_id: slackId, team_id: teamId })
        .eq('user_id', user.id)
    }
  } else {
    // Web-only: fetch tasks assigned to this user's profile_id
    const { data } = await admin
      .from('tasks')
      .select('*')
      .eq('user_id', user.id)
      .not('status', 'eq', 'deleted')
      .order('created_at', { ascending: false })
    tasks = data || []
  }

  return (
    <DashboardClient
      initialTasks={tasks}
      workspaceId={workspace.id}
      workspaceName={workspace.name}
      userId={user.id}
      slackUserId={slackId}
    />
  )
}
