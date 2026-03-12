'use client'

import { useState, useRef } from 'react'

export type Task = {
  id: string
  title: string
  status: string
  created_at: string
  completed_at?: string | null
  user_id?: string
}

type Props = {
  task: Task
  readonly?: boolean
  onUpdate?: (id: string, updates: { status?: string; title?: string }) => void
}

const STATUS_CYCLE: Record<string, string> = {
  active: 'in_progress',
  in_progress: 'completed',
  completed: 'active',
  archived: 'active',
  deleted: 'active',
}

const STATUS_DOT: Record<string, string> = {
  active: '#4ade80',
  in_progress: '#60a5fa',
  completed: 'var(--muted)',
  archived: 'var(--border)',
  deleted: 'var(--border)',
}

export default function TaskCard({ task, readonly = false, onUpdate }: Props) {
  const [localTitle, setLocalTitle] = useState(task.title)
  const [editing, setEditing] = useState(false)
  const [showMenu, setShowMenu] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const status = task.status || 'active'
  const isArchived = status === 'archived' || status === 'deleted'

  const date = (status === 'completed' && task.completed_at)
    ? new Date(task.completed_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    : new Date(task.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

  function handleStatusClick() {
    if (readonly) return
    const next = STATUS_CYCLE[status] || 'active'
    onUpdate?.(task.id, { status: next })
  }

  function handleArchive() {
    setShowMenu(false)
    onUpdate?.(task.id, { status: 'archived' })
  }

  function handleTitleClick() {
    if (readonly) return
    setEditing(true)
    setTimeout(() => inputRef.current?.focus(), 0)
  }

  function handleTitleBlur() {
    setEditing(false)
    const trimmed = localTitle.trim()
    if (trimmed && trimmed !== task.title) {
      onUpdate?.(task.id, { title: trimmed })
    } else {
      setLocalTitle(task.title)
    }
  }

  function handleTitleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') inputRef.current?.blur()
    if (e.key === 'Escape') { setLocalTitle(task.title); setEditing(false) }
  }

  return (
    <div
      style={{ ...s.card, ...(isArchived ? s.cardArchived : {}) }}
      onMouseLeave={() => setShowMenu(false)}
    >
      <button
        onClick={handleStatusClick}
        disabled={readonly}
        style={{ ...s.dotBtn, cursor: readonly ? 'default' : 'pointer' }}
        title={readonly ? undefined : 'Click to advance status'}
      >
        <div style={{ ...s.dot, background: STATUS_DOT[status] || '#4ade80' }} />
      </button>

      <div style={s.titleWrap} onClick={handleTitleClick}>
        {editing ? (
          <input
            ref={inputRef}
            value={localTitle}
            onChange={e => setLocalTitle(e.target.value)}
            onBlur={handleTitleBlur}
            onKeyDown={handleTitleKeyDown}
            style={s.titleInput}
          />
        ) : (
          <span style={{
            ...s.title,
            ...(status === 'completed' ? s.titleDone : {}),
            ...(isArchived ? s.titleArchived : {}),
            cursor: readonly ? 'default' : 'text',
          }}>
            {localTitle || '(untitled)'}
          </span>
        )}
      </div>

      <div style={s.right}>
        <span style={s.date}>{date}</span>
        {!readonly && !isArchived && (
          <div style={s.menuWrap}>
            <button onClick={() => setShowMenu(v => !v)} style={s.menuBtn} title="More actions">
              ···
            </button>
            {showMenu && (
              <div style={s.menu}>
                <button onClick={handleArchive} style={s.menuItem}>Archive</button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

const s: Record<string, React.CSSProperties> = {
  card: { display: 'flex', alignItems: 'center', gap: '12px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '10px', padding: '12px 14px' },
  cardArchived: { opacity: 0.5 },
  dotBtn: { background: 'none', border: 'none', padding: '4px', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' },
  dot: { width: '8px', height: '8px', borderRadius: '50%', flexShrink: 0, transition: 'background 0.2s' },
  titleWrap: { flex: 1, minWidth: 0 },
  title: { fontSize: '14px', fontWeight: 500, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'block' },
  titleDone: { textDecoration: 'line-through', color: 'var(--muted)' },
  titleArchived: { color: 'var(--muted)' },
  titleInput: { width: '100%', background: 'transparent', border: 'none', borderBottom: '1px solid var(--accent)', outline: 'none', fontSize: '14px', fontWeight: 500, color: 'var(--text)', fontFamily: 'inherit', padding: '0' },
  right: { display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 },
  date: { fontSize: '12px', color: 'var(--muted)' },
  menuWrap: { position: 'relative' },
  menuBtn: { background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: '16px', padding: '2px 6px', borderRadius: '4px', letterSpacing: '1px', lineHeight: '1' },
  menu: { position: 'absolute', right: 0, top: '100%', marginTop: '4px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '8px', padding: '4px', zIndex: 10, minWidth: '120px', boxShadow: '0 4px 16px rgba(0,0,0,0.3)' },
  menuItem: { display: 'block', width: '100%', background: 'none', border: 'none', color: 'var(--text)', fontSize: '13px', padding: '8px 12px', cursor: 'pointer', textAlign: 'left', borderRadius: '6px', fontFamily: 'inherit' },
}
