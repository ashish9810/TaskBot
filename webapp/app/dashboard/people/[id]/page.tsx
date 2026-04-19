import { createClient } from '@/lib/supabase-server'
import { getSlackIdentities } from '@/lib/sync'
import TaskCard from '@/components/TaskCard'
import Link from 'next/link'

type Props = { params: Promise<{ id: string }> }

export default async function PersonPage({ params }: Props) {
  const { id: slackUserId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const identities = await getSlackIdentities(supabase, user.id)
  if (identities.length === 0) return null

  const { team_id } = identities[0]

  const [{ data: person }, { data: activeTasks }, { data: completedTasks }] = await Promise.all([
    supabase.from('users').select('name, email').eq('slack_user_id', slackUserId).eq('team_id', team_id).single(),
    supabase.from('tasks').select('*').eq('user_id', slackUserId).eq('team_id', team_id).eq('status', 'active').order('created_at', { ascending: false }),
    supabase.from('tasks').select('*').eq('user_id', slackUserId).eq('team_id', team_id).eq('status', 'completed').order('completed_at', { ascending: false }).limit(10),
  ])

  const displayName = person?.name || person?.email || slackUserId

  return (
    <div>
      <div style={styles.header}>
        <Link href="/dashboard/people" style={styles.back}>← People</Link>
        <div style={styles.personHeader}>
          <div style={styles.avatar}>
            {displayName[0].toUpperCase()}
          </div>
          <div>
            <h1 style={styles.heading}>{displayName}</h1>
            {person?.email && <p style={styles.email}>{person.email}</p>}
          </div>
        </div>
      </div>

      <div style={styles.section}>
        <div style={styles.sectionHeader}>
          <h2 style={styles.subheading}>Active Tasks</h2>
          <span style={styles.badge}>{activeTasks?.length || 0}</span>
        </div>
        {activeTasks && activeTasks.length > 0 ? (
          <div style={styles.taskList}>
            {activeTasks.map((task) => (
              <TaskCard key={task.id} task={task} />
            ))}
          </div>
        ) : (
          <p style={styles.empty}>No active tasks.</p>
        )}
      </div>

      {completedTasks && completedTasks.length > 0 && (
        <div style={{ ...styles.section, marginTop: '32px' }}>
          <div style={styles.sectionHeader}>
            <h2 style={styles.subheading}>Recently Completed</h2>
          </div>
          <div style={styles.taskList}>
            {completedTasks.map((task) => (
              <TaskCard key={task.id} task={task} readonly />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  header: {
    marginBottom: '28px',
  },
  back: {
    fontSize: '13px',
    color: 'var(--muted)',
    textDecoration: 'none',
    display: 'inline-block',
    marginBottom: '16px',
  },
  personHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '16px',
  },
  avatar: {
    width: '48px',
    height: '48px',
    borderRadius: '50%',
    background: 'linear-gradient(135deg, #E06C4D, #F0926E)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '18px',
    fontWeight: 700,
    color: 'white',
    flexShrink: 0,
  },
  heading: {
    fontSize: '20px',
    fontWeight: 700,
    letterSpacing: '-0.03em',
    color: 'var(--text)',
  },
  email: {
    fontSize: '13px',
    color: 'var(--muted)',
    marginTop: '2px',
  },
  section: {},
  sectionHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    marginBottom: '12px',
  },
  subheading: {
    fontSize: '14px',
    fontWeight: 600,
    color: 'var(--muted)',
    letterSpacing: '-0.01em',
  },
  badge: {
    background: 'var(--surface2)',
    border: '1px solid var(--border)',
    borderRadius: '100px',
    padding: '2px 8px',
    fontSize: '11px',
    color: 'var(--muted)',
  },
  taskList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  empty: {
    fontSize: '14px',
    color: 'var(--muted)',
  },
}
