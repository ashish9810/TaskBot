import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
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

      // New signup: check if user already has a workspace; if not, send to onboarding
      if (sessionData?.user) {
        const { data: membership } = await supabase
          .from('workspace_members')
          .select('workspace_id')
          .eq('profile_id', sessionData.user.id)
          .limit(1)
          .single()

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
