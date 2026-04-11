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
}

const COLUMNS = [
  {
    id: 'backlog',
    label: 'Inbox',
    color: '#f59e0b',
    accent: '#d97706',
    glow: 'rgba(217,119,6,0.15)',
    bar: 'linear-gradient(90deg, #b45309, #f59e0b)',
  },
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
  const [dragOverTaskId, setDragOverTaskId] = useState<string | null>(null)
  const [quickAddCol, setQuickAddCol] = useState<string | null>(null)
  const [detailTask, setDetailTask] = useState<Task | null>(null)
  const [showSlackToast, setShowSlackToast] = useState(false)
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set())
  const [flashField, setFlashField] = useState<string | null>(null)
  const dragTask = useRef<Task | null>(null)
  const dragOverHalf = useRef<'top' | 'bottom'>('bottom')
  const reorderCooldown = useRef(false)
  const searchParams = useSearchParams()

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
  const grouped = {
    backlog:     tasks.filter(t => t.status === 'backlog').sort(sortByPos),
    active:      tasks.filter(t => t.status === 'active').sort(sortByPos),
    in_progress: tasks.filter(t => t.status === 'in_progress').sort(sortByPos),
    completed:   tasks.filter(t => t.status === 'completed').sort(sortByPos),
  } as Record<string, Task[]>

  const activeCount = tasks.filter(t => t.status === 'backlog' || t.status === 'active' || t.status === 'in_progress').length

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

  async function updateTaskField(taskId: string, field: string, value: string | null) {
    setTasks(prev => prev.map(t => t.id === taskId ? { ...t, [field]: value } : t))
    if (detailTask?.id === taskId) setDetailTask(prev => prev ? { ...prev, [field]: value } : prev)
    // Flash the field in modal to confirm change
    setFlashField(field)
    setTimeout(() => setFlashField(null), 500)
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
    dragOverHalf.current = e.clientY < midY ? 'top' : 'bottom'
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
      const insertAt = dragOverHalf.current === 'bottom' ? targetIndex + 1 : targetIndex
      colTasks.splice(insertAt, 0, moved)

      // Update positions in local state
      const updatedIds = colTasks.map(t => t.id)
      const positionMap = Object.fromEntries(updatedIds.map((id, i) => [id, i]))
      setTasks(prev => prev.map(t => positionMap[t.id] !== undefined ? { ...t, position: positionMap[t.id] } : t))

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
            <circle cx="8" cy="8" r="7" fill="#22c55e" opacity="0.15"/>
            <path d="M5 8.5L7 10.5L11 5.5" stroke="#4ade80" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
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
        {activeCount > 0 && (
          <div style={s.activeCount}>
            <span style={s.activeDot} />
            {activeCount} active
          </div>
        )}
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
                      isDeleting={deletingIds.has(task.id)}
                      isDropTarget={dragOverTaskId === task.id && draggingId !== task.id}
                      dropHalf={dragOverHalf.current}
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

const priorityColors: Record<string, { color: string; bg: string }> = {
  low: { color: '#4ade80', bg: 'rgba(74,222,128,0.12)' },
  medium: { color: '#f59e0b', bg: 'rgba(245,158,11,0.12)' },
  high: { color: '#f97316', bg: 'rgba(249,115,22,0.12)' },
  urgent: { color: '#ef4444', bg: 'rgba(239,68,68,0.12)' },
}

// ─── Kanban Card ─────────────────────────────────────────────────────────────

function PriorityIcon({ priority, onClick }: { priority: string; onClick: (e: React.MouseEvent) => void }) {
  const p = priority || 'none'
  const color = priorityColors[p]?.color || 'var(--muted)'
  const bars = p === 'urgent' ? 4 : p === 'high' ? 3 : p === 'medium' ? 2 : p === 'low' ? 1 : 0
  return (
    <button onClick={onClick} style={c.inlineBtn} title={`Priority: ${p}`}>
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ pointerEvents: 'none' }}>
        {[0,1,2,3].map(i => (
          <rect key={i} x={1 + i * 3.5} y={10 - (i + 1) * 2.2} width="2.5" height={(i + 1) * 2.2}
            rx="0.5" fill={i < bars ? color : 'rgba(255,255,255,0.08)'} />
        ))}
      </svg>
    </button>
  )
}

