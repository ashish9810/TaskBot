import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase-server'

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const params = await searchParams

  // Supabase redirects expired/invalid email links to /?error=access_denied&error_code=otp_expired
  // Catch these and send users to login with a friendly message
  if (params.error === 'access_denied' || params.error_code === 'otp_expired') {
    redirect('/login?error=reset_link_invalid')
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (user) {
    redirect('/dashboard')
  } else {
    redirect('/home')
  }
}
