'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase-browser'

export type Task = {
  id: string
  title: string
  status: string
  created_at: string
  completed_at?: string | null
  user_id?: string
  priority?: string | null
  due_date?: string | null
  assigned_by?: string | null
  position?: number | null
}

type TaskUpdate = {
  id: string
  content: string
  created_at: string
  user_name: string
}

type Props = {
  initialTasks: Record<string, unknown>[]
  workspaceId: string
  workspaceName: string
  userId: string
  slackUserId: string | null
  delegationLabels: { with_tech: string; with_design: string }
}

type KanbanColumn = {
  id: string
  label: string
  color: string
  accent: string
  glow: string
  bar: string
}

const CORE_COLUMNS: KanbanColumn[] = [
  { id: 'backlog',     label: 'Inbox',       color: '#6B7280', accent: '#4B5563', glow: 'rgba(107,114,128,0.10)', bar: 'linear-gradient(90deg,#4B5563,#9CA3AF)' },
  { id: 'active',      label: 'To Do',       color: '#4F46E5', accent: '#3730A3', glow: 'rgba(79,70,229,0.10)',   bar: 'linear-gradient(90deg,#3730A3,#6366F1)' },
  { id: 'in_progress', label: 'In Progress', color: '#D97706', accent: '#B45309', glow: 'rgba(217,119,6,0.10)',   bar: 'linear-gradient(90deg,#B45309,#F59E0B)' },
]

const DELEGATION_IDS = ['with_tech', 'with_design'] as const
type DelegationId = typeof DELEGATION_IDS[number]

