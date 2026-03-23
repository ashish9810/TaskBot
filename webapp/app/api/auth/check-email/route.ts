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

  // Check both profiles (web accounts) and users (Slack-synced) in parallel
  const [{ data: profile }, { data: slackUser }] = await Promise.all([
    admin.from('profiles').select('id').eq('email', normalizedEmail).maybeSingle(),
    admin.from('users').select('slack_user_id').ilike('email', normalizedEmail).limit(1).maybeSingle(),
  ])

  return NextResponse.json({ exists: !!profile, slackUserFound: !!slackUser })
}
