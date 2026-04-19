import { createClient } from '@/lib/supabase-server'
import { NextRequest, NextResponse } from 'next/server'

// Allowed team values. Keep in sync with ProfilePanel dropdown.
const ALLOWED_TEAMS = [
  'Product',
  'Engineering',
  'Sales',
  'Marketing',
  'Content',
  'Customer Support',
] as const

export async function PATCH(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { team?: string | null }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const raw = body.team
  // Accept null (clearing team) or one of the allowed strings.
  let team: string | null
  if (raw === null || raw === undefined || raw === '') {
    team = null
  } else if (typeof raw === 'string' && (ALLOWED_TEAMS as readonly string[]).includes(raw)) {
    team = raw
  } else {
    return NextResponse.json({ error: 'Invalid team' }, { status: 400 })
  }

  // RLS allows a user to update their own profile row.
  const { error } = await supabase
    .from('profiles')
    .update({ team })
    .eq('id', user.id)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true, team })
}
