import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

type Props = { params: Promise<{ token: string }> }

export default async function PublicProfilePage({ params }: Props) {
  const { token } = await params

  // Use service role key for public reads (safe — read-only, no mutations)
  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll() },
        setAll() {},
      },
    }
  )

  // Look up profile by public_token
  const { data: profile } = await supabase
    .from('profiles')
    .select('id, name, email')
    .eq('public_token', token)
    .single()

  if (!profile) {
    return (
      <div style={s.page}>
        <div style={s.card}>
          <div style={s.logo}>Ping</div>
          <h1 style={s.title}>Profile not found</h1>
          <p style={s.text}>This link may be invalid or the user may have deleted their account.</p>
        </div>
      </div>
    )
  }

  // Get their Slack identity (if any) to find tasks
  const { data: slackLinks } = await supabase
    .from('profile_slack_links')
    .select('slack_user_id, team_id')
    .eq('profile_id', profile.id)

  let activeTasks: Record<string, unknown>[] = []
  let doneTasks: Record<string, unknown>[] = []

  if (slackLinks && slackLinks.length > 0) {
    const slackId = slackLinks[0].slack_user_id
    const teamId = slackLinks[0].team_id

    const { data: active } = await supabase
      .from('tasks')
      .select('id, title, status, created_at')
      .eq('user_id', slackId)
      .eq('team_id', teamId)
      .in('status', ['active', 'in_progress'])
      .order('created_at', { ascending: false })

    const { data: done } = await supabase
      .from('tasks')
      .select('id, title, status, created_at, completed_at')
      .eq('user_id', slackId)
      .eq('team_id', teamId)
      .eq('status', 'completed')
      .order('completed_at', { ascending: false })
      .limit(10)

    activeTasks = active || []
    doneTasks = done || []
  } else {
    // Web-only tasks
    const { data: active } = await supabase
      .from('tasks')
      .select('id, title, status, created_at')
      .eq('user_id', profile.id)
      .in('status', ['active', 'in_progress'])
      .order('created_at', { ascending: false })

    const { data: done } = await supabase
      .from('tasks')
      .select('id, title, status, created_at, completed_at')
      .eq('user_id', profile.id)
      .eq('status', 'completed')
      .order('completed_at', { ascending: false })
      .limit(10)

    activeTasks = active || []
    doneTasks = done || []
  }

  const displayName = profile.name || profile.email?.split('@')[0] || 'User'

  const STATUS_LABEL: Record<string, string> = {
    active: 'To Do',
    in_progress: 'In Progress',
  }
  const STATUS_COLOR: Record<string, string> = {
    active: '#4ade80',
    in_progress: '#60a5fa',
  }

  return (
    <div style={s.page}>
      <div style={s.container}>
        {/* Header */}
        <div style={s.header}>
          <div style={s.avatar}>{displayName[0].toUpperCase()}</div>
          <div>
            <h1 style={s.name}>{displayName}</h1>
            <p style={s.meta}>{activeTasks.length} active task{activeTasks.length !== 1 ? 's' : ''}</p>
          </div>
        </div>
        <div style={s.poweredBy}>Powered by <strong>Ping</strong></div>

        {/* Active tasks */}
        {activeTasks.length > 0 && (
          <div style={s.section}>
            <h2 style={s.sectionTitle}>Working on</h2>
            <div style={s.taskList}>
              {activeTasks.map(t => (
                <div key={t.id as string} style={s.taskCard}>
                  <div style={{ ...s.dot, background: STATUS_COLOR[t.status as string] || '#4ade80' }} />
                  <span style={s.taskTitle}>{t.title as string}</span>
                  <span style={s.statusLabel}>{STATUS_LABEL[t.status as string] || 'Active'}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Recently done */}
        {doneTasks.length > 0 && (
          <div style={s.section}>
            <h2 style={s.sectionTitle}>Recently done</h2>
            <div style={s.taskList}>
              {doneTasks.map(t => (
                <div key={t.id as string} style={{ ...s.taskCard, opacity: 0.6 }}>
                  <div style={{ ...s.dot, background: 'var(--muted)' }} />
                  <span style={{ ...s.taskTitle, textDecoration: 'line-through', color: 'var(--muted)' }}>
                    {t.title as string}
                  </span>
                  {t.completed_at ? (
                    <span style={s.statusLabel}>
                      {new Date(t.completed_at as string).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    </span>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTasks.length === 0 && doneTasks.length === 0 && (
          <div style={s.empty}>
            <p style={s.emptyText}>No tasks to show yet.</p>
          </div>
        )}
      </div>
    </div>
  )
}

const s: Record<string, React.CSSProperties> = {
  page: { minHeight: '100vh', background: 'var(--bg)', padding: '40px 24px' },
  container: { maxWidth: '600px', margin: '0 auto' },
  header: { display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '8px' },
  avatar: { width: '52px', height: '52px', borderRadius: '50%', background: 'linear-gradient(135deg, #7c5cfc, #a78bfa)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '20px', fontWeight: 700, color: 'white', flexShrink: 0 },
  name: { fontSize: '22px', fontWeight: 700, letterSpacing: '-0.03em', color: 'var(--text)', marginBottom: '2px' },
  meta: { fontSize: '13px', color: 'var(--muted)' },
  poweredBy: { fontSize: '12px', color: 'var(--muted)', marginBottom: '32px' },
  section: { marginBottom: '32px' },
  sectionTitle: { fontSize: '13px', fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase' as const, letterSpacing: '0.04em', marginBottom: '10px' },
  taskList: { display: 'flex', flexDirection: 'column', gap: '6px' },
  taskCard: { display: 'flex', alignItems: 'center', gap: '12px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '10px', padding: '12px 14px' },
  dot: { width: '8px', height: '8px', borderRadius: '50%', flexShrink: 0 },
  taskTitle: { flex: 1, fontSize: '14px', fontWeight: 500, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const },
  statusLabel: { fontSize: '12px', color: 'var(--muted)', flexShrink: 0 },
  empty: { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '12px', padding: '32px', textAlign: 'center' as const },
  emptyText: { fontSize: '14px', color: 'var(--muted)' },
  card: { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '18px', padding: '40px', maxWidth: '400px', margin: '0 auto', textAlign: 'center' as const },
  logo: { fontSize: '18px', fontWeight: 700, letterSpacing: '-0.03em', color: 'var(--text)', marginBottom: '24px' },
  title: { fontSize: '20px', fontWeight: 700, color: 'var(--text)', marginBottom: '12px' },
  text: { fontSize: '14px', color: 'var(--muted)', lineHeight: 1.6 },
}
