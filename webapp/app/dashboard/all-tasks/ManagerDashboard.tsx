'use client'

import { useEffect, useMemo, useRef, useState } from 'react'

export interface ManagerTask {
  id: string
  title: string
  status: string // backlog | active | in_progress | completed
  priority?: string | null // high | medium | low | null
  due_date?: string | null // ISO
  user_id: string
  status_changed_at?: string | null
  created_at?: string | null
}

export interface ManagerPerson {
  user_id: string
  name: string
  email: string
  team: string | null
}

interface Props {
  tasks: ManagerTask[]
  people: ManagerPerson[]
}

const TEAMS = ['Product', 'Engineering', 'Sales', 'Marketing', 'Content', 'Customer Support'] as const

const STATUS_META: Record<string, { label: string; bg: string; fg: string; dot: string }> = {
  backlog:     { label: 'Inbox',       bg: 'rgba(245,158,11,0.12)', fg: '#f59e0b', dot: '#d97706' },
  active:      { label: 'To Do',       bg: 'rgba(148,163,184,0.16)', fg: '#cbd5e1', dot: '#64748b' },
  in_progress: { label: 'In Progress', bg: 'rgba(96,165,250,0.14)',  fg: '#60a5fa', dot: '#3b82f6' },
  completed:   { label: 'Done',        bg: 'rgba(74,222,128,0.14)',  fg: '#4ade80', dot: '#22c55e' },
}

const STATUS_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'active', label: 'To Do' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'completed', label: 'Done' },
  { value: 'backlog', label: 'Inbox' },
]

const PRIORITY_RANK: Record<string, number> = { high: 0, medium: 1, low: 2 }

function daysSince(iso: string | null | undefined, now: number): number | null {
  if (!iso) return null
  const then = new Date(iso).getTime()
  if (isNaN(then)) return null
  const diff = now - then
  return Math.max(0, Math.floor(diff / (1000 * 60 * 60 * 24)))
}

function formatDueDate(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  return d.toLocaleDateString('en-US', { day: 'numeric', month: 'short' })
}

function initialsOf(name: string): string {
  const s = (name || '?').trim()
  const parts = s.split(/\s+/).filter(Boolean)
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
  return s.slice(0, 2).toUpperCase()
}

