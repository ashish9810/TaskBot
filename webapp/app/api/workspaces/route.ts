import { createClient } from '@/lib/supabase-server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

export async function POST(request: NextRequest) {
  // Use anon client only for auth check
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  // Use service role client for all writes (bypasses RLS cleanly)
  const admin = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { name } = await request.json()
  if (!name?.trim()) return NextResponse.json({ error: 'Name required' }, { status: 400 })

  // Ensure profile exists (trigger may not have run yet)
  await admin.from('profiles').upsert({
    id: user.id,
    email: user.email,
    name: user.user_metadata?.name || user.email?.split('@')[0],
  }, { onConflict: 'id' })

  // Create workspace
  const { data: workspace, error: wsError } = await admin
    .from('workspaces')
    .insert({ name: name.trim(), created_by: user.id })
    .select()
    .single()

  if (wsError || !workspace) {
    console.error('Workspace insert error:', wsError)
    return NextResponse.json({ error: wsError?.message || 'Failed to create workspace' }, { status: 500 })
  }

  // Add user as owner
  const { error: memberError } = await admin
    .from('workspace_members')
    .insert({ workspace_id: workspace.id, profile_id: user.id, role: 'owner' })

  if (memberError) {
    console.error('Member insert error:', memberError)
    // Rollback workspace
    await admin.from('workspaces').delete().eq('id', workspace.id)
    return NextResponse.json({ error: memberError.message }, { status: 500 })
  }

  return NextResponse.json(workspace)
}
