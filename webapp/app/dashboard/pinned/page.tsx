import { createClient } from '@/lib/supabase-server'
import { getSlackIdentities } from '@/lib/sync'
import Link from 'next/link'

type PinnedUser = {
  slack_user_id: string
  name: string
  email: string
  active_tasks: number
}

export default async function PinnedPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const identities = await getSlackIdentities(supabase, user.id)

  if (identities.length === 0) {
    return (
      <div>
        <h1 style={styles.heading}>Pinned</h1>
        <p style={{ color: 'var(--muted)', fontSize: '14px', marginTop: '12px' }}>
          No Slack workspace linked to your account.
        </p>
      </div>
    )
  }

  const { slack_user_id, team_id } = identities[0]

  // Get pinned user IDs
  const { data: favorites } = await supabase
    .from('favorites')
    .select('favorite_user_id')
    .eq('manager_user_id', slack_user_id)
    .eq('team_id', team_id)

  if (!favorites || favorites.length === 0) {
    return (
      <div>
        <h1 style={styles.heading}>Pinned</h1>
        <div style={styles.empty}>
          <div style={styles.emptyIcon}>📌</div>
          <p style={styles.emptyTitle}>No pinned teammates</p>
          <p style={styles.emptyText}>
            Pin teammates in Slack using Ping to see them here for quick access.
          </p>
        </div>
      </div>
    )
  }

  const pinnedIds = favorites.map((f: { favorite_user_id: string }) => f.favorite_user_id)

  // Get user details for pinned users
  const { data: pinnedUsers } = await supabase
    .from('users')
    .select('slack_user_id, name, email')
    .in('slack_user_id', pinnedIds)
    .eq('team_id', team_id)

  // Get active task counts for each pinned user
  const taskCounts: Record<string, number> = {}
  if (pinnedUsers) {
    for (const u of pinnedUsers) {
      const { count } = await supabase
        .from('tasks')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', u.slack_user_id)
        .eq('team_id', team_id)
        .eq('status', 'active')
      taskCounts[u.slack_user_id] = count || 0
    }
  }

  const enriched: PinnedUser[] = (pinnedUsers || []).map((u) => ({
    ...u,
    active_tasks: taskCounts[u.slack_user_id] || 0,
  }))

  return (
    <div>
      <div style={styles.header}>
        <h1 style={styles.heading}>Pinned</h1>
        <span style={styles.badge}>{enriched.length}</span>
      </div>

      <div style={styles.grid}>
        {enriched.map((u) => (
          <Link key={u.slack_user_id} href={`/dashboard/people/${u.slack_user_id}`} style={styles.card}>
            <div style={styles.avatar}>
              {(u.name || u.email || '?')[0].toUpperCase()}
            </div>
            <div style={styles.info}>
              <div style={styles.name}>{u.name || '(No name)'}</div>
              <div style={styles.email}>{u.email || 'No email'}</div>
            </div>
            <div style={styles.taskBadge}>
              <span style={styles.taskCount}>{u.active_tasks}</span>
              <span style={styles.taskLabel}>tasks</span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    marginBottom: '24px',
  },
  heading: {
    fontSize: '22px',
    fontWeight: 700,
    letterSpacing: '-0.03em',
    color: 'var(--text)',
  },
  badge: {
    background: 'var(--surface2)',
    border: '1px solid var(--border)',
    borderRadius: '100px',
    padding: '3px 10px',
    fontSize: '12px',
    color: 'var(--muted)',
  },
  grid: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  card: {
    display: 'flex',
    alignItems: 'center',
    gap: '14px',
    background: 'var(--surface)',
    border: '1px solid var(--border)',
    borderRadius: '12px',
    padding: '14px 16px',
    textDecoration: 'none',
    transition: 'border-color 0.15s',
    cursor: 'pointer',
  },
  avatar: {
    width: '36px',
    height: '36px',
    borderRadius: '50%',
    background: 'linear-gradient(135deg, #7c5cfc, #a78bfa)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '14px',
    fontWeight: 700,
    color: 'white',
    flexShrink: 0,
  },
  info: {
    flex: 1,
    minWidth: 0,
  },
  name: {
    fontSize: '14px',
    fontWeight: 600,
    color: 'var(--text)',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  email: {
    fontSize: '12px',
    color: 'var(--muted)',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  taskBadge: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    flexShrink: 0,
  },
  taskCount: {
    fontSize: '16px',
    fontWeight: 700,
    color: 'var(--text)',
    lineHeight: 1.2,
  },
  taskLabel: {
    fontSize: '10px',
    color: 'var(--muted)',
    letterSpacing: '0.03em',
  },
  empty: {
    background: 'var(--surface)',
    border: '1px solid var(--border)',
    borderRadius: '16px',
    padding: '48px 32px',
    textAlign: 'center',
    marginTop: '16px',
  },
  emptyIcon: {
    fontSize: '32px',
    marginBottom: '12px',
  },
  emptyTitle: {
    fontSize: '16px',
    fontWeight: 600,
    color: 'var(--text)',
    marginBottom: '8px',
  },
  emptyText: {
    fontSize: '14px',
    color: 'var(--muted)',
    maxWidth: '340px',
    margin: '0 auto',
    lineHeight: 1.6,
  },
}
