import { createClient as createServiceClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

export async function POST(request: NextRequest) {
  const { email } = await request.json()
  if (!email?.trim()) return NextResponse.json({ cleared: false })

  const admin = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const normalizedEmail = email.toLowerCase().trim()

  // Check if a real web account exists (profiles = completed signup)
  const { data: profile } = await admin
    .from('profiles')
    .select('id')
    .eq('email', normalizedEmail)
    .maybeSingle()

  if (profile) {
    // Real account — don't touch
    return NextResponse.json({ cleared: false, reason: 'account_exists' })
  }

  // No profile — find and delete orphaned auth record
  const { data: { users } } = await admin.auth.admin.listUsers({ page: 1, perPage: 50 })
  const authUser = users.find(u => u.email?.toLowerCase() === normalizedEmail)

  if (authUser) {
    await admin.auth.admin.deleteUser(authUser.id)
    return NextResponse.json({ cleared: true })
  }

  return NextResponse.json({ cleared: false })
}
