'use client'

import { useState, useRef, useEffect } from 'react'
import ChatInput from '@/components/ChatInput'

export type Task = {
  id: string
  title: string
  status: string
  created_at: string
  completed_at?: string | null
  user_id?: string
}

type Props = {
  initialTasks: Record<string, unknown>[]
  workspaceId: string
  workspaceName: string
  userId: string
  slackUserId: string | null
}

const COLUMNS = [
  {
    id: 'active',
    label: 'To Do',
    color: '#94a3b8',
    accent: '#475569',
    glow: 'rgba(100,116,139,0.15)',
    bar: 'linear-gradient(90deg, #64748b, #94a3b8)',
  },
  {
    id: 'in_progress',
    label: 'In Progress',
    color: '#60a5fa',
    accent: '#3b82f6',
    glow: 'rgba(59,130,246,0.15)',
    bar: 'linear-gradient(90deg, #2563eb, #60a5fa)',
  },
  {
    id: 'completed',
    label: 'Done',
    color: '#4ade80',
    accent: '#22c55e',
    glow: 'rgba(34,197,94,0.15)',
    bar: 'linear-gradient(90deg, #16a34a, #4ade80)',
  },
]

export default function DashboardClient({ initialTasks, workspaceId, workspaceName, userId, slackUserId }: Props) {
  const [tasks, setTasks] = useState<Task[]>(initialTasks as unknown as Task[])
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState<string | null>(null)
  const [quickAddCol, setQuickAddCol] = useState<string | null>(null)
  const dragTask = useRef<Task | null>(null)

  const grouped = {
    active:      tasks.filter(t => t.status === 'active'),
    in_progress: tasks.filter(t => t.status === 'in_progress'),
    completed:   tasks.filter(t => t.status === 'completed'),
  } as Record<string, Task[]>

  const archived = tasks.filter(t => t.status === 'archived' || t.status === 'deleted')
  const activeCount = tasks.filter(t => t.status === 'active' || t.status === 'in_progress').length

  async function moveTask(taskId: string, newStatus: string) {
    setTasks(prev => prev.map(t =>
      t.id === taskId
        ? { ...t, status: newStatus, completed_at: newStatus === 'completed' ? new Date().toISOString() : null }
        : t
    ))
    await fetch(`/api/tasks/${taskId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: newStatus }),
    })
  }

  async function updateTitle(taskId: string, title: string) {
    setTasks(prev => prev.map(t => t.id === taskId ? { ...t, title } : t))
    await fetch(`/api/tasks/${taskId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title }),
    })
  }

  function handleTaskCreated(task: Task) {
    setTasks(prev => [task, ...prev])
  }

  async function handleQuickAdd(title: string, status: string) {
    setQuickAddCol(null)
    if (!title.trim()) return
    try {
      const res = await fetch('/api/tasks/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: title.trim(), status }),
      })
      const task = await res.json()
      if (res.ok && task.id) setTasks(prev => [{ ...task, status }, ...prev])
    } catch { /* ignore */ }
  }

  function onDragStart(task: Task) {
    dragTask.current = task
    setDraggingId(task.id)
  }

  function onDragEnd() {
    setDraggingId(null)
    setDragOver(null)
    dragTask.current = null
  }

  function onDrop(colId: string) {
    if (dragTask.current && dragTask.current.status !== colId) {
      moveTask(dragTask.current.id, colId)
    }
    setDragOver(null)
  }

  return (
    <div style={s.root}>
      {/* Page header */}
      <div style={s.header}>
        <div style={s.headerLeft}>
          <h1 style={s.heading}>My Tasks</h1>
          <span style={s.workspaceBadge}>{workspaceName}</span>
        </div>
        {activeCount > 0 && (
          <div style={s.activeCount}>
            <span style={s.activeDot} />
            {activeCount} active
          </div>
        )}
      </div>

      {/* AI Input */}
      <ChatInput
        workspaceId={workspaceId}
        userId={userId}
        slackUserId={slackUserId}
        onTaskCreated={handleTaskCreated}
      />

      {/* Kanban board */}
      <div style={s.board}>
        {COLUMNS.map(col => {
          const colTasks = grouped[col.id] || []
          const isOver = dragOver === col.id
          return (
            <div
              key={col.id}
              style={{
                ...s.column,
                ...(isOver ? { ...s.columnOver, boxShadow: `0 0 0 2px ${col.accent}55, 0 8px 32px rgba(0,0,0,0.4)` } : {}),
              }}
              onDragOver={e => { e.preventDefault(); setDragOver(col.id) }}
              onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(null) }}
              onDrop={() => onDrop(col.id)}
            >
              {/* Column top accent bar */}
              <div style={{ ...s.colBar, background: col.bar }} />

              {/* Column header */}
              <div style={s.colHeader}>
                <div style={s.colHeaderLeft}>
                  <span style={{ ...s.colDot, background: col.accent, boxShadow: `0 0 8px ${col.accent}88` }} />
                  <span style={{ ...s.colLabel, color: col.color }}>{col.label}</span>
                  <span style={{ ...s.colCount, color: col.color, borderColor: `${col.accent}40`, background: `${col.glow}` }}>
                    {colTasks.length}
                  </span>
                </div>
                <button
                  onClick={() => setQuickAddCol(quickAddCol === col.id ? null : col.id)}
                  style={{ ...s.addBtn, color: col.color }}
                  title="Add task"
                >
                  <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
                    <path d="M6.5 1v11M1 6.5h11" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
                  </svg>
                </button>
              </div>

              {/* Cards list */}
              <div style={s.cardsList}>
                {quickAddCol === col.id && (
                  <QuickAddCard
                    accentColor={col.accent}
                    onAdd={title => handleQuickAdd(title, col.id)}
                    onCancel={() => setQuickAddCol(null)}
                  />
                )}

                {colTasks.length === 0 && quickAddCol !== col.id ? (
                  <div
                    style={{ ...s.emptyCol, ...(isOver ? { ...s.emptyColOver, borderColor: col.accent, color: col.color } : {}) }}
                    onClick={() => setQuickAddCol(col.id)}
                  >
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={{ marginBottom: '6px', opacity: 0.4 }}>
                      <path d="M8 1v14M1 8h14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                    </svg>
                    Add a task
                  </div>
                ) : (
                  colTasks.map(task => (
                    <KanbanCard
                      key={task.id}
                      task={task}
                      col={col}
                      isDragging={draggingId === task.id}
                      onDragStart={() => onDragStart(task)}
                      onDragEnd={onDragEnd}
                      onUpdateTitle={t => updateTitle(task.id, t)}
                      onMove={moveTask}
                      columns={COLUMNS}
                    />
                  ))
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* Archived */}
      {archived.length > 0 && <ArchivedSection tasks={archived} />}
    </div>
  )
}

// ─── Quick Add Card ──────────────────────────────────────────────────────────

function QuickAddCard({ onAdd, onCancel, accentColor }: { onAdd: (t: string) => void; onCancel: () => void; accentColor: string }) {
  const [value, setValue] = useState('')
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => { ref.current?.focus() }, [])
  function commit() { if (value.trim()) onAdd(value.trim()); else onCancel() }
  return (
    <div style={{ ...qa.card, borderColor: `${accentColor}50` }} className="fadeSlideIn">
      <input
        ref={ref}
        value={value}
        onChange={e => setValue(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') onCancel() }}
        placeholder="Task name…"
        style={qa.input}
      />
      <div style={qa.actions}>
        <button
          onClick={commit}
          disabled={!value.trim()}
          style={{ ...qa.addBtn, background: accentColor, opacity: value.trim() ? 1 : 0.4 }}
        >
          Add
        </button>
        <button onClick={onCancel} style={qa.cancelBtn}>Esc</button>
      </div>
    </div>
  )
}

// ─── Kanban Card ─────────────────────────────────────────────────────────────

function KanbanCard({ task, col, isDragging, onDragStart, onDragEnd, onUpdateTitle, onMove, columns }: {
  task: Task
  col: typeof COLUMNS[0]
  isDragging: boolean
  onDragStart: () => void
  onDragEnd: () => void
  onUpdateTitle: (t: string) => void
  onMove: (id: string, status: string) => void
  columns: typeof COLUMNS
}) {
  const [editing, setEditing] = useState(false)
  const [localTitle, setLocalTitle] = useState(task.title)
  const [hovered, setHovered] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const isCompleted = task.status === 'completed'
  const date = (isCompleted && task.completed_at)
    ? new Date(task.completed_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    : new Date(task.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

  const otherCols = columns.filter(c => c.id !== task.status)

  function startEdit() { setEditing(true); setTimeout(() => inputRef.current?.focus(), 0) }
  function commitEdit() {
    setEditing(false)
    const t = localTitle.trim()
    if (t && t !== task.title) onUpdateTitle(t)
    else setLocalTitle(task.title)
  }

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => { setHovered(false); setMenuOpen(false) }}
      style={{
        ...c.card,
        ...(isDragging ? c.dragging : {}),
        ...(hovered && !isDragging ? { ...c.hover, borderColor: `${col.accent}40` } : {}),
        borderLeftColor: col.accent,
      }}
    >
      {/* Left accent stripe */}
      <div style={{ ...c.stripe, background: col.bar }} />

      <div style={c.body}>
        {/* Title */}
        {editing ? (
          <input
            ref={inputRef}
            value={localTitle}
            onChange={e => setLocalTitle(e.target.value)}
            onBlur={commitEdit}
            onKeyDown={e => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') { setLocalTitle(task.title); setEditing(false) } }}
            style={c.titleInput}
          />
        ) : (
          <div
            onClick={startEdit}
            style={{
              ...c.title,
              ...(isCompleted ? c.titleDone : {}),
            }}
          >
            {localTitle || '(untitled)'}
          </div>
        )}

        {/* Footer row */}
        <div style={c.footer}>
          {/* Status pill */}
          <span style={{ ...c.statusPill, color: col.color, background: col.glow, borderColor: `${col.accent}30` }}>
            <span style={{ ...c.statusDot, background: col.accent }} />
            {col.label}
          </span>

          <div style={c.footerRight}>
            <span style={c.date}>{date}</span>

            {/* More menu */}
            {hovered && (
              <div style={{ position: 'relative' }}>
                <button onClick={() => setMenuOpen(v => !v)} style={c.moreBtn}>
                  <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
                    <circle cx="6.5" cy="2.5" r="1.2" fill="currentColor"/>
                    <circle cx="6.5" cy="6.5" r="1.2" fill="currentColor"/>
                    <circle cx="6.5" cy="10.5" r="1.2" fill="currentColor"/>
                  </svg>
                </button>
                {menuOpen && (
                  <div style={c.menu}>
                    <div style={c.menuLabel}>Move to</div>
                    {otherCols.map(oc => (
                      <button key={oc.id} onClick={() => { setMenuOpen(false); onMove(task.id, oc.id) }} style={c.menuItem}>
                        <span style={{ ...c.menuDot, background: oc.accent }} />
                        {oc.label}
                      </button>
                    ))}
                    <div style={c.menuDivider} />
                    <button onClick={() => { setMenuOpen(false); onMove(task.id, 'archived') }} style={{ ...c.menuItem, color: 'var(--muted)' }}>
                      Archive
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Archived ────────────────────────────────────────────────────────────────

function ArchivedSection({ tasks }: { tasks: Task[] }) {
  const [open, setOpen] = useState(false)
  return (
    <div style={ar.wrap}>
      <button onClick={() => setOpen(v => !v)} style={ar.toggle}>
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none"
          style={{ transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 0.2s', flexShrink: 0 }}>
          <path d="M3 1l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
        Archived
        <span style={ar.count}>{tasks.length}</span>
      </button>
      {open && (
        <div style={ar.list}>
          {tasks.map(t => (
            <div key={t.id} style={ar.row}>
              <span style={ar.title}>{t.title}</span>
              <span style={ar.date}>{new Date(t.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const s: Record<string, React.CSSProperties> = {
  root: { display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 },

  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' },
  headerLeft: { display: 'flex', alignItems: 'center', gap: '12px' },
  heading: { fontSize: '22px', fontWeight: 700, letterSpacing: '-0.04em', color: 'var(--text)' },
  workspaceBadge: {
    background: 'rgba(124,92,252,0.12)',
    border: '1px solid rgba(124,92,252,0.25)',
    borderRadius: '100px',
    padding: '3px 12px',
    fontSize: '12px',
    color: 'var(--accent-light)',
    fontWeight: 500,
  },
  activeCount: {
    display: 'flex', alignItems: 'center', gap: '6px',
    fontSize: '12px', color: 'var(--muted)',
  },
  activeDot: {
    width: '6px', height: '6px', borderRadius: '50%',
    background: '#4ade80', boxShadow: '0 0 6px #4ade80',
  },

  board: {
    display: 'flex',
    gap: '20px',
    flex: 1,
    overflowX: 'auto',
    overflowY: 'hidden',
    paddingBottom: '12px',
    marginBottom: '20px',
    alignItems: 'flex-start',
  },

  column: {
    display: 'flex',
    flexDirection: 'column',
    width: '340px',
    minWidth: '300px',
    flexShrink: 0,
    background: 'var(--surface)',
    borderRadius: '16px',
    border: '1px solid var(--border)',
    overflow: 'hidden',
    transition: 'border-color 0.2s, box-shadow 0.2s',
    maxHeight: 'calc(100vh - 300px)',
  },
  columnOver: { borderColor: 'rgba(124,92,252,0.5)' },

  colBar: { height: '3px', width: '100%', flexShrink: 0 },

  colHeader: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '14px 16px 12px',
    flexShrink: 0,
  },
  colHeaderLeft: { display: 'flex', alignItems: 'center', gap: '8px' },
  colDot: { width: '9px', height: '9px', borderRadius: '50%', flexShrink: 0 },
  colLabel: { fontSize: '12px', fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase' as const },
  colCount: {
    fontSize: '11px', fontWeight: 600,
    border: '1px solid',
    borderRadius: '100px',
    padding: '1px 8px',
  },
  addBtn: {
    background: 'rgba(255,255,255,0.05)',
    border: '1px solid var(--border)',
    borderRadius: '7px',
    cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    width: '26px', height: '26px', padding: 0,
    transition: 'background 0.15s',
  },

  cardsList: {
    display: 'flex', flexDirection: 'column', gap: '8px',
    padding: '4px 12px 12px',
    overflowY: 'auto', flex: 1,
  },

  emptyCol: {
    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
    border: '1.5px dashed rgba(255,255,255,0.08)',
    borderRadius: '12px',
    padding: '28px 20px',
    fontSize: '12px', color: 'var(--muted)',
    cursor: 'pointer',
    transition: 'all 0.15s',
    minHeight: '80px',
  },
  emptyColOver: { opacity: 1, color: 'inherit' },
}

// Card styles
const c: Record<string, React.CSSProperties> = {
  card: {
    background: 'var(--surface2)',
    borderRadius: '12px',
    border: '1px solid var(--border)',
    borderLeft: '3px solid transparent',
    padding: '0',
    cursor: 'grab',
    display: 'flex',
    transition: 'transform 0.15s, box-shadow 0.2s, border-color 0.15s, background 0.15s',
    userSelect: 'none' as const,
    overflow: 'hidden',
    animation: 'popIn 0.2s ease',
  },
  dragging: { opacity: 0.35, transform: 'scale(0.97) rotate(-1deg)', cursor: 'grabbing' },
  hover: {
    background: 'var(--surface3)',
    boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
    transform: 'translateY(-2px)',
  },
  stripe: { width: '3px', flexShrink: 0 },
  body: { flex: 1, padding: '12px 12px 10px', display: 'flex', flexDirection: 'column', gap: '10px', minWidth: 0 },

  title: {
    fontSize: '14px', fontWeight: 500, color: 'var(--text)',
    lineHeight: 1.45, cursor: 'text', wordBreak: 'break-word' as const,
  },
  titleDone: { textDecoration: 'line-through', color: 'var(--muted)', opacity: 0.7 },
  titleInput: {
    width: '100%', background: 'transparent', border: 'none',
    borderBottom: '1.5px solid var(--accent)', outline: 'none',
    fontSize: '14px', fontWeight: 500, color: 'var(--text)',
    fontFamily: 'inherit', padding: '0 0 2px', lineHeight: 1.45,
  },

  footer: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '6px' },
  footerRight: { display: 'flex', alignItems: 'center', gap: '6px' },
  date: { fontSize: '11px', color: 'var(--muted)', whiteSpace: 'nowrap' as const },

  statusPill: {
    display: 'inline-flex', alignItems: 'center', gap: '5px',
    fontSize: '11px', fontWeight: 500,
    border: '1px solid',
    borderRadius: '100px', padding: '2px 8px',
    whiteSpace: 'nowrap' as const,
  },
  statusDot: { width: '5px', height: '5px', borderRadius: '50%', flexShrink: 0 },

  moreBtn: {
    background: 'rgba(255,255,255,0.06)', border: '1px solid var(--border)',
    borderRadius: '6px', color: 'var(--muted)',
    cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
    width: '24px', height: '24px', padding: 0,
  },
  menu: {
    position: 'absolute' as const, right: 0, bottom: '28px',
    background: 'var(--surface)', border: '1px solid var(--border2)',
    borderRadius: '12px', padding: '6px',
    zIndex: 200, minWidth: '148px',
    boxShadow: '0 12px 32px rgba(0,0,0,0.5)',
    animation: 'popIn 0.15s ease',
  },
  menuLabel: {
    fontSize: '10px', fontWeight: 700, color: 'var(--muted)',
    textTransform: 'uppercase' as const, letterSpacing: '0.08em',
    padding: '4px 8px 6px',
  },
  menuItem: {
    display: 'flex', alignItems: 'center', gap: '8px',
    width: '100%', background: 'none', border: 'none',
    color: 'var(--text2)', fontSize: '13px',
    padding: '7px 10px', cursor: 'pointer',
    textAlign: 'left' as const, borderRadius: '7px',
    fontFamily: 'inherit',
  },
  menuDot: { width: '7px', height: '7px', borderRadius: '50%', flexShrink: 0 },
  menuDivider: { height: '1px', background: 'var(--border)', margin: '4px 2px' },
}

// Quick add styles
const qa: Record<string, React.CSSProperties> = {
  card: {
    background: 'var(--surface3)',
    border: '1.5px solid',
    borderRadius: '12px', padding: '11px 12px',
    display: 'flex', flexDirection: 'column', gap: '10px',
    boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
    animation: 'popIn 0.15s ease',
  },
  input: {
    background: 'transparent', border: 'none', outline: 'none',
    fontSize: '14px', color: 'var(--text)', fontFamily: 'inherit',
    width: '100%', fontWeight: 500, lineHeight: 1.4,
  },
  actions: { display: 'flex', alignItems: 'center', gap: '6px' },
  addBtn: {
    color: 'white', border: 'none', borderRadius: '7px',
    padding: '5px 14px', fontSize: '12px', fontWeight: 600,
    cursor: 'pointer', fontFamily: 'inherit',
    transition: 'opacity 0.15s',
  },
  cancelBtn: {
    background: 'none', border: '1px solid var(--border2)',
    borderRadius: '7px', padding: '5px 10px',
    fontSize: '11px', color: 'var(--muted)',
    cursor: 'pointer', fontFamily: 'inherit',
  },
}

// Archived styles
const ar: Record<string, React.CSSProperties> = {
  wrap: { borderTop: '1px solid var(--border)', paddingTop: '16px', marginTop: '4px' },
  toggle: {
    display: 'flex', alignItems: 'center', gap: '8px',
    background: 'none', border: 'none', color: 'var(--muted)',
    fontSize: '11px', fontWeight: 700, cursor: 'pointer',
    padding: '4px 0', fontFamily: 'inherit',
    textTransform: 'uppercase' as const, letterSpacing: '0.07em',
  },
  count: {
    fontSize: '10px', color: 'var(--muted)',
    background: 'var(--surface2)', border: '1px solid var(--border)',
    borderRadius: '100px', padding: '1px 7px',
  },
  list: { display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '10px' },
  row: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '9px 14px', background: 'var(--surface)',
    border: '1px solid var(--border)', borderRadius: '8px', opacity: 0.45,
  },
  title: { fontSize: '13px', color: 'var(--muted)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const },
  date: { fontSize: '11px', color: 'var(--muted)', flexShrink: 0 },
}