function PriorityDropdown({ current, onSelect, anchorRef }: { current: string; onSelect: (p: string) => void; anchorRef: React.RefObject<HTMLDivElement | null> }) {
  const options = ['none', 'low', 'medium', 'high', 'urgent'] as const
  const labels: Record<string, string> = { none: 'No priority', low: 'Low', medium: 'Medium', high: 'High', urgent: 'Urgent' }

  // Position fixed relative to anchor
  const rect = anchorRef.current?.getBoundingClientRect()
  const style: React.CSSProperties = {
    position: 'fixed',
    zIndex: 9999,
    left: rect ? rect.left : 0,
    bottom: rect ? window.innerHeight - rect.top + 6 : 0,
    background: 'var(--surface)', border: '1px solid var(--border2)',
    borderRadius: '10px', padding: '4px', minWidth: '160px',
    boxShadow: '0 12px 32px rgba(0,0,0,0.6)',
  }

  return (
    <div style={style} onClick={(e) => e.stopPropagation()}>
      <div style={{ padding: '6px 8px', fontSize: '10px', fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase' as const, letterSpacing: '0.05em' }}>Set priority</div>
      {options.map(p => {
        const isActive = (current || 'none') === p
        const pColor = priorityColors[p]?.color || 'var(--muted)'
        const bars = p === 'urgent' ? 4 : p === 'high' ? 3 : p === 'medium' ? 2 : p === 'low' ? 1 : 0
        return (
          <button key={p} onClick={() => onSelect(p)} style={{
            ...c.dropdownItem,
            ...(isActive ? { background: 'var(--surface3)', color: 'var(--text)' } : {}),
          }}>
            <svg width="12" height="12" viewBox="0 0 14 14" fill="none" style={{ flexShrink: 0 }}>
              {[0,1,2,3].map(i => (
                <rect key={i} x={1 + i * 3.5} y={10 - (i + 1) * 2.2} width="2.5" height={(i + 1) * 2.2}
                  rx="0.5" fill={i < bars ? pColor : 'rgba(255,255,255,0.08)'} />
              ))}
            </svg>
            <span style={{ color: isActive ? pColor : undefined }}>{labels[p]}</span>
            {isActive && <span style={{ marginLeft: 'auto', fontSize: '10px' }}>✓</span>}
          </button>
        )
      })}
    </div>
  )
}

function KanbanCard({ task, col, isDragging, isDeleting, isDropTarget, dropHalf, onDragStart, onDragEnd, onCardDragOver, onUpdateTitle, onMove, onDelete, onOpenDetail, onUpdateField, columns }: {
  task: Task
  col: typeof COLUMNS[0]
  isDragging: boolean
  isDeleting?: boolean
  isDropTarget?: boolean
  dropHalf?: 'top' | 'bottom'
  onDragStart: () => void
  onDragEnd: () => void
  onCardDragOver: (e: React.DragEvent) => void
  onUpdateTitle: (t: string) => void
  onMove: (id: string, status: string) => void
  onDelete: (id: string) => void
  onOpenDetail: () => void
  onUpdateField: (field: string, value: string | null) => void
  columns: typeof COLUMNS
}) {
  const [hovered, setHovered] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [priorityOpen, setPriorityOpen] = useState(false)
  const dateInputRef = useRef<HTMLInputElement>(null)
  const priorityAnchorRef = useRef<HTMLDivElement>(null)

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
          borderLeftColor: col.accent,
          cursor: 'pointer',
          ...(isDeleting ? { animation: 'fadeOutShrink 0.35s ease forwards', pointerEvents: 'none' as const } : {}),
        }}
      >
      {/* Left accent stripe */}
      <div style={{ ...c.stripe, background: col.bar }} />

      <div style={c.body}>
        {/* Title */}
        <div style={{ ...c.title, ...(isCompleted ? c.titleDone : {}) }}>
          {task.title || '(untitled)'}
        </div>

        {/* Footer row */}
        <div style={c.footer}>
          {/* Status pill */}
          <span style={{ ...c.statusPill, color: col.color, background: col.glow, borderColor: `${col.accent}30` }}>
            <span style={{ ...c.statusDot, background: col.accent }} />
            {col.label}
          </span>

          <div style={c.footerRight}>
            {/* Inline priority icon */}
            <div ref={priorityAnchorRef} style={{ position: 'relative' }} data-no-modal>
              <PriorityIcon priority={task.priority || 'none'} onClick={(e) => { e.stopPropagation(); setPriorityOpen(v => !v); setMenuOpen(false) }} />
              {priorityOpen && (
                <PriorityDropdown current={task.priority || 'none'} onSelect={(p) => { onUpdateField('priority', p); setPriorityOpen(false) }} anchorRef={priorityAnchorRef} />
              )}
            </div>

            {/* Inline due date — single click opens native picker */}
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
                style={{ ...c.inlineBtn, color: task.due_date ? 'var(--text)' : 'var(--muted)' }}
                title={task.due_date ? `Due: ${task.due_date}` : 'Set due date'}
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ pointerEvents: 'none' }}>
                  <rect x="1.5" y="2.5" width="11" height="9.5" rx="1.5" stroke="currentColor" strokeWidth="1.2"/>
                  <path d="M1.5 5.5h11" stroke="currentColor" strokeWidth="1.2"/>
                  <path d="M4.5 1v2M9.5 1v2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
                </svg>
                <span style={c.dueDateText}>
                  {task.due_date
                    ? new Date(task.due_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                    : 'Due Date'}
                </span>
              </button>
            </div>

            {/* More menu */}
            {hovered && (
              <div style={{ position: 'relative' }} data-no-modal>
                <button onClick={(e) => { e.stopPropagation(); setMenuOpen(v => !v); setPriorityOpen(false) }} style={c.moreBtn}>
                  <svg width="13" height="13" viewBox="0 0 13 13" fill="none" style={{ pointerEvents: 'none' }}>
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
                    <button onClick={() => { setMenuOpen(false); onDelete(task.id) }} style={{ ...c.menuItem, color: '#f87171' }}>
                      Delete
                    </button>
                  </div>
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
    background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.25)',
    borderRadius: '10px', padding: '12px 16px',
    fontSize: '13px', fontWeight: 500, color: '#4ade80',
    marginBottom: '16px', animation: 'fadeSlideIn 0.3s ease',
  },
  toastClose: {
    marginLeft: 'auto', background: 'none', border: 'none',
    color: 'rgba(74,222,128,0.5)', cursor: 'pointer', padding: '2px',
    display: 'flex', flexShrink: 0,
  },

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
    width: '340px',
    minWidth: '300px',
    height: '100%',
    flexShrink: 0,
    background: 'var(--surface)',
    borderRadius: '12px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: 'var(--border)',
    transition: 'border-color 0.2s, box-shadow 0.2s',
  },
  columnOver: { borderColor: 'rgba(124,92,252,0.5)' },

  colBar: { height: '3px', width: '100%', flexShrink: 0 },

  colHeader: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '14px 14px 10px',
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
    padding: '6px 10px 14px',
    overflowY: 'auto',
    flex: 1,
    minHeight: 0,
  },

  emptyCol: {
    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
    borderWidth: '1.5px', borderStyle: 'dashed', borderColor: 'rgba(255,255,255,0.08)',
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
    background: 'linear-gradient(180deg, #1e1f32 0%, #1a1b2e 100%)',
    borderRadius: '10px',
    border: '1px solid var(--border)',
    borderLeftWidth: '3px',
    borderLeftStyle: 'solid',
    borderLeftColor: 'transparent',
    padding: '0',
    cursor: 'grab',
    display: 'flex',
    minHeight: '72px',
    flexShrink: 0,
    transition: 'background 0.15s, box-shadow 0.15s',
    userSelect: 'none' as const,
    overflow: 'hidden',
  },
  dragging: { opacity: 0.35, transform: 'scale(0.98)', cursor: 'grabbing' },
  dropIndicatorTop: {
    position: 'absolute' as const, top: '-4px', left: '4px', right: '4px',
    height: '3px', borderRadius: '2px',
    background: 'linear-gradient(90deg, #7c5cfc, #a78bfa)',
    boxShadow: '0 0 8px rgba(124,92,252,0.5)',
    zIndex: 10,
  },
  dropIndicatorBottom: {
    position: 'absolute' as const, bottom: '-4px', left: '4px', right: '4px',
    height: '3px', borderRadius: '2px',
    background: 'linear-gradient(90deg, #7c5cfc, #a78bfa)',
    boxShadow: '0 0 8px rgba(124,92,252,0.5)',
    zIndex: 10,
  },
  hover: {
    background: 'linear-gradient(180deg, #262740 0%, #1e1f34 100%)',
    boxShadow: '0 4px 12px rgba(0,0,0,0.35)',
  },
  stripe: { width: '3px', flexShrink: 0 },
  body: { flex: 1, padding: '12px 14px 10px', display: 'flex', flexDirection: 'column', gap: '8px', minWidth: 0 },

  title: {
    fontSize: '14px', fontWeight: 500, color: 'var(--text)',
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
    boxShadow: '0 12px 32px rgba(0,0,0,0.6)',
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


// ─── Task Detail Modal ───────────────────────────────────────────────────────

const PRIORITIES = ['none', 'low', 'medium', 'high', 'urgent'] as const
const STATUS_OPTIONS = COLUMNS.map(c => ({ id: c.id, label: c.label, color: c.accent }))

function TaskDetailModal({ task, flashField, onClose, onUpdateField, onStatusChange, onTitleChange }: {
  task: Task
  flashField?: string | null
  onClose: () => void
  onUpdateField: (field: string, value: string | null) => void
  onStatusChange: (status: string) => void
  onTitleChange: (title: string) => void
}) {
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

  const col = COLUMNS.find(c => c.id === task.status) || COLUMNS[1]

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
                    ...((task.priority || 'none') === p ? {
                      background: (priorityColors[p]?.bg || 'rgba(148,163,184,0.1)'),
                      borderColor: (priorityColors[p]?.color || '#64748b') + '60',
                      color: priorityColors[p]?.color || '#94a3b8',
                    } : {}),
                  }}
                >
                  {p === 'none' ? 'None' : p.charAt(0).toUpperCase() + p.slice(1)}
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
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    zIndex: 1000, padding: '24px',
  },
  modal: {
    background: 'var(--surface)', border: '1px solid var(--border2)',
    borderRadius: '18px', padding: '28px', width: '100%', maxWidth: '560px',
    maxHeight: '85vh', overflowY: 'auto' as const, position: 'relative' as const,
    boxShadow: '0 24px 80px rgba(0,0,0,0.6)',
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
    fontSize: '20px', fontWeight: 700, color: '#ffffff', cursor: 'text',
    letterSpacing: '-0.02em', lineHeight: 1.35, wordBreak: 'break-word' as const,
  },
  titleInput: {
    width: '100%', background: 'transparent', border: 'none',
    borderBottom: '2px solid var(--accent)', outline: 'none',
    fontSize: '20px', fontWeight: 700, color: '#ffffff',
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
    outline: 'none', colorScheme: 'dark',
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
  updateText: { fontSize: '13px', color: 'rgba(255,255,255,0.85)', lineHeight: 1.55 },

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
