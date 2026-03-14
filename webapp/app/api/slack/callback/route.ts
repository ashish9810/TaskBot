import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export async function GET(req: NextRequest) {
  const teamId = req.nextUrl.searchParams.get('team_id')
  const workspaceId = req.cookies.get('pending_workspace_id')?.value

  if (teamId && workspaceId) {
    const admin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )
    await admin
      .from('workspaces')
      .update({ slack_team_id: teamId })
      .eq('id', workspaceId)
  }

  const response = NextResponse.redirect(new URL('/dashboard', req.url))
  response.cookies.delete('pending_workspace_id')
  return response
}
