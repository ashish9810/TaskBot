import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase-server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import Sidebar from '@/components/Sidebar'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  // Use service role for workspace reads (avoids RLS recursion issues)
  const admin = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const [{ data: profile }, { data: membership }] = await Promise.all([
    admin.from('profiles').select('name, email').eq('id', user.id).single(),
    admin.from('workspace_members').select('workspace_id, role').eq('profile_id', user.id).limit(1).single(),
  ])

  if (!membership) redirect('/onboarding')

  const { data: workspace } = await admin
    .from('workspaces')
    .select('id, name, slack_team_id')
    .eq('id', membership.workspace_id)
    .single()

  return (
    <div style={styles.shell}>
      <Sidebar
        user={{ name: profile?.name || user.email || 'User', email: profile?.email || user.email || '' }}
        workspace={workspace ? { id: workspace.id, name: workspace.name, slackConnected: !!workspace.slack_team_id } : null}
        role={membership.role as 'owner' | 'member'}
      />
      <main style={styles.main}>
        {children}
      </main>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  shell: {
    display: 'flex',
    height: '100vh',
    overflow: 'hidden',
    background: 'var(--bg)',
  },
  main: {
    flex: 1,
    padding: '28px 32px',
    overflowY: 'auto',
    display: 'flex',
    flexDirection: 'column',
    minHeight: 0,
  },
}