function ThemeToggle() {
  // Read directly from DOM — avoids stale closure and hydration mismatch
  const [dark, setDark] = useState(false)

  useEffect(() => {
    // Sync state with whatever the inline script set before hydration
    const current = document.documentElement.getAttribute('data-theme') === 'dark'
    setDark(current)
  }, [])

  function toggle() {
    // Read live DOM state, not stale closure
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark'
    if (isDark) {
      document.documentElement.removeAttribute('data-theme')
      try { localStorage.setItem('theme', 'light') } catch (_) {}
      setDark(false)
    } else {
      document.documentElement.setAttribute('data-theme', 'dark')
      try { localStorage.setItem('theme', 'dark') } catch (_) {}
      setDark(true)
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      title={dark ? 'Switch to light mode' : 'Switch to dark mode'}
      style={{
        display: 'flex', alignItems: 'center', gap: '7px',
        background: 'var(--surface2)', border: '1px solid var(--border2)',
        borderRadius: '20px', padding: '5px 12px 5px 8px',
        cursor: 'pointer', color: 'var(--text2)',
        fontSize: '12px', fontWeight: 500, fontFamily: 'inherit',
        transition: 'background 0.2s, border-color 0.2s',
        flexShrink: 0,
      }}
    >
      {dark ? (
        /* Sun — shown in dark mode, click to go light */
        <svg width="15" height="15" viewBox="0 0 20 20" fill="none">
          <circle cx="10" cy="10" r="4" stroke="currentColor" strokeWidth="1.6"/>
          <path d="M10 2v2M10 16v2M2 10h2M16 10h2M4.22 4.22l1.42 1.42M14.36 14.36l1.42 1.42M14.36 5.64l1.42-1.42M4.22 15.78l1.42-1.42" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
        </svg>
      ) : (
        /* Moon — shown in light mode, click to go dark */
        <svg width="14" height="14" viewBox="0 0 20 20" fill="none">
          <path d="M17.5 12.5A7.5 7.5 0 017.5 2.5a7.5 7.5 0 100 15 7.5 7.5 0 0010-5z" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      )}
      {dark ? 'Light' : 'Dark'}
    </button>
  )
}

export default function DashboardClient({ initialTasks, workspaceId, workspaceName, userId, slackUserId, delegationLabels }: Props) {
  const [tasks, setTasks] = useState<Task[]>(initialTasks as unknown as Task[])
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState<string | null>(null)
  const [dragOverTaskId, setDragOverTaskId] = useState<string | null>(null)
  const [quickAddCol, setQuickAddCol] = useState<string | null>(null)
  const [detailTask, setDetailTask] = useState<Task | null>(null)
  const [showSlackToast, setShowSlackToast] = useState(false)
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set())
  const [flashField, setFlashField] = useState<string | null>(null)
  const [dragOverHalf, setDragOverHalf] = useState<'top' | 'bottom'>('bottom')
  const [justDroppedId, setJustDroppedId] = useState<string | null>(null)
  const [localDelegationLabels, setLocalDelegationLabels] = useState(delegationLabels)
  const [renamingColId, setRenamingColId] = useState<DelegationId | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [hoveredColId, setHoveredColId] = useState<string | null>(null)
  const dragTask = useRef<Task | null>(null)
  const dragOverHalfRef = useRef<'top' | 'bottom'>('bottom')
  const reorderCooldown = useRef(false)
  const searchParams = useSearchParams()

  // Build columns including delegation columns with workspace-editable labels
  const COLUMNS: KanbanColumn[] = [
    ...CORE_COLUMNS,
    { id: 'with_tech',   label: localDelegationLabels.with_tech,   color: '#4F46E5', accent: '#3730A3', glow: 'rgba(79,70,229,0.10)',  bar: 'linear-gradient(90deg,#3730A3,#6366F1)' },
    { id: 'with_design', label: localDelegationLabels.with_design,  color: '#7C3AED', accent: '#6D28D9', glow: 'rgba(124,58,237,0.10)', bar: 'linear-gradient(90deg,#6D28D9,#A78BFA)' },
    { id: 'completed',   label: 'Done',                             color: '#059669', accent: '#047857', glow: 'rgba(5,150,105,0.10)',  bar: 'linear-gradient(90deg,#047857,#10B981)' },
  ]

  async function saveRename(colId: DelegationId) {
    const trimmed = renameValue.trim()
    setRenamingColId(null)
    if (!trimmed || trimmed === localDelegationLabels[colId]) return
    // Optimistic update
    setLocalDelegationLabels(prev => ({ ...prev, [colId]: trimmed }))
    const bodyKey = colId === 'with_tech' ? 'tech_label' : 'design_label'
    await fetch('/api/workspace/labels', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [bodyKey]: trimmed }),
    })
  }

  useEffect(() => {
    if (searchParams.get('slack_connected') === 'true') {
      setShowSlackToast(true)
      window.history.replaceState({}, '', '/dashboard')
      setTimeout(() => setShowSlackToast(false), 5000)
    }
  }, [searchParams])

  // Listen for chatbot task changes and re-fetch tasks
  useEffect(() => {
    const handleTasksChanged = async () => {
      try {
        const res = await fetch('/api/tasks')
        if (res.ok) {
          const freshTasks = await res.json()
          setTasks(freshTasks as Task[])
        }
      } catch (e) {
        console.error('Failed to refresh tasks:', e)
      }
    }
    window.addEventListener('tasks-changed', handleTasksChanged)
    return () => window.removeEventListener('tasks-changed', handleTasksChanged)
  }, [])

  // Supabase Realtime: auto-refresh when tasks change in DB (e.g. from Slack bot)
  // Skip during reorder cooldown to avoid overwriting optimistic state
  useEffect(() => {
    const supabase = createClient()
    const channel = supabase
      .channel('tasks-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, () => {
        if (!reorderCooldown.current) {
          window.dispatchEvent(new Event('tasks-changed'))
        }
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [])

  // Refresh tasks when tab becomes visible (safety net for dropped WebSocket)
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        window.dispatchEvent(new Event('tasks-changed'))
      }
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [])

  const sortByPos = (a: Task, b: Task) => (a.position ?? Infinity) - (b.position ?? Infinity)
  const grouped = COLUMNS.reduce<Record<string, Task[]>>((acc, col) => {
    acc[col.id] = tasks.filter(t => t.status === col.id).sort(sortByPos)
    return acc
  }, {})

  const activeCount = tasks.filter(t => t.status !== 'completed').length

  async function deleteTask(taskId: string) {
    // Animate fade-out, then remove after animation completes
    setDeletingIds(prev => new Set(prev).add(taskId))
    fetch(`/api/tasks/${taskId}`, { method: 'DELETE' })
    setTimeout(() => {
      setTasks(prev => prev.filter(t => t.id !== taskId))
      setDeletingIds(prev => { const next = new Set(prev); next.delete(taskId); return next })
    }, 350)
  }

  async function moveTask(taskId: string, newStatus: string) {
    // Bump to position -1 so it sorts to the top of the destination column
    setTasks(prev => {
      const task = prev.find(t => t.id === taskId)
      if (!task) return prev
      const updated = {
        ...task,
        status: newStatus,
        position: -1,
        completed_at: newStatus === 'completed' ? new Date().toISOString() : null,
      }
      return [updated, ...prev.filter(t => t.id !== taskId)]
    })
    // Flash the card when it lands
    setJustDroppedId(taskId)
    setTimeout(() => setJustDroppedId(null), 700)
    // Suppress realtime echo so the fresh fetch doesn't undo the position
    reorderCooldown.current = true
    setTimeout(() => { reorderCooldown.current = false }, 2500)
    await fetch(`/api/tasks/${taskId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: newStatus, position: -1 }),
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
        body: JSON.stringify({ title: title.trim(), status, priority: 'low' }),
      })
      const task = await res.json()
      if (res.ok && task.id) setTasks(prev => [{ ...task, status }, ...prev])
    } catch { /* ignore */ }
  }

  async function updateTaskField(taskId: string, field: string, value: string | null) {
    setTasks(prev => prev.map(t => t.id === taskId ? { ...t, [field]: value } : t))
    if (detailTask?.id === taskId) setDetailTask(prev => prev ? { ...prev, [field]: value } : prev)
    // Flash the field in modal to confirm change
    setFlashField(field)
    setTimeout(() => setFlashField(null), 500)
    // Suppress the realtime echo from our own PATCH so it doesn't re-sort the list
    reorderCooldown.current = true
    setTimeout(() => { reorderCooldown.current = false }, 2000)
    await fetch(`/api/tasks/${taskId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [field]: value }),
    })
  }

  function onDragStart(task: Task) {
    dragTask.current = task
    setDraggingId(task.id)
  }

  function onDragEnd() {
    setDraggingId(null)
    setDragOver(null)
    setDragOverTaskId(null)
    dragTask.current = null
  }

  function onCardDragOver(e: React.DragEvent, taskId: string) {
    e.preventDefault()
    e.stopPropagation()
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const midY = rect.top + rect.height / 2
    const half = e.clientY < midY ? 'top' : 'bottom'
    dragOverHalfRef.current = half
    setDragOverHalf(half)
    setDragOverTaskId(taskId)
  }

  function onDrop(colId: string) {
    const dragged = dragTask.current
    if (!dragged) { onDragEnd(); return }

    const sameColumn = dragged.status === colId
    if (sameColumn && dragOverTaskId && dragOverTaskId !== dragged.id) {
      // Reorder within column
      const colTasks = [...(grouped[colId] || [])]
      const fromIndex = colTasks.findIndex(t => t.id === dragged.id)
      const overIndex = colTasks.findIndex(t => t.id === dragOverTaskId)
      if (fromIndex === -1 || overIndex === -1) { onDragEnd(); return }

      // Remove the dragged item first
      const [moved] = colTasks.splice(fromIndex, 1)

      // Calculate insert position: if dropping on bottom half, insert after target
      const targetIndex = colTasks.findIndex(t => t.id === dragOverTaskId)
      const insertAt = dragOverHalfRef.current === 'bottom' ? targetIndex + 1 : targetIndex
      colTasks.splice(insertAt, 0, moved)

      // Update positions in local state
      const updatedIds = colTasks.map(t => t.id)
      const positionMap = Object.fromEntries(updatedIds.map((id, i) => [id, i]))
      setTasks(prev => prev.map(t => positionMap[t.id] !== undefined ? { ...t, position: positionMap[t.id] } : t))

      // Flash the dropped card briefly
      setJustDroppedId(dragged.id)
      setTimeout(() => setJustDroppedId(null), 600)

      // Suppress realtime refreshes while backend catches up
      reorderCooldown.current = true
      setTimeout(() => { reorderCooldown.current = false }, 2000)

      // Persist to backend
      fetch('/api/tasks/reorder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderedIds: updatedIds }),
      })
    } else if (!sameColumn) {
      // Move to different column (existing behavior)
      moveTask(dragged.id, colId)
      setJustDroppedId(dragged.id)
      setTimeout(() => setJustDroppedId(null), 600)
    }

    setDraggingId(null)
    setDragOver(null)
    setDragOverTaskId(null)
    dragTask.current = null
  }

  return (
    <div style={s.root}>
      {/* Slack connected toast */}
      {showSlackToast && (
        <div style={s.toast}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0 }}>
            <circle cx="8" cy="8" r="7" fill="#10B981" opacity="0.15"/>
            <path d="M5 8.5L7 10.5L11 5.5" stroke="#059669" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          Slack connected successfully! Your team members will sync automatically.
          <button onClick={() => setShowSlackToast(false)} style={s.toastClose}>
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
          </button>
        </div>
      )}

      {/* Page header */}
      <div style={s.header}>
        <div style={s.headerLeft}>
          <h1 style={s.heading}>My Tasks</h1>
          <span style={s.workspaceBadge}>{workspaceName}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          {activeCount > 0 && (
            <div style={s.activeCount}>
              <span style={s.activeDot} />
              {activeCount} active
            </div>
          )}
          <ThemeToggle />
        </div>
      </div>


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
                ...(isOver ? { ...s.columnOver, boxShadow: `0 0 0 2px ${col.accent}55, var(--shadow-elevated)` } : {}),
              }}
              onDragOver={e => { e.preventDefault(); setDragOver(col.id) }}
              onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(null) }}
              onDrop={() => onDrop(col.id)}
            >
              {/* Column top accent bar */}
              <div style={{ ...s.colBar, background: col.bar }} />

              {/* Column header */}
              <div
                style={s.colHeader}
                onMouseEnter={() => setHoveredColId(col.id)}
                onMouseLeave={() => setHoveredColId(null)}
              >
                <div style={s.colHeaderLeft}>
                  <span style={{ ...s.colDot, background: col.accent, boxShadow: `0 0 8px ${col.accent}88` }} />
                  {/* Delegation columns get inline rename on click */}
                  {(DELEGATION_IDS as readonly string[]).includes(col.id) && renamingColId === col.id ? (
                    <input
                      autoFocus
                      value={renameValue}
                      onChange={e => setRenameValue(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') saveRename(col.id as DelegationId)
                        if (e.key === 'Escape') setRenamingColId(null)
                      }}
                      onBlur={() => saveRename(col.id as DelegationId)}
                      style={{
                        fontSize: '12px', fontWeight: 700, letterSpacing: '0.07em',
                        textTransform: 'uppercase', color: col.color,
                        background: 'transparent', border: 'none',
                        borderBottom: `1.5px solid ${col.accent}`,
                        outline: 'none', padding: '0 2px', width: '110px',
                      }}
                    />
                  ) : (
                    <>
                      <span style={s.colLabel}>{col.label}</span>
                      {(DELEGATION_IDS as readonly string[]).includes(col.id) && hoveredColId === col.id && (
                        <button
                          onClick={() => { setRenamingColId(col.id as DelegationId); setRenameValue(col.label) }}
                          title="Rename column"
                          style={{
                            background: 'none', border: 'none', cursor: 'pointer',
                            padding: '0 2px', color: 'var(--muted)', opacity: 0.7,
                            fontSize: '11px', lineHeight: 1, display: 'flex', alignItems: 'center',
                          }}
                        >
                          ✏
                        </button>
                      )}
                    </>
                  )}
                  <span style={s.colCount}>({colTasks.length})</span>
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
                      isDeleting={deletingIds.has(task.id)}
                      isDropTarget={dragOverTaskId === task.id && draggingId !== task.id}
                      dropHalf={dragOverHalf}
                      isJustDropped={justDroppedId === task.id}
                      onDragStart={() => onDragStart(task)}
                      onDragEnd={onDragEnd}
                      onCardDragOver={(e) => onCardDragOver(e, task.id)}
                      onUpdateTitle={t => updateTitle(task.id, t)}
                      onMove={moveTask}
                      onDelete={deleteTask}
                      onOpenDetail={() => setDetailTask(task)}
                      onUpdateField={(field, value) => updateTaskField(task.id, field, value)}
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
      {/* Task Detail Modal */}
      {detailTask && (
        <TaskDetailModal
          task={detailTask}
          flashField={flashField}
          columns={COLUMNS}
          onClose={() => setDetailTask(null)}
          onUpdateField={(field, value) => updateTaskField(detailTask.id, field, value)}
          onStatusChange={(status) => { moveTask(detailTask.id, status); setDetailTask(prev => prev ? { ...prev, status } : prev); setFlashField('status'); setTimeout(() => setFlashField(null), 500) }}
          onTitleChange={(title) => { updateTitle(detailTask.id, title); setDetailTask(prev => prev ? { ...prev, title } : prev) }}
        />
      )}
    </div>
  )
}

