import { createServerClient } from '@supabase/ssr'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { autoJoinSlackWorkspace } from '@/lib/sync'

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const origin = process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin
  const code = searchParams.get('code')
  const type = searchParams.get('type') // 'recovery' for password reset links
  const next = searchParams.get('next') ?? '/dashboard'

  if (code) {
    const cookieStore = await cookies()
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() { return cookieStore.getAll() },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          },
        },
      }
    )
    const { data: sessionData, error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
      // Password reset links should land on the reset-password page, not dashboard
      if (type === 'recovery') {
        return NextResponse.redirect(`${origin}/reset-password`)
      }

      // If a specific next param was provided (e.g. from invite flow), honour it
      if (searchParams.get('next')) {
        return NextResponse.redirect(`${origin}${next}`)
      }

      // Auto-join workspace if user has a Slack identity, then check membership
      if (sessionData?.user) {
        const admin = createServiceClient(
          process.env.NEXT_PUBLIC_SUPABASE_URL!,
          process.env.SUPABASE_SERVICE_ROLE_KEY!
        )

        // Attempt auto-join: links profile_slack_links + joins workspace if eligible
        if (sessionData.user.email) {
          await autoJoinSlackWorkspace(admin, sessionData.user.id, sessionData.user.email)
        }

        // Now check membership (using admin to avoid RLS timing issues with fresh profiles)
        const { data: membership } = await admin
          .from('workspace_members')
          .select('workspace_id')
          .eq('profile_id', sessionData.user.id)
          .limit(1)
          .maybeSingle()

        if (!membership) {
          return NextResponse.redirect(`${origin}/onboarding`)
        }
      }

      return NextResponse.redirect(`${origin}/dashboard`)
    }
    // Link expired or already used
    return NextResponse.redirect(`${origin}/auth/error?reason=link_expired`)
  }

  return NextResponse.redirect(`${origin}/login?error=auth_failed`)
}
