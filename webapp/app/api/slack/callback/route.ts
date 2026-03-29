import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase-server'

export async function GET(req: NextRequest) {
  // Verify the user is authenticated
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.redirect(new URL('/login', req.url))
  }

  const teamId = req.nextUrl.searchParams.get('team_id')
  const workspaceId = req.cookies.get('pending_workspace_id')?.value

  if (teamId && workspaceId) {
    const admin = createServiceClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    // Verify the user is a member of this workspace before linking
    const { data: membership } = await admin
      .from('workspace_members')
      .select('workspace_id')
      .eq('profile_id', user.id)
      .eq('workspace_id', workspaceId)
      .single()

    if (membership) {
      await admin
        .from('workspaces')
        .update({ slack_team_id: teamId })
        .eq('id', workspaceId)
    }
  }

  const response = NextResponse.redirect(new URL('/dashboard?slack_connected=true', req.url))
  response.cookies.delete('pending_workspace_id')
  return response
}
