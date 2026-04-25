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
    tech_label: string | null
    design_label: string | null
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

  // Only users who have signed up on the web are surfaced. Every task.user_id gets
  // normalized to a canonical profile uuid:
  //   (a) user_id === profiles.id  → direct match
  //   (b) user_id === slack_user_id with a row in profile_slack_links → resolve to profile_id
  //   (c) anything else (Slack-only user)  → task is dropped.
  const profileIdBySlackUserId = new Map<string, string>()
  for (const l of links || []) {
    if (profileById.has(l.profile_id)) profileIdBySlackUserId.set(l.slack_user_id, l.profile_id)
  }

  function canonicalProfileId(rawUserId: string): string | null {
    if (!rawUserId) return null
    if (profileById.has(rawUserId)) return rawUserId
    const viaSlack = profileIdBySlackUserId.get(rawUserId)
    if (viaSlack) return viaSlack
    return null
  }

  // Rewrite tasks.user_id → profile uuid; drop tasks for Slack-only users.
  const tasks: ManagerTask[] = []
  for (const r of taskRows) {
    const canonical = canonicalProfileId(String(r.user_id || ''))
    if (!canonical) continue
    tasks.push({
      id: String(r.id),
      title: String(r.title || ''),
      status: String(r.status || 'active'),
      priority: (r.priority as string) || null,
      due_date: (r.due_date as string) || null,
      user_id: canonical,
      status_changed_at: (r.status_changed_at as string) || null,
      created_at: (r.created_at as string) || null,
    })
  }

  // Build the people list from signed-up profiles that actually have tasks.
  const usersWithTasks = new Set(tasks.map(t => t.user_id))
  const people: ManagerPerson[] = Array.from(profileById.values())
    .filter(p => usersWithTasks.has(p.id))
    .map(p => ({
      user_id: p.id,
      name: p.name || p.email || 'Unknown',
      email: p.email || '',
      team: p.team || null,
    }))

  const delegationLabels = {
    with_tech: workspace.tech_label || 'In Tech',
    with_design: workspace.design_label || 'In Design',
  }

  return <ManagerDashboard tasks={tasks} people={people} delegationLabels={delegationLabels} />
}
