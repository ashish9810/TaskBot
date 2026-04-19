import { createClient } from '@/lib/supabase-server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import ManagerDashboard, { ManagerTask, ManagerPerson } from './ManagerDashboard'

export default async function AllTasksPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const admin = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  // Resolve the caller's workspace
  const { data: membership } = await admin
    .from('workspace_members')
    .select('role, workspaces(*)')
    .eq('profile_id', user.id)
    .single()

  if (!membership) return null

  const workspace = membership.workspaces as unknown as {
    id: string
    name: string
    slack_team_id: string | null
  }

  // All workspace members (with their team selection)
  const { data: members } = await admin
    .from('workspace_members')
    .select('profile_id, role, profiles(id, name, email, team)')
    .eq('workspace_id', workspace.id)

  // All tasks in the workspace (Slack-connected workspaces use both workspace_id and team_id)
  let taskRows: Record<string, unknown>[] = []
  if (workspace.slack_team_id) {
    const { data } = await admin
      .from('tasks')
      .select('id, title, status, priority, due_date, user_id, status_changed_at, created_at')
      .or(`workspace_id.eq.${workspace.id},team_id.eq.${workspace.slack_team_id}`)
      .not('status', 'in', '("deleted")')
      .order('created_at', { ascending: false })
    taskRows = data || []
  } else {
    const { data } = await admin
      .from('tasks')
      .select('id, title, status, priority, due_date, user_id, status_changed_at, created_at')
      .eq('workspace_id', workspace.id)
      .not('status', 'eq', 'deleted')
      .order('created_at', { ascending: false })
    taskRows = data || []
  }

  // Slack users in this workspace (name resolution for users without a web profile)
  const { data: slackUsers } = workspace.slack_team_id
    ? await admin
        .from('users')
        .select('slack_user_id, name, email')
        .eq('team_id', workspace.slack_team_id)
    : { data: [] as Array<{ slack_user_id: string; name: string; email: string | null }> }

  // profile_slack_links — lets us map tasks.user_id (slack_user_id) → profile.team
  const { data: links } = workspace.slack_team_id
    ? await admin
        .from('profile_slack_links')
        .select('slack_user_id, profile_id')
        .eq('team_id', workspace.slack_team_id)
    : { data: [] as Array<{ slack_user_id: string; profile_id: string }> }

  // Build a profile lookup keyed by profile_id.
  // NOTE: supabase-js types the joined `profiles` relation as an array; in practice it's a single row.
  type ProfileRow = { id: string; name: string | null; email: string | null; team: string | null }
  const profileById = new Map<string, ProfileRow>()
  for (const m of ((members || []) as unknown as Array<{ profiles: ProfileRow | ProfileRow[] | null }>)) {
    const p = Array.isArray(m.profiles) ? m.profiles[0] : m.profiles
    if (p) profileById.set(p.id, p)
  }

  // Build people list keyed by user_id (the key stored on tasks)
  // - For web-native tasks, user_id === profiles.id
  // - For Slack tasks, user_id === slack_user_id; we look up linked profile to pull team
  const peopleByUserId = new Map<string, ManagerPerson>()

  // 1) Web profiles → keyed by their uuid
  for (const p of profileById.values()) {
    peopleByUserId.set(p.id, {
      user_id: p.id,
      name: p.name || p.email || 'Unknown',
      email: p.email || '',
      team: p.team || null,
    })
  }

  // 2) Slack users → keyed by slack_user_id. If linked to a profile, pull team.
  const profileBySlackId = new Map<string, ProfileRow>()
  for (const l of links || []) {
    const prof = profileById.get(l.profile_id)
    if (prof) profileBySlackId.set(l.slack_user_id, prof)
  }

  for (const u of (slackUsers || []) as Array<{ slack_user_id: string; name: string; email: string | null }>) {
    const linkedProfile = profileBySlackId.get(u.slack_user_id)
    peopleByUserId.set(u.slack_user_id, {
      user_id: u.slack_user_id,
      name: linkedProfile?.name || u.name || u.slack_user_id,
      email: linkedProfile?.email || u.email || '',
      team: linkedProfile?.team || null,
    })
  }

  // 3) Fallback — any task user_id we haven't covered yet gets a placeholder
  for (const t of taskRows) {
    const uid = String(t.user_id || '')
    if (uid && !peopleByUserId.has(uid)) {
      peopleByUserId.set(uid, { user_id: uid, name: uid, email: '', team: null })
    }
  }

  const tasks: ManagerTask[] = taskRows.map(r => ({
    id: String(r.id),
    title: String(r.title || ''),
    status: String(r.status || 'active'),
    priority: (r.priority as string) || null,
    due_date: (r.due_date as string) || null,
    user_id: String(r.user_id || ''),
    status_changed_at: (r.status_changed_at as string) || null,
    created_at: (r.created_at as string) || null,
  }))

  const people: ManagerPerson[] = Array.from(peopleByUserId.values())

  return <ManagerDashboard tasks={tasks} people={people} />
}
