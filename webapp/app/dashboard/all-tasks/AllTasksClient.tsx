'use client'

import { useState } from 'react'
import TaskCard from '@/components/TaskCard'

type TaskData = Record<string, unknown>
type Group = { name: string; email?: string; tasks: TaskData[] }

type StatusSection = {
  key: string
  label: string
  color: string
  accent: string
  bg: string
  tasks: TaskData[]
}

function PersonAccordion({ uid, group, isMe }: { uid: string; group: Group; isMe: boolean }) {
  const [expanded, setExpanded] = useState(false)

  const sections: StatusSection[] = [
    { key: 'backlog', label: 'Inbox', color: '#f59e0b', accent: 'rgba(245,158,11,0.3)', bg: 'rgba(245,158,11,0.08)', tasks: group.tasks.filter(t => t.status === 'backlog') },
    { key: 'active', label: 'To Do', color: '#94a3b8', accent: 'rgba(148,163,184,0.3)', bg: 'rgba(148,163,184,0.08)', tasks: group.tasks.filter(t => t.status === 'active') },
    { key: 'in_progress', label: 'In Progress', color: '#60a5fa', accent: 'rgba(96,165,250,0.3)', bg: 'rgba(96,165,250,0.08)', tasks: group.tasks.filter(t => t.status === 'in_progress') },
    { key: 'completed', label: 'Done', color: '#4ade80', accent: 'rgba(74,222,128,0.3)', bg: 'rgba(74,222,128,0.08)', tasks: group.tasks.filter(t => t.status === 'completed') },
  ].filter(sec => sec.tasks.length > 0)

  const totalActive = group.tasks.filter(t => t.status === 'backlog' || t.status === 'active' || t.status === 'in_progress').length

  return (
    <div style={s.person}>
      {/* Person header — click to expand/collapse */}
      <button onClick={() => setExpanded(v => !v)} style={s.personHeader}>
        <div style={s.personLeft}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ ...s.chevron, transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)' }}>
            <path d="M5 3l4 4-4 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          <div style={s.avatar}>{group.name[0]?.toUpperCase()}</div>
          <span style={s.personName}>{group.name}{isMe ? ' (you)' : ''}</span>
        </div>
        <div style={s.badges}>
          {sections.map(sec => (
            <span key={sec.key} style={{ ...s.countBadge, color: sec.color, borderColor: sec.accent, background: sec.bg }}>
              {sec.tasks.length} {sec.label.toLowerCase()}
            </span>
          ))}
          {totalActive > 0 && (
            <span style={s.totalBadge}>{totalActive} active</span>
          )}
        </div>
      </button>

      {/* Expanded: status sections */}
      {expanded && (
        <div style={s.sections}>
          {sections.map(sec => (
            <StatusAccordion key={sec.key} section={sec} isMe={isMe} />
          ))}
        </div>
      )}
    </div>
  )
}

function StatusAccordion({ section, isMe }: { section: StatusSection; isMe: boolean }) {
  const [open, setOpen] = useState(section.key !== 'completed')

  return (
    <div style={s.statusSection}>
      <button onClick={() => setOpen(v => !v)} style={s.statusHeader}>
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" style={{ ...s.miniChevron, transform: open ? 'rotate(90deg)' : 'rotate(0deg)' }}>
          <path d="M3.5 2l3 3-3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
        <span style={{ ...s.statusDot, background: section.color }} />
        <span style={{ ...s.statusLabel, color: section.color }}>{section.label}</span>
        <span style={s.statusCount}>{section.tasks.length}</span>
      </button>
      {open && (
        <div style={s.taskList}>
          {section.tasks.map(t => (
            <TaskCard
              key={t.id as string}
              task={t as Parameters<typeof TaskCard>[0]['task']}
              readonly={!isMe}
            />
          ))}
        </div>
      )}
    </div>
  )
}