// ─── Quick Add Card ──────────────────────────────────────────────────────────

function QuickAddCard({ onAdd, onCancel, accentColor }: { onAdd: (t: string) => void; onCancel: () => void; accentColor: string }) {
  const [value, setValue] = useState('')
  const [adding, setAdding] = useState(false)
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => { ref.current?.focus() }, [])
  function commit() { if (value.trim()) { setAdding(true); onAdd(value.trim()) } else onCancel() }
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
          disabled={!value.trim() || adding}
          style={{ ...qa.addBtn, background: accentColor, opacity: (!value.trim() || adding) ? 0.5 : 1 }}
        >
          {adding ? 'Adding...' : 'Add'}
        </button>
        <button onClick={onCancel} style={qa.cancelBtn}>Esc</button>
      </div>
    </div>
  )
}

const priorityColors: Record<string, { color: string; bg: string; border: string; label: string }> = {
  low:    { color: '#059669', bg: 'rgba(5,150,105,0.12)',   border: 'rgba(5,150,105,0.3)',   label: 'Low' },
  medium: { color: '#4F46E5', bg: 'rgba(79,70,229,0.12)',   border: 'rgba(79,70,229,0.3)',   label: 'Important' },
  high:   { color: '#E11D48', bg: 'rgba(225,29,72,0.10)',   border: 'rgba(225,29,72,0.28)',  label: 'High Priority' },
  urgent: { color: '#B91C1C', bg: 'rgba(185,28,28,0.10)',   border: 'rgba(185,28,28,0.28)',  label: 'Urgent' },
}

