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
    // Has Slack link: fetch by slack_user_id + team_id OR workspace_id
    const { data } = await admin
      .from('tasks')
      .select('*')
      .or(`user_id.eq.${slackId},workspace_id.eq.${workspace.id}`)
      .eq('team_id', teamId)
      .not('status', 'eq', 'deleted')
      .order('created_at', { ascending: false })
    tasks = data || []
  } else {
    // Web-only: fetch by workspace_id
    const { data } = await admin
      .from('tasks')
      .select('*')
      .eq('workspace_id', workspace.id)
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