export default function AllTasksClient({ groups, mySlackIds }: {
  groups: [string, Group][]
  mySlackIds: string[]
}) {
  const [search, setSearch] = useState('')
  const myIds = new Set(mySlackIds)

  // Sort: signed-in user always on top
  const sorted = [...groups].sort((a, b) => {
    const aIsMe = myIds.has(a[0]) ? 0 : 1
    const bIsMe = myIds.has(b[0]) ? 0 : 1
    return aIsMe - bIsMe
  })

  const filtered = search.trim()
    ? sorted.filter(([, g]) => {
        const q = search.toLowerCase()
        return g.name.toLowerCase().includes(q) || (g.email?.toLowerCase().includes(q) ?? false)
      })
    : sorted

  const totalActive = filtered.reduce((sum, [, g]) =>
    sum + g.tasks.filter(t => t.status === 'backlog' || t.status === 'active' || t.status === 'in_progress').length, 0)

  return (
    <div style={s.root}>
      <div style={s.topBar}>
        <div style={s.header}>
          <h1 style={s.heading}>All Tasks</h1>
          <span style={s.headerBadge}>{totalActive} active</span>
        </div>

        {/* Search */}
        <div style={s.searchWrap}>
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" style={s.searchIcon}>
            <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.5"/>
            <path d="M11 11l3.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by name or email..."
            style={s.searchInput}
          />
          {search && (
            <button onClick={() => setSearch('')} style={s.clearBtn}>
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
            </button>
          )}
        </div>
      </div>

      <div style={s.scrollArea}>
        {filtered.length === 0 ? (
          <div style={s.empty}>
            <p style={s.emptyTitle}>{search ? 'No matching members' : 'No tasks yet'}</p>
            <p style={s.emptyText}>{search ? `No members match "${search}"` : 'Tasks created by team members will appear here.'}</p>
          </div>
        ) : (
          <div style={s.groups}>
            {filtered.map(([uid, group]) => (
              <PersonAccordion key={uid} uid={uid} group={group} isMe={myIds.has(uid)} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

const s: Record<string, React.CSSProperties> = {
  // Layout — fixed viewport, scroll inside
  root: { display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, flex: 1 },
  topBar: { flexShrink: 0 },
  scrollArea: { flex: 1, overflowY: 'auto', minHeight: 0, paddingBottom: '32px' },

  header: { display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' },
  heading: { fontSize: '22px', fontWeight: 700, letterSpacing: '-0.03em', color: 'var(--text)' },
  headerBadge: { background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: '100px', padding: '3px 10px', fontSize: '12px', color: 'var(--muted)' },

  searchWrap: {
    display: 'flex', alignItems: 'center', gap: '8px',
    background: 'var(--surface2)', border: '1px solid var(--border)',
    borderRadius: '10px', padding: '8px 12px', marginBottom: '20px',
  },
  searchIcon: { color: 'var(--muted)', flexShrink: 0 },
  searchInput: {
    background: 'transparent', border: 'none', outline: 'none',
    fontSize: '14px', color: 'var(--text)', fontFamily: 'inherit',
    flex: 1, width: '100%',
  },
  clearBtn: {
    background: 'none', border: 'none', color: 'var(--muted)',
    cursor: 'pointer', padding: '2px', display: 'flex',
  },

  groups: { display: 'flex', flexDirection: 'column', gap: '12px' },

  // Person accordion
  person: {
    background: 'var(--surface)', border: '1px solid var(--border)',
    borderRadius: '14px',
  },
  personHeader: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    width: '100%', background: 'none', border: 'none',
    padding: '14px 16px', cursor: 'pointer', fontFamily: 'inherit',
    gap: '10px', flexWrap: 'wrap' as const,
  },
  personLeft: { display: 'flex', alignItems: 'center', gap: '10px' },
  chevron: {
    color: 'var(--muted)', flexShrink: 0,
    transition: 'transform 0.15s',
  },
  avatar: {
    width: '32px', height: '32px', borderRadius: '50%',
    background: 'linear-gradient(135deg, #7c5cfc, #a78bfa)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: '13px', fontWeight: 700, color: 'white', flexShrink: 0,
  },
  personName: { fontSize: '15px', fontWeight: 600, color: 'var(--text)' },
  badges: { display: 'flex', gap: '8px', flexWrap: 'wrap' as const },
  countBadge: {
    fontSize: '12px', fontWeight: 700,
    border: '1px solid', borderRadius: '100px', padding: '3px 10px',
  },
  totalBadge: {
    fontSize: '12px', fontWeight: 700, color: 'var(--accent-light)',
    background: 'rgba(124,92,252,0.15)', border: '1px solid rgba(124,92,252,0.3)',
    borderRadius: '100px', padding: '3px 10px',
  },

  // Expanded sections
  sections: {
    padding: '0 16px 14px',
    display: 'flex', flexDirection: 'column', gap: '8px',
  },

  // Status accordion
  statusSection: {
    background: 'var(--surface2)', border: '1px solid var(--border)',
    borderRadius: '10px',
  },
  statusHeader: {
    display: 'flex', alignItems: 'center', gap: '8px',
    width: '100%', background: 'none', border: 'none',
    padding: '10px 12px', cursor: 'pointer', fontFamily: 'inherit',
  },
  miniChevron: {
    color: 'var(--muted)', flexShrink: 0,
    transition: 'transform 0.15s',
  },
  statusDot: { width: '8px', height: '8px', borderRadius: '50%', flexShrink: 0 },
  statusLabel: { fontSize: '12px', fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: '0.04em' },
  statusCount: {
    fontSize: '11px', fontWeight: 600, color: 'var(--muted)',
    background: 'var(--surface)', borderRadius: '100px',
    padding: '1px 8px', marginLeft: '2px',
  },

  taskList: { padding: '0 10px 10px', display: 'flex', flexDirection: 'column', gap: '6px' },

  empty: { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '16px', padding: '48px 32px', textAlign: 'center' },
  emptyTitle: { fontSize: '16px', fontWeight: 600, color: 'var(--text)', marginBottom: '8px' },
  emptyText: { fontSize: '14px', color: 'var(--muted)' },
}
