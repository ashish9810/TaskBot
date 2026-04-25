import { createClient } from '@/lib/supabase-server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

const MAX_LABEL_LENGTH = 40

export async function PATCH(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { tech_label?: string; design_label?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const admin = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  // Resolve caller's workspace
  const { data: membership } = await admin
    .from('workspace_members')
    .select('workspace_id')
    .eq('profile_id', user.id)
    .single()

  if (!membership) return NextResponse.json({ error: 'No workspace' }, { status: 400 })

  const updates: Record<string, string> = {}

  if (body.tech_label !== undefined) {
    const label = body.tech_label.trim()
    if (!label) return NextResponse.json({ error: 'tech_label cannot be empty' }, { status: 400 })
    if (label.length > MAX_LABEL_LENGTH) return NextResponse.json({ error: `tech_label max ${MAX_LABEL_LENGTH} chars` }, { status: 400 })
    updates.tech_label = label
  }

  if (body.design_label !== undefined) {
    const label = body.design_label.trim()
    if (!label) return NextResponse.json({ error: 'design_label cannot be empty' }, { status: 400 })
    if (label.length > MAX_LABEL_LENGTH) return NextResponse.json({ error: `design_label max ${MAX_LABEL_LENGTH} chars` }, { status: 400 })
    updates.design_label = label
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
  }

  const { error } = await admin
    .from('workspaces')
    .update(updates)
    .eq('id', membership.workspace_id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true, ...updates })
}