// ─── Kanban Card ─────────────────────────────────────────────────────────────

function PriorityDropdown({ current, onSelect, anchorRef }: { current: string; onSelect: (p: string) => void; anchorRef: React.RefObject<HTMLDivElement | null> }) {
  const options = ['low', 'medium', 'high', 'urgent'] as const
  const labels: Record<string, string> = { low: 'Low', medium: 'Important', high: 'High Priority', urgent: 'Urgent' }

  const rect = anchorRef.current?.getBoundingClientRect()
  const style: React.CSSProperties = {
    position: 'fixed',
    zIndex: 9999,
    left: rect ? rect.left : 0,
    bottom: rect ? window.innerHeight - rect.top + 6 : 0,
    background: 'var(--surface)', border: '1px solid var(--border2)',
    borderRadius: '10px', padding: '4px', minWidth: '150px',
    boxShadow: 'var(--shadow-modal)',
  }

  return (
    <div style={style} onClick={(e) => e.stopPropagation()}>
      <div style={{ padding: '6px 8px', fontSize: '10px', fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase' as const, letterSpacing: '0.05em' }}>Priority</div>
      {options.map(p => {
        const isActive = current === p
        const pc = priorityColors[p]
        return (
          <button key={p} onClick={() => onSelect(p)} style={{
            ...c.dropdownItem,
            ...(isActive ? { background: pc.bg, color: pc.color } : {}),
          }}>
            <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: pc.color, flexShrink: 0, display: 'inline-block' }} />
            <span>{labels[p]}</span>
            {isActive && <span style={{ marginLeft: 'auto', fontSize: '10px', color: pc.color }}>✓</span>}
          </button>
        )
      })}
    </div>
  )
}

function CardMoreMenu({ anchorRef, otherCols, onMove, onDelete }: {
  anchorRef: React.RefObject<HTMLDivElement | null>
  otherCols: KanbanColumn[]
  onMove: (colId: string) => void
  onDelete: () => void
}) {
  const rect = anchorRef.current?.getBoundingClientRect()
  const style: React.CSSProperties = {
    position: 'fixed',
    zIndex: 9999,
    right: rect ? window.innerWidth - rect.right : 0,
    bottom: rect ? window.innerHeight - rect.top + 6 : 0,
    background: 'var(--surface)', border: '1px solid var(--border2)',
    borderRadius: '12px', padding: '6px',
    minWidth: '152px',
    boxShadow: 'var(--shadow-modal)',
    animation: 'popIn 0.15s ease',
  }
  return (
    <div style={style} onClick={(e) => e.stopPropagation()}>
      <div style={c.menuLabel}>Move to</div>
      {otherCols.map(oc => (
        <button key={oc.id} onClick={() => onMove(oc.id)} style={c.menuItem}>
          <span style={{ ...c.menuDot, background: oc.accent }} />
          {oc.label}
        </button>
      ))}
      <div style={c.menuDivider} />
      <button onClick={onDelete} style={{ ...c.menuItem, color: '#EF4444' }}>
        Delete
      </button>
    </div>
  )
}

