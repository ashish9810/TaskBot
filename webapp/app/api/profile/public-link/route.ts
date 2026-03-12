import { createClient } from '@/lib/supabase-server'
import { NextResponse } from 'next/server'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles')
    .select('public_token')
    .eq('id', user.id)
    .single()

  if (!profile?.public_token) {
    return NextResponse.json({ error: 'No public token' }, { status: 404 })
  }

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
  return NextResponse.json({ url: `${baseUrl}/u/${profile.public_token}` })
}
