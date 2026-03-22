import { createClient } from '@/lib/supabase-server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  // Resolve slack identity
  const { data: slackLink } = await admin
    .from('profile_slack_links')
    .select('slack_user_id')
    .eq('profile_id', user.id)
    .limit(1)
    .single()

  let tasks
  if (slackLink) {
    const { data } = await admin
      .from('tasks')
      .select('*')
      .or(`user_id.eq.${slackLink.slack_user_id},user_id.eq.${user.id}`)
      .not('status', 'eq', 'deleted')
      .order('created_at', { ascending: false })
    tasks = data
  } else {
    const { data } = await admin
      .from('tasks')
      .select('*')
      .eq('user_id', user.id)
      .not('status', 'eq', 'deleted')
      .order('created_at', { ascending: false })
    tasks = data
  }

  return NextResponse.json(tasks || [])
}
