import { createClient } from '@/lib/supabase-server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

const admin = () => createServiceClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = admin()
  const { data: updates, error } = await db
    .from('updates')
    .select('*')
    .eq('task_id', id)
    .order('created_at', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Resolve user names for updates
  const userIds = [...new Set((updates || []).map(u => u.user_id))]
  const { data: users } = await db
    .from('users')
    .select('slack_user_id, name')
    .in('slack_user_id', userIds)

  const nameMap: Record<string, string> = {}
  for (const u of (users || [])) {
    nameMap[u.slack_user_id] = u.name
  }

  // Also check profiles for web-only users
  const { data: profiles } = await db
    .from('profiles')
    .select('id, name')
    .in('id', userIds)

  for (const p of (profiles || [])) {
    if (!nameMap[p.id]) nameMap[p.id] = p.name
  }

  const enriched = (updates || []).map(u => ({
    ...u,
    user_name: nameMap[u.user_id] || 'Unknown',
  }))

  return NextResponse.json(enriched)
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { content } = await request.json()
  if (!content?.trim()) return NextResponse.json({ error: 'Content required' }, { status: 400 })

  const db = admin()

  // Get task to find team_id and resolve user's slack identity
  const { data: task } = await db
    .from('tasks')
    .select('team_id')
    .eq('id', id)
    .single()

  if (!task) return NextResponse.json({ error: 'Task not found' }, { status: 404 })

  // Resolve user's slack identity for the update
  let updateUserId = user.id
  const { data: slackLink } = await db
    .from('profile_slack_links')
    .select('slack_user_id')
    .eq('profile_id', user.id)
    .limit(1)
    .single()

  if (slackLink) updateUserId = slackLink.slack_user_id

  const { data: update, error } = await db
    .from('updates')
    .insert({
      task_id: id,
      content: content.trim(),
      user_id: updateUserId,
      team_id: task.team_id,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json(update)
}