export default function ManagerDashboard({ tasks, people }: Props) {
  // Empty set = no filter (show all). Non-empty = show only selected values.
  const [teamFilter, setTeamFilter] = useState<Set<string>>(new Set())
  const [personFilter, setPersonFilter] = useState<Set<string>>(new Set())
  const [statusFilter, setStatusFilter] = useState<Set<string>>(new Set())
  const [sort, setSort] = useState<'pending' | 'priority' | 'due'>('pending')
  const [search, setSearch] = useState<string>('')

  // Anchor "now" on mount so pending-since values are stable across re-renders.
  // Refresh once per minute so a long-open tab doesn't go stale.
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 60_000)
    return () => clearInterval(id)
  }, [])
  // eslint-disable-next-line react-hooks/purity, react-hooks/exhaustive-deps
  const now = useMemo(() => Date.now(), [tick])

  const personByUserId = useMemo(() => {
    const m = new Map<string, ManagerPerson>()
    for (const p of people) m.set(p.user_id, p)
    return m
  }, [people])

  // Summary counts (on full tasks, not filtered)
  const summary = useMemo(() => {
    let total = 0, inProgress = 0, done = 0, delayed = 0
    for (const t of tasks) {
      total++
      if (t.status === 'in_progress') inProgress++
      if (t.status === 'completed') done++
      if (t.status !== 'completed') {
        const d = daysSince(t.status_changed_at || t.created_at, now)
        if (d !== null && d > 5) delayed++
      }
    }
    return { total, inProgress, done, delayed }
  }, [tasks, now])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    const list = tasks.filter(t => {
      const p = personByUserId.get(t.user_id)
      if (teamFilter.size > 0) {
        const pt = p?.team || ''
        if (!teamFilter.has(pt)) return false
      }
      if (personFilter.size > 0 && !personFilter.has(t.user_id)) return false
      if (statusFilter.size > 0 && !statusFilter.has(t.status)) return false
      if (q) {
        const haystack = `${t.title} ${p?.name || ''}`.toLowerCase()
        if (!haystack.includes(q)) return false
      }
      return true
    })

    const sorted = list.slice()
    if (sort === 'pending') {
      // Descending days (oldest first). Completed sinks.
      sorted.sort((a, b) => {
        const aDone = a.status === 'completed' ? 1 : 0
        const bDone = b.status === 'completed' ? 1 : 0
        if (aDone !== bDone) return aDone - bDone
        const da = daysSince(a.status_changed_at || a.created_at, now) ?? -1
        const db = daysSince(b.status_changed_at || b.created_at, now) ?? -1
        return db - da
      })
    } else if (sort === 'priority') {
      sorted.sort((a, b) => {
        const ra = PRIORITY_RANK[(a.priority || '').toLowerCase()] ?? 99
        const rb = PRIORITY_RANK[(b.priority || '').toLowerCase()] ?? 99
        return ra - rb
      })
    } else if (sort === 'due') {
      // Ascending due date; null dates sink. Overdue rises (naturally via earlier date).
      sorted.sort((a, b) => {
        const ta = a.due_date ? new Date(a.due_date).getTime() : Infinity
        const tb = b.due_date ? new Date(b.due_date).getTime() : Infinity
        return ta - tb
      })
    }
    return sorted
  }, [tasks, personByUserId, teamFilter, personFilter, statusFilter, sort, search, now])

  const hasFilter = teamFilter.size > 0 || personFilter.size > 0 || statusFilter.size > 0 || sort !== 'pending' || search.trim().length > 0
  function clearFilters() {
    setTeamFilter(new Set()); setPersonFilter(new Set()); setStatusFilter(new Set()); setSort('pending'); setSearch('')
  }

  const sortedPeople = useMemo(() => people.slice().sort((a, b) => a.name.localeCompare(b.name)), [people])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', minHeight: 0, flex: 1 }}>
      {/* Title */}
      <div>
        <h1 style={{ fontSize: '22px', fontWeight: 700, color: 'var(--text)', letterSpacing: '-0.02em' }}>All Tasks</h1>
        <div style={{ fontSize: '13px', color: 'var(--muted)', marginTop: '4px' }}>
          Workspace-wide view for managers. Filter by team, person, or status.
        </div>
      </div>

      {/* Summary cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0,1fr))', gap: '12px' }}>
        <SummaryCard label="Total Tasks" value={summary.total} tone="neutral" />
        <SummaryCard label="In Progress" value={summary.inProgress} tone="progress" />
        <SummaryCard label="Done" value={summary.done} tone="done" />
        <SummaryCard label="Delayed 5+ days" value={summary.delayed} tone="warn" />
      </div>

      {/* Filter bar */}
      <div style={styles.filterBar}>
        <MultiSelect
          label="Team"
          placeholder="All teams"
          options={TEAMS.map(t => ({ value: t, label: t }))}
          selected={teamFilter}
          onChange={setTeamFilter}
        />
        <MultiSelect
          label="Person"
          placeholder="All people"
          options={sortedPeople.map(p => ({ value: p.user_id, label: p.name }))}
          selected={personFilter}
          onChange={setPersonFilter}
        />
        <MultiSelect
          label="Status"
          placeholder="All statuses"
          options={STATUS_OPTIONS}
          selected={statusFilter}
          onChange={setStatusFilter}
        />
        <Select label="Sort" value={sort} onChange={(v) => setSort(v as 'pending' | 'priority' | 'due')}>
          <option value="pending">Pending since</option>
          <option value="priority">Priority</option>
          <option value="due">Due date</option>
        </Select>

        <input
          type="text"
          placeholder="Search task or person…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={styles.searchInput}
        />

        {hasFilter && (
          <button type="button" onClick={clearFilters} style={styles.clearBtn}>Clear</button>
        )}
      </div>

      {/* Table */}
      <div style={{ flex: 1, overflow: 'auto', border: '1px solid var(--border)', borderRadius: '12px', background: 'var(--surface)' }}>
        <table style={styles.table}>
          <thead>
            <tr>
              <Th>Person</Th>
              <Th>Team</Th>
              <Th>Task</Th>
              <Th>Priority</Th>
              <Th>Due</Th>
              <Th>Status</Th>
              <Th>Pending</Th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={7} style={{ padding: '48px 20px', textAlign: 'center', color: 'var(--muted)', fontSize: '13px' }}>
                  No tasks match these filters.
                </td>
              </tr>
            ) : (
              filtered.map(t => {
                const p = personByUserId.get(t.user_id)
                const name = p?.name || t.user_id
                const pending = daysSince(t.status_changed_at || t.created_at, now)
                const isOverdue = !!t.due_date && t.status !== 'completed' && new Date(t.due_date).getTime() < now
                return (
                  <tr key={t.id} style={styles.row}>
                    <Td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <div style={styles.avatar}>{initialsOf(name)}</div>
                        <span>{name}</span>
                      </div>
                    </Td>
                    <Td>
                      {p?.team
                        ? <span style={{ color: 'var(--text2)' }}>{p.team}</span>
                        : <span style={{ color: 'var(--muted)', fontStyle: 'italic' }}>NA</span>}
                    </Td>
                    <Td>
                      <div style={styles.taskTitle} title={t.title}>{t.title}</div>
                    </Td>
                    <Td>
                      {t.priority ? <PriorityBadge value={t.priority} /> : <span style={{ color: 'var(--muted)' }}>—</span>}
                    </Td>
                    <Td>
                      {t.due_date
                        ? <span style={{ color: isOverdue ? '#f87171' : 'var(--text2)' }}>{formatDueDate(t.due_date)}</span>
                        : <span style={{ color: 'var(--muted)' }}>—</span>}
                    </Td>
                    <Td>
                      <StatusPill statusKey={t.status} />
                    </Td>
                    <Td>
                      {t.status === 'completed' || pending === null
                        ? <span style={{ color: 'var(--muted)' }}>—</span>
                        : <span style={{ color: pending > 5 ? '#f59e0b' : 'var(--text2)' }}>{pending}d</span>}
                    </Td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ─── sub-components ─────────────────────────────────────────────────────────

function MultiSelect({
  label,
  placeholder,
  options,
  selected,
  onChange,
}: {
  label: string
  placeholder: string
  options: Array<{ value: string; label: string }>
  selected: Set<string>
  onChange: (next: Set<string>) => void
}) {
  const [open, setOpen] = useState(false)
  const anchorRef = useRef<HTMLDivElement>(null)

  // Close on outside click
  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) {
      if (!anchorRef.current?.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  function toggle(value: string) {
    const next = new Set(selected)
    if (next.has(value)) next.delete(value)
    else next.add(value)
    onChange(next)
  }

  function selectAll() { onChange(new Set(options.map(o => o.value))) }
  function clearAll() { onChange(new Set()) }

  const labelText = selected.size === 0
    ? placeholder
    : selected.size === 1
      ? options.find(o => selected.has(o.value))?.label || placeholder
      : `${selected.size} selected`

  return (
    <div ref={anchorRef} style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: '4px', minWidth: '160px' }}>
      <span style={{ fontSize: '10px', fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</span>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        style={{
          ...styles.select,
          textAlign: 'left',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '8px',
          color: selected.size === 0 ? 'var(--muted)' : 'var(--text)',
          minWidth: '160px',
        }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{labelText}</span>
        <svg width="10" height="10" viewBox="0 0 10 10" style={{ flexShrink: 0, opacity: 0.6, transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }}>
          <path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div style={styles.dropdownPanel}>
          <div style={{ display: 'flex', gap: '10px', padding: '8px 10px', borderBottom: '1px solid var(--border)' }}>
            <button type="button" onClick={selectAll} style={styles.dropdownActionBtn}>Select all</button>
            <button type="button" onClick={clearAll} style={styles.dropdownActionBtn}>Clear</button>
          </div>
          <div style={{ maxHeight: '260px', overflowY: 'auto', padding: '4px 0' }}>
            {options.length === 0 ? (
              <div style={{ padding: '10px 12px', fontSize: '12px', color: 'var(--muted)' }}>No options</div>
            ) : (
              options.map(opt => {
                const checked = selected.has(opt.value)
                return (
                  <label
                    key={opt.value}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '10px',
                      padding: '8px 12px',
                      cursor: 'pointer',
                      fontSize: '13px',
                      color: 'var(--text)',
                      userSelect: 'none',
                    }}
                    onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface2)')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggle(opt.value)}
                      style={{ width: '15px', height: '15px', accentColor: 'var(--accent)', cursor: 'pointer' }}
                    />
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{opt.label}</span>
                  </label>
                )
              })
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function SummaryCard({ label, value, tone }: { label: string; value: number; tone: 'neutral' | 'progress' | 'done' | 'warn' }) {
  const toneStyles: Record<typeof tone, { border: string; glow: string; fg: string }> = {
    neutral:  { border: 'var(--border)',       glow: 'transparent',        fg: 'var(--text)' },
    progress: { border: 'rgba(96,165,250,0.3)',  glow: 'rgba(96,165,250,0.08)', fg: '#60a5fa' },
    done:     { border: 'rgba(74,222,128,0.3)',  glow: 'rgba(74,222,128,0.08)', fg: '#4ade80' },
    warn:     { border: 'rgba(245,158,11,0.35)', glow: 'rgba(245,158,11,0.1)',  fg: '#f59e0b' },
  }
  const tt = toneStyles[tone]
  return (
    <div style={{
      padding: '16px 18px',
      borderRadius: '12px',
      border: `1px solid ${tt.border}`,
      background: `linear-gradient(180deg, ${tt.glow}, transparent), var(--surface)`,
    }}>
      <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
      <div style={{ fontSize: '26px', fontWeight: 700, color: tt.fg, marginTop: '6px', letterSpacing: '-0.02em' }}>{value}</div>
    </div>
  )
}

function Select({ label, value, onChange, children }: { label: string; value: string; onChange: (v: string) => void; children: React.ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', minWidth: '140px' }}>
      <span style={{ fontSize: '10px', fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</span>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        style={styles.select}
      >
        {children}
      </select>
    </label>
  )
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th style={styles.th}>{children}</th>
  )
}

function Td({ children }: { children: React.ReactNode }) {
  return <td style={styles.td}>{children}</td>
}

function PriorityBadge({ value }: { value: string }) {
  const v = value.toLowerCase()
  const colors = v === 'high'
    ? { bg: 'rgba(248,113,113,0.14)', fg: '#f87171' }
    : v === 'medium'
      ? { bg: 'rgba(245,158,11,0.14)', fg: '#f59e0b' }
      : { bg: 'rgba(148,163,184,0.16)', fg: '#cbd5e1' }
  return (
    <span style={{
      display: 'inline-block',
      padding: '2px 8px',
      borderRadius: '6px',
      fontSize: '11px',
      fontWeight: 600,
      background: colors.bg,
      color: colors.fg,
      textTransform: 'capitalize',
    }}>{v}</span>
  )
}

function StatusPill({ statusKey }: { statusKey: string }) {
  const meta = STATUS_META[statusKey] || STATUS_META.active
  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: '6px',
      padding: '3px 9px',
      borderRadius: '6px',
      fontSize: '11px',
      fontWeight: 600,
      background: meta.bg,
      color: meta.fg,
    }}>
      <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: meta.dot }} />
      {meta.label}
    </span>
  )
}

// ─── styles ─────────────────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  filterBar: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '12px',
    alignItems: 'flex-end',
    padding: '14px 16px',
    background: 'var(--surface)',
    border: '1px solid var(--border)',
    borderRadius: '12px',
  },
  select: {
    padding: '8px 10px',
    background: 'var(--surface2)',
    border: '1px solid var(--border)',
    borderRadius: '8px',
    color: 'var(--text)',
    fontSize: '13px',
    fontFamily: 'inherit',
    cursor: 'pointer',
    outline: 'none',
    minWidth: '140px',
  },
  searchInput: {
    flex: '1 1 220px',
    minWidth: '180px',
    padding: '8px 12px',
    background: 'var(--surface2)',
    border: '1px solid var(--border)',
    borderRadius: '8px',
    color: 'var(--text)',
    fontSize: '13px',
    fontFamily: 'inherit',
    outline: 'none',
    alignSelf: 'stretch',
    marginTop: 'auto',
  },
  clearBtn: {
    padding: '8px 12px',
    background: 'transparent',
    border: '1px solid var(--border)',
    borderRadius: '8px',
    color: 'var(--accent-light)',
    fontSize: '12px',
    fontWeight: 500,
    cursor: 'pointer',
    fontFamily: 'inherit',
    alignSelf: 'stretch',
    marginTop: 'auto',
  },
  dropdownPanel: {
    position: 'absolute',
    top: 'calc(100% + 4px)',
    left: 0,
    right: 0,
    minWidth: '200px',
    background: 'var(--surface)',
    border: '1px solid var(--border2)',
    borderRadius: '10px',
    boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
    zIndex: 20,
    animation: 'popIn 0.15s ease',
  },
  dropdownActionBtn: {
    background: 'transparent',
    border: 'none',
    padding: '4px 6px',
    fontSize: '11px',
    fontWeight: 600,
    color: 'var(--accent-light)',
    cursor: 'pointer',
    fontFamily: 'inherit',
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: '13px',
  },
  th: {
    position: 'sticky',
    top: 0,
    background: 'var(--surface)',
    textAlign: 'left',
    fontSize: '11px',
    fontWeight: 600,
    color: 'var(--muted)',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    padding: '10px 14px',
    borderBottom: '1px solid var(--border)',
    zIndex: 1,
  },
  row: {
    borderBottom: '1px solid var(--border)',
  },
  td: {
    padding: '10px 14px',
    color: 'var(--text)',
    verticalAlign: 'middle',
  },
  avatar: {
    width: '26px',
    height: '26px',
    borderRadius: '50%',
    background: 'linear-gradient(135deg, #7c5cfc, #a78bfa)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '11px',
    fontWeight: 700,
    color: 'white',
    flexShrink: 0,
  },
  taskTitle: {
    maxWidth: '360px',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    color: 'var(--text)',
  },
}
