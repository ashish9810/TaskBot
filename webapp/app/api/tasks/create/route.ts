import { createClient } from '@/lib/supabase-server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { title, assignee_profile_id, status, priority, due_date } = await request.json()
  if (!title?.trim()) return NextResponse.json({ error: 'Title required' }, { status: 400 })

  const admin = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  // Get workspace via service role (avoids RLS recursion)
  const { data: membership } = await admin
    .from('workspace_members')
    .select('workspace_id, workspaces(id, slack_team_id)')
    .eq('profile_id', user.id)
    .single()

  if (!membership) return NextResponse.json({ error: 'No workspace' }, { status: 400 })

  const ws = membership.workspaces as unknown as { id: string; slack_team_id: string | null }

  // Resolve slack identity for assignee
  let taskUserId = user.id
  let taskTeamId: string | null = null

  const assigneeId = assignee_profile_id || user.id
  const { data: slackLink } = await admin
    .from('profile_slack_links')
    .select('slack_user_id, team_id')
    .eq('profile_id', assigneeId)
    .limit(1)
    .single()

  if (slackLink) {
    taskUserId = slackLink.slack_user_id
    taskTeamId = slackLink.team_id
  }

  const insert: Record<string, unknown> = {
    title: title.trim(),
    user_id: taskUserId,
    workspace_id: ws.id,
    status: status || 'active',
    position: 0,
  }

  if (priority) insert.priority = priority
  if (due_date) insert.due_date = due_date
  if (taskTeamId) insert.team_id = taskTeamId

  // Shift existing tasks down to make room at position 0
  const targetStatus = status || 'active'
  const { data: existingTasks } = await admin
    .from('tasks')
    .select('id, position')
    .eq('user_id', taskUserId)
    .eq('status', targetStatus)
    .not('status', 'eq', 'deleted')
    .order('position', { ascending: true })
  if (existingTasks && existingTasks.length > 0) {
    await Promise.all(
      existingTasks.map((t: { id: string; position: number | null }) =>
        admin.from('tasks').update({ position: (t.position ?? 0) + 1 }).eq('id', t.id)
      )
    )
  }

  const { data: task, error } = await admin
    .from('tasks')
    .insert(insert)
    .select()
    .single()

  if (error) return NextResponse.json({ error: 'Failed to create task' }, { status: 500 })

  return NextResponse.json(task)
}