function KanbanCard({ task, col, isDragging, isDeleting, isDropTarget, dropHalf, isJustDropped, onDragStart, onDragEnd, onCardDragOver, onUpdateTitle, onMove, onDelete, onOpenDetail, onUpdateField, columns }: {
  task: Task
  col: KanbanColumn
  isDragging: boolean
  isDeleting?: boolean
  isDropTarget?: boolean
  dropHalf?: 'top' | 'bottom'
  isJustDropped?: boolean
  onDragStart: () => void
  onDragEnd: () => void
  onCardDragOver: (e: React.DragEvent) => void
  onUpdateTitle: (t: string) => void
  onMove: (id: string, status: string) => void
  onDelete: (id: string) => void
  onOpenDetail: () => void
  onUpdateField: (field: string, value: string | null) => void
  columns: KanbanColumn[]
}) {
  const [hovered, setHovered] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [priorityOpen, setPriorityOpen] = useState(false)
  const dateInputRef = useRef<HTMLInputElement>(null)
  const priorityAnchorRef = useRef<HTMLDivElement>(null)
  const menuAnchorRef = useRef<HTMLDivElement>(null)

  const isCompleted = task.status === 'completed'

  const otherCols = columns.filter(c => c.id !== task.status)

  return (
    <div style={{ position: 'relative' }}>
      {/* Drop indicator line */}
      {isDropTarget && dropHalf === 'top' && (
        <div style={c.dropIndicatorTop} />
      )}
      <div
        draggable
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDragOver={onCardDragOver}
        onClick={(e) => {
          const target = e.target as HTMLElement
          if (target.closest('button') || target.closest('input') || target.closest('[data-no-modal]')) return
          onOpenDetail()
        }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => { setHovered(false); setMenuOpen(false); setPriorityOpen(false) }}
        style={{
          ...c.card,
          ...(isDragging ? c.dragging : {}),
          ...(hovered && !isDragging ? c.hover : {}),
          cursor: 'pointer',
          ...(isDeleting ? { animation: 'fadeOutShrink 0.35s ease forwards', pointerEvents: 'none' as const } : {}),
          ...(isJustDropped ? { animation: 'dropFlash 0.7s ease' } : {}),
        }}
      >
      <div style={c.body}>
        {/* Priority pill — always shown, clickable to change priority */}
        <div ref={priorityAnchorRef} style={{ alignSelf: 'flex-start', marginBottom: '2px' }} data-no-modal>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setPriorityOpen(v => !v); setMenuOpen(false) }}
            style={{
              display: 'inline-flex', alignItems: 'center',
              padding: '2px 8px', borderRadius: '100px',
              fontSize: '11px', fontWeight: 600,
              color: priorityColors[task.priority || 'low']?.color || priorityColors.low.color,
              background: priorityColors[task.priority || 'low']?.bg || priorityColors.low.bg,
              border: `1px solid ${priorityColors[task.priority || 'low']?.border || priorityColors.low.border}`,
              cursor: 'pointer', fontFamily: 'inherit',
            }}
            title="Change priority"
          >
            {priorityColors[task.priority || 'low']?.label || 'Low'}
          </button>
          {priorityOpen && (
            <PriorityDropdown current={task.priority || 'low'} onSelect={(p) => { onUpdateField('priority', p); setPriorityOpen(false) }} anchorRef={priorityAnchorRef} />
          )}
        </div>

        {/* Title */}
        <div style={{ ...c.title, ...(isCompleted ? c.titleDone : {}) }}>
          {task.title || '(untitled)'}
        </div>

        {/* Footer row */}
        <div style={c.footer}>
          {/* Due date */}
          <div style={{ position: 'relative' }} data-no-modal>
            <input
              ref={dateInputRef}
              type="date"
              value={task.due_date || ''}
              onChange={(e) => onUpdateField('due_date', e.target.value || null)}
              style={c.hiddenDateInput}
              onClick={(e) => e.stopPropagation()}
            />
            <button
              onClick={(e) => { e.stopPropagation(); dateInputRef.current?.showPicker?.(); dateInputRef.current?.click() }}
              style={{ ...c.inlineBtn, color: task.due_date ? 'var(--accent)' : 'var(--muted)' }}
              title={task.due_date ? `Due: ${task.due_date}` : 'Set due date'}
            >
              <svg width="13" height="13" viewBox="0 0 14 14" fill="none" style={{ pointerEvents: 'none' }}>
                <rect x="1.5" y="2.5" width="11" height="9.5" rx="1.5" stroke="currentColor" strokeWidth="1.2"/>
                <path d="M1.5 5.5h11" stroke="currentColor" strokeWidth="1.2"/>
                <path d="M4.5 1v2M9.5 1v2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
              </svg>
              {task.due_date && (
                <span style={c.dueDateText}>
                  {new Date(task.due_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                </span>
              )}
            </button>
          </div>

          <div style={c.footerRight}>
            {/* More menu */}
            {hovered && (
              <div ref={menuAnchorRef} style={{ position: 'relative' }} data-no-modal>
                <button onClick={(e) => { e.stopPropagation(); setMenuOpen(v => !v); setPriorityOpen(false) }} style={c.moreBtn}>
                  <svg width="13" height="13" viewBox="0 0 13 13" fill="none" style={{ pointerEvents: 'none' }}>
                    <circle cx="6.5" cy="2.5" r="1.2" fill="currentColor"/>
                    <circle cx="6.5" cy="6.5" r="1.2" fill="currentColor"/>
                    <circle cx="6.5" cy="10.5" r="1.2" fill="currentColor"/>
                  </svg>
                </button>
                {menuOpen && (
                  <CardMoreMenu
                    anchorRef={menuAnchorRef}
                    otherCols={otherCols}
                    onMove={(colId) => { setMenuOpen(false); onMove(task.id, colId) }}
                    onDelete={() => { setMenuOpen(false); onDelete(task.id) }}
                  />
                )}
              </div>
            )}
          </div>
        </div>
      </div>
      </div>
      {/* Drop indicator line (bottom) */}
      {isDropTarget && dropHalf === 'bottom' && (
        <div style={c.dropIndicatorBottom} />
      )}
    </div>
  )
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const s: Record<string, React.CSSProperties> = {
  root: { display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, flex: 1 },

  toast: {
    display: 'flex', alignItems: 'center', gap: '10px',
    background: 'rgba(5,150,105,0.08)', border: '1px solid rgba(5,150,105,0.25)',
    borderRadius: '10px', padding: '12px 16px',
    fontSize: '13px', fontWeight: 500, color: '#047857',
    marginBottom: '16px', animation: 'fadeSlideIn 0.3s ease',
  },
  toastClose: {
    marginLeft: 'auto', background: 'none', border: 'none',
    color: 'rgba(5,150,105,0.5)', cursor: 'pointer', padding: '2px',
    display: 'flex', flexShrink: 0,
  },

  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' },
  headerLeft: { display: 'flex', alignItems: 'center', gap: '12px' },
  heading: { fontSize: '22px', fontWeight: 700, letterSpacing: '-0.04em', color: 'var(--text)' },
  workspaceBadge: {
    background: 'var(--accent-glow)',
    border: '1px solid rgba(79,70,229,0.25)',
    borderRadius: '100px',
    padding: '3px 12px',
    fontSize: '12px',
    color: 'var(--accent)',
    fontWeight: 500,
  },
  activeCount: {
    display: 'flex', alignItems: 'center', gap: '6px',
    fontSize: '12px', color: 'var(--muted)',
  },
  activeDot: {
    width: '6px', height: '6px', borderRadius: '50%',
    background: '#10B981', boxShadow: '0 0 6px rgba(16,185,129,0.6)',
  },

  board: {
    display: 'flex',
    gap: '16px',
    flex: 1,
    minHeight: 0,
    overflowX: 'auto',
    overflowY: 'hidden',
    paddingBottom: '12px',
  },

  column: {
    display: 'flex',
    flexDirection: 'column',
    width: '320px',
    minWidth: '280px',
    height: '100%',
    flexShrink: 0,
    background: 'var(--surface3)',
    borderRadius: '16px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: 'var(--border)',
    transition: 'border-color 0.2s, box-shadow 0.2s',
  },
  columnOver: { borderColor: 'rgba(79,70,229,0.45)', boxShadow: '0 0 0 2px rgba(79,70,229,0.15)' },

  colBar: { display: 'none' },

  colHeader: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '14px 16px 10px',
    flexShrink: 0,
  },
  colHeaderLeft: { display: 'flex', alignItems: 'center', gap: '8px' },
  colDot: { width: '8px', height: '8px', borderRadius: '50%', flexShrink: 0 },
  colLabel: { fontSize: '14px', fontWeight: 700, color: 'var(--text)', letterSpacing: '-0.01em' },
  colCount: {
    fontSize: '13px', fontWeight: 400, color: 'var(--muted)',
  },
  addBtn: {
    background: 'var(--surface)',
    border: '1.5px solid var(--border2)',
    borderRadius: '50%',
    cursor: 'pointer',
    color: 'var(--text2)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    width: '26px', height: '26px', padding: 0,
    transition: 'background 0.15s, border-color 0.15s',
    flexShrink: 0,
  },

  cardsList: {
    display: 'flex', flexDirection: 'column', gap: '8px',
    padding: '4px 10px 14px',
    overflowY: 'auto',
    flex: 1,
    minHeight: 0,
  },

  emptyCol: {
    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
    borderWidth: '1.5px', borderStyle: 'dashed', borderColor: 'var(--border2)',
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
    background: 'var(--surface)',
    borderRadius: '12px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: 'var(--border)',
    padding: '0',
    cursor: 'grab',
    display: 'flex',
    flexDirection: 'column',
    flexShrink: 0,
    transition: 'box-shadow 0.15s, border-color 0.15s',
    userSelect: 'none' as const,
    overflow: 'visible',
    boxShadow: '0 1px 4px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)',
  },
  dragging: { opacity: 0.4, transform: 'scale(0.98)', cursor: 'grabbing', boxShadow: 'none' },
  dropIndicatorTop: {
    position: 'absolute' as const, top: '-4px', left: '4px', right: '4px',
    height: '3px', borderRadius: '2px',
    background: 'linear-gradient(90deg, #3730A3, #6366F1)',
    boxShadow: '0 0 8px rgba(79,70,229,0.5)',
    zIndex: 10,
  },
  dropIndicatorBottom: {
    position: 'absolute' as const, bottom: '-4px', left: '4px', right: '4px',
    height: '3px', borderRadius: '2px',
    background: 'linear-gradient(90deg, #3730A3, #6366F1)',
    boxShadow: '0 0 8px rgba(79,70,229,0.5)',
    zIndex: 10,
  },
  hover: {
    borderColor: 'rgba(79,70,229,0.35)',
    boxShadow: '0 4px 12px rgba(0,0,0,0.09), 0 1px 3px rgba(0,0,0,0.06)',
  },
  body: { flex: 1, padding: '12px 14px 11px', display: 'flex', flexDirection: 'column', gap: '7px', minWidth: 0 },

  title: {
    fontSize: '14px', fontWeight: 600, color: 'var(--text)',
    lineHeight: 1.45, cursor: 'text', wordBreak: 'break-word' as const,
  },
  titleDone: { textDecoration: 'line-through' },
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
    display: 'inline-flex', alignItems: 'center', gap: '4px',
    fontSize: '11px', fontWeight: 500,
    border: '1px solid',
    borderRadius: '100px', padding: '2px 8px',
    whiteSpace: 'nowrap' as const,
  },
  statusDot: { width: '5px', height: '5px', borderRadius: '50%', flexShrink: 0 },

  moreBtn: {
    background: 'var(--surface2)', border: '1px solid var(--border)',
    borderRadius: '6px', color: 'var(--muted)',
    cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
    width: '24px', height: '24px', padding: 0,
  },
  menu: { /* kept for compat — actual menu uses position:fixed via CardMoreMenu */ },
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
  inlineBtn: {
    background: 'none', border: 'none', color: 'var(--muted)',
    cursor: 'pointer', padding: '2px', display: 'flex', alignItems: 'center', gap: '4px',
    fontSize: '11px', fontFamily: 'inherit', borderRadius: '4px',
    transition: 'color 0.15s',
  },
  dueDateText: { fontSize: '10px', fontWeight: 500, whiteSpace: 'nowrap' as const },
  dropdown: {
    position: 'absolute' as const, right: 0, bottom: '28px',
    background: 'var(--surface)', border: '1px solid var(--border2)',
    borderRadius: '10px', padding: '4px', zIndex: 200, minWidth: '130px',
    boxShadow: 'var(--shadow-modal)',
    maxHeight: '220px', overflowY: 'auto' as const,
  },
  dropdownItem: {
    display: 'flex', alignItems: 'center', gap: '7px',
    width: '100%', background: 'none', border: 'none',
    color: 'var(--muted)', fontSize: '12px', fontWeight: 500,
    padding: '6px 8px', cursor: 'pointer', textAlign: 'left' as const,
    borderRadius: '6px', fontFamily: 'inherit',
  },
  dropdownDot: { width: '6px', height: '6px', borderRadius: '50%', flexShrink: 0 },
  hiddenDateInput: {
    position: 'absolute' as const, opacity: 0, width: 0, height: 0,
    pointerEvents: 'none' as const, overflow: 'hidden',
  },
}

