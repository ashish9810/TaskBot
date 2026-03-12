import { createClient } from '@/lib/supabase-server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import TaskCard from '@/components/TaskCard'

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

  // Get all tasks in this workspace (by workspace_id OR by team_id if Slack connected)
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

  // Get current user's Slack IDs to know which tasks are "mine"
  const { data: slackLinks } = await admin
    .from('profile_slack_links')
    .select('slack_user_id')
    .eq('profile_id', user.id)
  const mySlackIds = new Set((slackLinks || []).map((l: { slack_user_id: string }) => l.slack_user_id))
  mySlackIds.add(user.id) // also match web-created tasks

  // Group tasks by assignee
  // Build a map of user_id → member name for display
  const memberProfiles = (members || []).map((m: Record<string, unknown>) => {
    const profile = m.profiles as Record<string, string> | null
    return { profileId: profile?.id || '', name: profile?.name || profile?.email || 'Unknown' }
  })

  // Get Slack users in workspace for name resolution
  const { data: slackUsers } = workspace.slack_team_id ? await admin
    .from('users')
    .select('slack_user_id, name, email')
    .eq('team_id', workspace.slack_team_id) : { data: [] }

  function resolveAssigneeName(task: Record<string, unknown>): string {
    const uid = task.user_id as string
    // Check web members
    const webMember = memberProfiles.find(m => m.profileId === uid)
    if (webMember) return webMember.name
    // Check Slack users
    const slackUser = (slackUsers || []).find((u: Record<string, unknown>) => u.slack_user_id === uid)
    if (slackUser) return (slackUser.name as string) || (slackUser.email as string) || uid
    return uid
  }

  // Group tasks by assignee user_id
  const grouped = new Map<string, { name: string; tasks: Record<string, unknown>[] }>()
  for (const task of allTasks) {
    const uid = task.user_id as string
    if (!grouped.has(uid)) {
      grouped.set(uid, { name: resolveAssigneeName(task), tasks: [] })
    }
    grouped.get(uid)!.tasks.push(task)
  }

  const groups = Array.from(grouped.entries())
  const totalActive = allTasks.filter(t => t.status === 'active' || t.status === 'in_progress').length

  return (
    <div>
      <div style={s.header}>
        <h1 style={s.heading}>All Tasks</h1>
        <span style={s.badge}>{totalActive} active</span>
      </div>

      {groups.length === 0 ? (
        <div style={s.empty}>
          <p style={s.emptyTitle}>No tasks yet</p>
          <p style={s.emptyText}>Tasks created by team members will appear here.</p>
        </div>
      ) : (
        <div style={s.groups}>
          {groups.map(([uid, group]) => {
            const isMe = mySlackIds.has(uid)
            const active = group.tasks.filter(t => t.status === 'active' || t.status === 'in_progress')
            const rest = group.tasks.filter(t => t.status !== 'active' && t.status !== 'in_progress')
            return (
              <div key={uid} style={s.group}>
                <div style={s.groupHeader}>
                  <div style={s.groupAvatar}>{group.name[0]?.toUpperCase()}</div>
                  <span style={s.groupName}>{group.name}{isMe ? ' (you)' : ''}</span>
                  <span style={s.groupCount}>{active.length} active</span>
                </div>
                <div style={s.taskList}>
                  {group.tasks.map(t => (
                    <TaskCard
                      key={t.id as string}
                      task={t as Parameters<typeof TaskCard>[0]['task']}
                      readonly={!isMe}
                    />
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

const s: Record<string, React.CSSProperties> = {
  header: { display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '28px' },
  heading: { fontSize: '22px', fontWeight: 700, letterSpacing: '-0.03em', color: 'var(--text)' },
  badge: { background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: '100px', padding: '3px 10px', fontSize: '12px', color: 'var(--muted)' },
  groups: { display: 'flex', flexDirection: 'column', gap: '32px' },
  group: { display: 'flex', flexDirection: 'column', gap: '10px' },
  groupHeader: { display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '2px' },
  groupAvatar: { width: '28px', height: '28px', borderRadius: '50%', background: 'linear-gradient(135deg, #7c5cfc, #a78bfa)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px', fontWeight: 700, color: 'white', flexShrink: 0 },
  groupName: { fontSize: '15px', fontWeight: 600, color: 'var(--text)' },
  groupCount: { fontSize: '12px', color: 'var(--muted)', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: '100px', padding: '1px 8px' },
  taskList: { display: 'flex', flexDirection: 'column', gap: '6px' },
  empty: { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '16px', padding: '48px 32px', textAlign: 'center' },
  emptyTitle: { fontSize: '16px', fontWeight: 600, color: 'var(--text)', marginBottom: '8px' },
  emptyText: { fontSize: '14px', color: 'var(--muted)' },
}
