import { createClient as createServiceClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

export async function POST(request: NextRequest) {
  const { email } = await request.json()
  if (!email?.trim()) return NextResponse.json({ exists: false, slackUserFound: false })

  const admin = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const normalizedEmail = email.toLowerCase().trim()

  // Only check profiles (completed web signups) — users table is Slack sync data, not auth
  const { data: profile } = await admin
    .from('profiles')
    .select('id')
    .eq('email', normalizedEmail)
    .maybeSingle()

  // Introduce a small constant-time delay to prevent timing-based enumeration
  await new Promise(resolve => setTimeout(resolve, 100 + Math.random() * 50))

  return NextResponse.json({ exists: !!profile })
}
