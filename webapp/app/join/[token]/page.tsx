import { createClient } from '@/lib/supabase-server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import JoinClient from './JoinClient'

type Props = { params: Promise<{ token: string }> }

export default async function JoinPage({ params }: Props) {
  const { token } = await params
  const supabase = await createClient()

  // Use service role to bypass RLS — invite lookup must work for unauthenticated users
  const admin = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const { data: invite } = await admin
    .from('workspace_invites')
    .select('workspace_id, workspaces(name)')
    .eq('token', token)
    .single()

  if (!invite) {
    return (
      <div style={s.page}>
        <div style={s.card}>
          <div style={s.logo}>Ping</div>
          <h1 style={s.title}>Invalid invite link</h1>
          <p style={s.text}>This invite link is invalid or has been revoked. Ask your teammate to generate a new one.</p>
        </div>
      </div>
    )
  }

  const workspaceName = (invite.workspaces as unknown as { name: string } | null)?.name || 'a workspace'

  // Check if user is already logged in
  const { data: { user } } = await supabase.auth.getUser()

  return (
    <JoinClient
      token={token}
      workspaceName={workspaceName}
      isLoggedIn={!!user}
      userId={user?.id || null}
    />
  )
}

const s: Record<string, React.CSSProperties> = {
  page: { minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)', padding: '24px' },
  card: { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '18px', padding: '40px', width: '100%', maxWidth: '400px', textAlign: 'center' as const },
  logo: { fontSize: '18px', fontWeight: 700, letterSpacing: '-0.03em', color: 'var(--text)', marginBottom: '24px' },
  title: { fontSize: '20px', fontWeight: 700, color: 'var(--text)', marginBottom: '12px' },
  text: { fontSize: '14px', color: 'var(--muted)', lineHeight: 1.6 },
}
