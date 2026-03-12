import { createClient } from '@/lib/supabase-server'
import { getUserWorkspace, getOrCreateInvite, regenerateInvite } from '@/lib/workspace'
import { NextRequest, NextResponse } from 'next/server'

// GET — return (or create) the current invite link for user's workspace
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const workspace = await getUserWorkspace(supabase, user.id)
  if (!workspace) return NextResponse.json({ error: 'No workspace' }, { status: 400 })

  const token = await getOrCreateInvite(supabase, user.id, workspace.id)
  return NextResponse.json({ token, workspace_name: workspace.name })
}

// POST — regenerate invite token
export async function POST() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const workspace = await getUserWorkspace(supabase, user.id)
  if (!workspace) return NextResponse.json({ error: 'No workspace' }, { status: 400 })

  const token = await regenerateInvite(supabase, user.id, workspace.id)
  return NextResponse.json({ token, workspace_name: workspace.name })
}
