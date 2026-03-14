import { createClient } from '@/lib/supabase-server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { token } = await request.json()
  if (!token) return NextResponse.json({ error: 'Token required' }, { status: 400 })

  const admin = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  // Check if user already in a workspace
  const { data: existing } = await admin
    .from('workspace_members')
    .select('workspace_id')
    .eq('profile_id', user.id)
    .single()

  if (existing) {
    return NextResponse.json({ error: 'already_in_workspace' }, { status: 409 })
  }

  // Look up invite token
  const { data: invite } = await admin
    .from('workspace_invites')
    .select('workspace_id, workspaces(name)')
    .eq('token', token)
    .single()

  if (!invite) {
    return NextResponse.json({ error: 'invalid_token' }, { status: 404 })
  }

  // Join the workspace
  const { error } = await admin
    .from('workspace_members')
    .insert({ workspace_id: invite.workspace_id, profile_id: user.id, role: 'member' })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true, workspace_name: (invite.workspaces as unknown as { name: string })?.name })
}
