import { createClient } from '@/lib/supabase-server'
import { NextRequest, NextResponse } from 'next/server'

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const { status, title, priority, due_date } = body

  if (!status && !title && priority === undefined && due_date === undefined) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
  }

  const allowed = ['backlog', 'active', 'in_progress', 'completed']
  if (status && !allowed.includes(status)) {
    return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
  }

  // Get the task first to verify ownership
  const { data: task, error: fetchError } = await supabase
    .from('tasks')
    .select('id, user_id, workspace_id, team_id')
    .eq('id', id)
    .single()

  if (fetchError || !task) {
    return NextResponse.json({ error: 'Task not found' }, { status: 404 })
  }

  // Verify caller owns this task (Slack user_id match or direct profile_id match)
  const { data: slackLinks } = await supabase
    .from('profile_slack_links')
    .select('slack_user_id')
    .eq('profile_id', user.id)

  const slackIds = slackLinks?.map(l => l.slack_user_id) || []
  const ownsViaSlack = slackIds.includes(task.user_id)
  const ownsViaWeb = task.user_id === user.id

  if (!ownsViaSlack && !ownsViaWeb) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const updates: Record<string, unknown> = {}
  if (title !== undefined) updates.title = title.trim()
  if (status !== undefined) {
    updates.status = status
    if (status === 'completed') {
      updates.completed_at = new Date().toISOString()
    } else {
      updates.completed_at = null
    }
  }
  if (priority !== undefined) updates.priority = priority
  if (due_date !== undefined) updates.due_date = due_date

  const { data: updated, error: updateError } = await supabase
    .from('tasks')
    .update(updates)
    .eq('id', id)
    .select()
    .single()

  if (updateError) {
    return NextResponse.json({ error: 'Failed to update task' }, { status: 500 })
  }

  return NextResponse.json(updated)
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: task } = await supabase
    .from('tasks')
    .select('id, user_id')
    .eq('id', id)
    .single()

  if (!task) return NextResponse.json({ error: 'Task not found' }, { status: 404 })

  const { data: slackLinks } = await supabase
    .from('profile_slack_links')
    .select('slack_user_id')
    .eq('profile_id', user.id)

  const slackIds = slackLinks?.map(l => l.slack_user_id) || []
  const ownsViaSlack = slackIds.includes(task.user_id)
  const ownsViaWeb = task.user_id === user.id

  if (!ownsViaSlack && !ownsViaWeb) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Delete updates first, then the task
  const { createClient: createServiceClient } = await import('@supabase/supabase-js')
  const admin = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
  await admin.from('updates').delete().eq('task_id', id)
  const { error } = await admin.from('tasks').delete().eq('id', id)

  if (error) return NextResponse.json({ error: 'Failed to delete task' }, { status: 500 })

  return NextResponse.json({ deleted: true })
}
