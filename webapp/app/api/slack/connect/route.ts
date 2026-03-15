import { NextRequest, NextResponse } from 'next/server'

export async function GET(req: NextRequest) {
  const workspaceId = req.nextUrl.searchParams.get('workspace_id')
  const botUrl = process.env.SLACK_BOT_URL || 'http://localhost:3000'
  const response = NextResponse.redirect(`${botUrl}/slack/install`)
  if (workspaceId) {
    response.cookies.set('pending_workspace_id', workspaceId, {
      httpOnly: true,
      maxAge: 600, // 10 minutes
      sameSite: 'lax',
    })
  }
  return response
}
