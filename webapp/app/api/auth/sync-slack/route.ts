import { createClient } from '@/lib/supabase-server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

export async function POST() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const email = user.email
  if (!email) return NextResponse.json({ linked: 0 })

  // Find Slack users with this email (using service role to bypass RLS)
  const { data: slackUsers } = await admin
    .from('users')
    .select('slack_user_id, team_id')
    .ilike('email', email)

  if (!slackUsers || slackUsers.length === 0) {
    return NextResponse.json({ linked: 0 })
  }

  // Upsert all found Slack identities
  const links = slackUsers.map(u => ({
    profile_id: user.id,
    slack_user_id: u.slack_user_id,
    team_id: u.team_id,
  }))

  await admin
    .from('profile_slack_links')
    .upsert(links, { onConflict: 'slack_user_id,team_id' })

  return NextResponse.json({ linked: links.length })
}