// Quick add styles
const qa: Record<string, React.CSSProperties> = {
  card: {
    background: 'var(--surface)',
    border: '1.5px solid rgba(79,70,229,0.35)',
    borderRadius: '12px', padding: '11px 12px',
    display: 'flex', flexDirection: 'column', gap: '10px',
    boxShadow: '0 4px 16px rgba(0,0,0,0.1)',
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


// ─── Task Detail Modal ───────────────────────────────────────────────────────

const PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const

function TaskDetailModal({ task, flashField, columns, onClose, onUpdateField, onStatusChange, onTitleChange }: {
  task: Task
  flashField?: string | null
  columns: KanbanColumn[]
  onClose: () => void
  onUpdateField: (field: string, value: string | null) => void
  onStatusChange: (status: string) => void
  onTitleChange: (title: string) => void
}) {
  const STATUS_OPTIONS = columns.map(c => ({ id: c.id, label: c.label, color: c.accent }))
  const [editingTitle, setEditingTitle] = useState(false)
  const [localTitle, setLocalTitle] = useState(task.title)
  const [updates, setUpdates] = useState<TaskUpdate[]>([])
  const [loadingUpdates, setLoadingUpdates] = useState(true)
  const [newUpdate, setNewUpdate] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const titleRef = useRef<HTMLInputElement>(null)

  useEffect(() => { setLocalTitle(task.title) }, [task.title])

  useEffect(() => {
    setLoadingUpdates(true)
    fetch(`/api/tasks/${task.id}/updates`)
      .then(r => r.json())
      .then(data => { setUpdates(Array.isArray(data) ? data : []); setLoadingUpdates(false) })
      .catch(() => setLoadingUpdates(false))
  }, [task.id])

  function commitTitle() {
    setEditingTitle(false)
    const t = localTitle.trim()
    if (t && t !== task.title) onTitleChange(t)
    else setLocalTitle(task.title)
  }

  async function addUpdate() {
    if (!newUpdate.trim() || submitting) return
    setSubmitting(true)
    try {
      const res = await fetch(`/api/tasks/${task.id}/updates`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: newUpdate.trim() }),
      })
      const data = await res.json()
      if (res.ok) {
        setUpdates(prev => [...prev, { ...data, user_name: 'You' }])
        setNewUpdate('')
      }
    } catch { /* ignore */ }
    setSubmitting(false)
  }

  const col = columns.find(c => c.id === task.status) || columns[1]

  return (
    <div style={m.overlay} onClick={onClose}>
      <div style={m.modal} onClick={e => e.stopPropagation()}>
        {/* Close button */}
        <button onClick={onClose} style={m.closeBtn}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
          </svg>
        </button>

        {/* Title */}
        <div style={m.titleRow}>
          <div style={{ ...m.titleDot, background: col.accent }} />
          {editingTitle ? (
            <input
              ref={titleRef}
              value={localTitle}
              onChange={e => setLocalTitle(e.target.value)}
              onBlur={commitTitle}
              onKeyDown={e => { if (e.key === 'Enter') commitTitle(); if (e.key === 'Escape') { setLocalTitle(task.title); setEditingTitle(false) } }}
              style={m.titleInput}
              autoFocus
            />
          ) : (
            <h2 onClick={() => { setEditingTitle(true); setTimeout(() => titleRef.current?.focus(), 0) }} style={m.title}>
              {task.title}
            </h2>
          )}
        </div>

        {/* Meta row: Status, Priority, Due Date */}
        <div style={m.metaGrid}>
          <div style={{ ...m.metaItem, borderRadius: '8px', ...(flashField === 'status' ? { animation: 'confirmFlash 0.5s ease' } : {}) }}>
            <span style={m.metaLabel}>Status</span>
            <div style={m.metaOptions}>
              {STATUS_OPTIONS.map(s => (
                <button
                  key={s.id}
                  onClick={() => onStatusChange(s.id)}
                  style={{
                    ...m.statusChip,
                    ...(task.status === s.id ? { background: s.color + '25', borderColor: s.color + '60', color: s.color } : {}),
                  }}
                >
                  <span style={{ ...m.chipDot, background: task.status === s.id ? s.color : 'var(--muted)' }} />
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          <div style={{ ...m.metaItem, borderRadius: '8px', ...(flashField === 'priority' ? { animation: 'confirmFlash 0.5s ease' } : {}) }}>
            <span style={m.metaLabel}>Priority</span>
            <div style={m.metaOptions}>
              {PRIORITIES.map(p => (
                <button
                  key={p}
                  onClick={() => onUpdateField('priority', p)}
                  style={{
                    ...m.statusChip,
                    ...((task.priority || 'low') === p ? {
                      background: priorityColors[p].bg,
                      borderColor: priorityColors[p].color + '60',
                      color: priorityColors[p].color,
                    } : {}),
                  }}
                >
                  {priorityColors[p].label}
                </button>
              ))}
            </div>
          </div>

          <div style={{ ...m.metaItem, borderRadius: '8px', ...(flashField === 'due_date' ? { animation: 'confirmFlash 0.5s ease' } : {}) }}>
            <span style={m.metaLabel}>Due Date</span>
            <input
              type="date"
              value={task.due_date || ''}
              onChange={e => onUpdateField('due_date', e.target.value || null)}
              style={m.dateInput}
            />
          </div>
        </div>

        <div style={m.divider} />

        {/* Updates Timeline */}
        <div style={m.updatesSection}>
          <h3 style={m.updatesTitle}>Updates</h3>

          <div style={m.timeline}>
            {/* Root: the task itself */}
            <div style={m.timelineItem}>
              <div style={m.timelineNodeWrap}>
                <div style={{ ...m.timelineNode, background: col.accent, width: '12px', height: '12px' }} />
                {(updates.length > 0 || !loadingUpdates) && <div style={m.timelineLine} />}
              </div>
              <div style={m.timelineContent}>
                <span style={m.timelineLabel}>Task created</span>
                <span style={m.timelineDate}>
                  {new Date(task.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                </span>
              </div>
            </div>

            {/* Updates */}
            {loadingUpdates ? (
              <div style={{ padding: '16px 0 16px 30px', color: 'var(--muted)', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span style={{ display: 'inline-block', width: '14px', height: '14px', border: '2px solid var(--border)', borderTopColor: 'var(--accent)', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
                Loading updates...
              </div>
            ) : updates.map((upd, i) => (
              <div key={upd.id} style={m.timelineItem}>
                <div style={m.timelineNodeWrap}>
                  <div style={m.timelineNode} />
                  {i < updates.length - 1 && <div style={m.timelineLine} />}
                </div>
                <div style={m.timelineContent}>
                  <div style={m.updateBubble}>
                    <div style={m.updateHeader}>
                      <span style={m.updateAuthor}>{upd.user_name}</span>
                      <span style={m.updateDate}>
                        {new Date(upd.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                        {' '}
                        {new Date(upd.created_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                    <p style={m.updateText}>{upd.content}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Add update */}
          <div style={m.addUpdateRow}>
            <div style={m.timelineNodeWrap}>
              <div style={{ ...m.timelineNode, background: 'var(--accent)' }} />
            </div>
            <div style={m.addUpdateInputWrap}>
              <textarea
                value={newUpdate}
                onChange={e => setNewUpdate(e.target.value)}
                placeholder="Add an update..."
                style={m.addUpdateInput}
                rows={2}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); addUpdate() } }}
              />
              <button
                onClick={addUpdate}
                disabled={!newUpdate.trim() || submitting}
                style={{ ...m.addUpdateBtn, opacity: !newUpdate.trim() || submitting ? 0.4 : 1 }}
              >
                {submitting ? 'Posting...' : 'Post'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// Modal styles
const m: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    zIndex: 1000, padding: '24px',
    backdropFilter: 'blur(2px)',
  },
  modal: {
    background: 'var(--surface)', border: '1px solid var(--border2)',
    borderRadius: '18px', padding: '28px', width: '100%', maxWidth: '560px',
    maxHeight: '85vh', overflowY: 'auto' as const, position: 'relative' as const,
    boxShadow: 'var(--shadow-modal)',
  },
  closeBtn: {
    position: 'absolute' as const, top: '16px', right: '16px',
    background: 'var(--surface2)', border: '1px solid var(--border)',
    borderRadius: '8px', width: '30px', height: '30px',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    cursor: 'pointer', color: 'var(--muted)', padding: 0,
  },
  titleRow: { display: 'flex', alignItems: 'flex-start', gap: '12px', marginBottom: '20px', paddingRight: '40px' },
  titleDot: { width: '10px', height: '10px', borderRadius: '50%', marginTop: '7px', flexShrink: 0 },
  title: {
    fontSize: '20px', fontWeight: 700, color: 'var(--text)', cursor: 'text',
    letterSpacing: '-0.02em', lineHeight: 1.35, wordBreak: 'break-word' as const,
  },
  titleInput: {
    width: '100%', background: 'transparent', border: 'none',
    borderBottom: '2px solid var(--accent)', outline: 'none',
    fontSize: '20px', fontWeight: 700, color: 'var(--text)',
    fontFamily: 'inherit', padding: '0 0 4px', lineHeight: 1.35,
  },

  metaGrid: { display: 'flex', flexDirection: 'column' as const, gap: '14px', marginBottom: '20px' },
  metaItem: { display: 'flex', flexDirection: 'column' as const, gap: '6px' },
  metaLabel: { fontSize: '11px', fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase' as const, letterSpacing: '0.06em' },
  metaOptions: { display: 'flex', flexWrap: 'wrap' as const, gap: '6px' },
  statusChip: {
    background: 'var(--surface2)', border: '1px solid var(--border)',
    borderRadius: '6px', padding: '4px 10px', fontSize: '12px', fontWeight: 500,
    color: 'var(--muted)', cursor: 'pointer', fontFamily: 'inherit',
    display: 'inline-flex', alignItems: 'center', gap: '5px',
    transition: 'all 0.15s',
  },
  chipDot: { width: '6px', height: '6px', borderRadius: '50%', flexShrink: 0 },
  dateInput: {
    background: 'var(--surface2)', border: '1px solid var(--border)',
    borderRadius: '8px', padding: '7px 12px', fontSize: '13px',
    color: 'var(--text)', fontFamily: 'inherit', width: 'fit-content',
    outline: 'none', colorScheme: 'light',
  },

  divider: { height: '1px', background: 'var(--border)', margin: '4px 0 16px' },

  updatesSection: {},
  updatesTitle: { fontSize: '14px', fontWeight: 700, color: 'var(--text)', marginBottom: '14px', letterSpacing: '-0.01em' },

  timeline: { display: 'flex', flexDirection: 'column' as const },
  timelineItem: { display: 'flex', gap: '12px', minHeight: '40px' },
  timelineNodeWrap: {
    display: 'flex', flexDirection: 'column' as const, alignItems: 'center',
    width: '12px', flexShrink: 0,
  },
  timelineNode: {
    width: '10px', height: '10px', borderRadius: '50%',
    background: 'var(--border2)', flexShrink: 0, border: '2px solid var(--surface)',
  },
  timelineLine: {
    width: '2px', flex: 1, background: 'var(--border)', minHeight: '12px',
  },
  timelineContent: {
    flex: 1, paddingBottom: '14px', display: 'flex', flexDirection: 'column' as const, gap: '2px',
  },
  timelineLabel: { fontSize: '12px', fontWeight: 600, color: 'var(--muted)' },
  timelineDate: { fontSize: '11px', color: 'var(--muted)', opacity: 0.7 },

  updateBubble: {
    background: 'var(--surface2)', border: '1px solid var(--border)',
    borderRadius: '10px', padding: '10px 13px',
  },
  updateHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' },
  updateAuthor: { fontSize: '12px', fontWeight: 600, color: 'var(--accent-light)' },
  updateDate: { fontSize: '10px', color: 'var(--muted)' },
  updateText: { fontSize: '13px', color: 'var(--text2)', lineHeight: 1.55 },

  addUpdateRow: { display: 'flex', gap: '12px', marginTop: '4px' },
  addUpdateInputWrap: { flex: 1, display: 'flex', flexDirection: 'column' as const, gap: '8px' },
  addUpdateInput: {
    background: 'var(--surface2)', border: '1px solid var(--border)',
    borderRadius: '10px', padding: '10px 13px', fontSize: '13px',
    color: 'var(--text)', fontFamily: 'inherit', resize: 'none' as const,
    outline: 'none', lineHeight: 1.5, width: '100%',
  },
  addUpdateBtn: {
    alignSelf: 'flex-end' as const, background: 'var(--accent)', color: 'white',
    border: 'none', borderRadius: '7px', padding: '6px 16px',
    fontSize: '12px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
  },
}
