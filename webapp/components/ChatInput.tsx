'use client'

import { useState, useRef, useEffect } from 'react'
import { Task } from '@/app/dashboard/DashboardClient'

type ParsedTask = {
  title: string
  assignee_hint: string | null
}

type Props = {
  workspaceId: string
  userId: string
  slackUserId: string | null
  onTaskCreated: (task: Task) => void
}

const SUGGESTIONS = [
  'Create Grammar PRD task',
  'Talk to HR about onboarding',
  'Review marketing deck',
  'Review documentation',
]

export default function ChatInput({ workspaceId, userId, slackUserId, onTaskCreated }: Props) {
  const [message, setMessage] = useState('')
  const [parsing, setParsing] = useState(false)
  const [pendingTasks, setPendingTasks] = useState<ParsedTask[]>([])
  const [error, setError] = useState('')
  const [creating, setCreating] = useState(false)
  const [focused, setFocused] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 160) + 'px'
  }, [message])

  async function handleSubmit(e?: React.FormEvent) {
    e?.preventDefault()
    if (!message.trim() || parsing) return

    setError('')
    setParsing(true)
    setPendingTasks([])

    try {
      const res = await fetch('/api/tasks/parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, members: [] }),
      })
      const data = await res.json()
      if (!res.ok || !data.tasks) {
        setError('Could not parse your message. Try rephrasing.')
        return
      }
      setPendingTasks(data.tasks)
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setParsing(false)
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }

  async function handleConfirm() {
    if (creating) return
    setCreating(true)
    setError('')

    for (const pt of pendingTasks) {
      try {
        const res = await fetch('/api/tasks/create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: pt.title }),
        })
        const task = await res.json()
        if (res.ok && task.id) onTaskCreated(task as Task)
      } catch {
        // continue
      }
    }

    setMessage('')
    setPendingTasks([])
    setCreating(false)
  }

  function handleCancel() {
    setPendingTasks([])
    setError('')
    setMessage('')
  }

  function handleEditPending(index: number, title: string) {
    setPendingTasks(prev => prev.map((t, i) => i === index ? { ...t, title } : t))
  }

  function handleRemovePending(index: number) {
    setPendingTasks(prev => prev.filter((_, i) => i !== index))
  }

  return (
    <div style={s.wrap}>
      {/* Glass morphism chat box */}
      <div style={{ ...s.box, ...(focused ? s.boxFocused : {}) }}>
        {/* Header label */}
        <div style={s.boxHeader}>
          <div style={s.aiDot} />
          <span style={s.boxLabel}>AI Task Assistant</span>
          <span style={s.boxHint}>Press Enter to add</span>
        </div>

        {/* Textarea */}
        <form onSubmit={handleSubmit}>
          <textarea
            ref={textareaRef}
            value={message}
            onChange={e => { setMessage(e.target.value); setError('') }}
            onKeyDown={handleKeyDown}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            placeholder={'Type tasks in plain English — e.g. "Create Grammar PRD, talk to HR, review marketing deck"'}
            style={s.textarea}
            disabled={parsing}
            rows={1}
          />

          {/* Suggestions */}
          {!message && !parsing && !pendingTasks.length && (
            <div style={s.suggestions}>
              {SUGGESTIONS.map((sg, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setMessage(sg)}
                  style={s.chip}
                >
                  {sg}
                </button>
              ))}
            </div>
          )}

          {/* Footer bar */}
          <div style={s.footer}>
            <span style={s.footerHint}>
              {parsing ? 'AI is parsing your tasks…' : 'Shift+Enter for new line · Enter to submit'}
            </span>
            <button
              type="submit"
              disabled={!message.trim() || parsing}
              style={{ ...s.sendBtn, ...(!message.trim() || parsing ? s.sendBtnDisabled : {}) }}
            >
              {parsing ? <Spinner /> : (
                <>
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                    <path d="M2 8h12M9 3l5 5-5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                  Add tasks
                </>
              )}
            </button>
          </div>
        </form>
      </div>

      {error && <p style={s.error}>{error}</p>}

      {/* Confirmation cards */}
      {pendingTasks.length > 0 && (
        <div style={s.confirmBox}>
          <div style={s.confirmHeader}>
            <div style={s.confirmIcon}>
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                <path d="M8 1l1.8 3.6L14 5.4l-3 2.9.7 4.1L8 10.4l-3.7 2 .7-4.1-3-2.9 4.2-.8L8 1z" fill="currentColor"/>
              </svg>
            </div>
            <span style={s.confirmTitle}>
              {pendingTasks.length === 1 ? 'AI found 1 task' : `AI found ${pendingTasks.length} tasks`} — review before adding
            </span>
          </div>

          <div style={s.pendingList}>
            {pendingTasks.map((pt, i) => (
              <div key={i} style={s.pendingCard}>
                <div style={s.pendingDot} />
                <input
                  value={pt.title}
                  onChange={e => handleEditPending(i, e.target.value)}
                  style={s.pendingInput}
                  placeholder="Task title"
                />
                {pt.assignee_hint && pt.assignee_hint !== 'me' && (
                  <span style={s.assigneeChip}>{pt.assignee_hint}</span>
                )}
                <button onClick={() => handleRemovePending(i)} style={s.removeBtn} title="Remove">
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                    <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                  </svg>
                </button>
              </div>
            ))}
          </div>

          <div style={s.confirmActions}>
            <button onClick={handleCancel} style={s.cancelBtn}>Cancel</button>
            <button
              onClick={handleConfirm}
              disabled={creating || pendingTasks.every(t => !t.title.trim())}
              style={{ ...s.confirmBtn, ...(creating ? s.confirmBtnDisabled : {}) }}
            >
              {creating ? (
                <><Spinner />&nbsp;Adding…</>
              ) : (
                <>
                  <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
                    <path d="M2.5 8l4 4 7-7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                  Add {pendingTasks.length > 1 ? `${pendingTasks.length} tasks` : 'task'}
                </>
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function Spinner() {
  return (
    <span style={{
      display: 'inline-block', width: '12px', height: '12px',
      border: '2px solid rgba(255,255,255,0.3)', borderTopColor: 'white',
      borderRadius: '50%', animation: 'spin 0.7s linear infinite', flexShrink: 0,
    }} />
  )
}

const s: Record<string, React.CSSProperties> = {
  wrap: { marginBottom: '24px' },

  box: {
    background: 'rgba(255,255,255,0.03)',
    backdropFilter: 'blur(12px)',
    WebkitBackdropFilter: 'blur(12px)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: '16px',
    overflow: 'hidden',
    transition: 'border-color 0.2s, box-shadow 0.2s',
  },
  boxFocused: {
    borderColor: 'rgba(124,92,252,0.5)',
    boxShadow: '0 0 0 3px rgba(124,92,252,0.1), 0 8px 32px rgba(0,0,0,0.3)',
  },
  boxHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '12px 16px 0',
  },
  aiDot: {
    width: '7px',
    height: '7px',
    borderRadius: '50%',
    background: 'var(--accent)',
    boxShadow: '0 0 6px var(--accent)',
    flexShrink: 0,
  },
  boxLabel: {
    fontSize: '11px',
    fontWeight: 600,
    color: 'var(--accent)',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.08em',
    flex: 1,
  },
  boxHint: {
    fontSize: '11px',
    color: 'var(--muted)',
    opacity: 0.6,
  },
  textarea: {
    width: '100%',
    background: 'transparent',
    border: 'none',
    outline: 'none',
    resize: 'none' as const,
    fontSize: '14px',
    color: 'var(--text)',
    fontFamily: 'inherit',
    lineHeight: 1.6,
    padding: '12px 16px',
    minHeight: '48px',
    maxHeight: '160px',
    overflowY: 'auto' as const,
  },
  suggestions: {
    display: 'flex',
    flexWrap: 'wrap' as const,
    gap: '6px',
    padding: '0 16px 12px',
  },
  chip: {
    background: 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: '100px',
    padding: '4px 12px',
    fontSize: '12px',
    color: 'var(--muted)',
    cursor: 'pointer',
    fontFamily: 'inherit',
    whiteSpace: 'nowrap' as const,
  },
  footer: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '10px 12px 12px',
    borderTop: '1px solid rgba(255,255,255,0.05)',
  },
  footerHint: {
    fontSize: '11px',
    color: 'var(--muted)',
    opacity: 0.6,
  },
  sendBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    background: 'var(--accent)',
    color: 'white',
    border: 'none',
    borderRadius: '8px',
    padding: '7px 14px',
    fontSize: '13px',
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  sendBtnDisabled: { opacity: 0.4, cursor: 'not-allowed' },
  error: { fontSize: '13px', color: '#f87171', marginTop: '8px', paddingLeft: '4px' },

  confirmBox: {
    marginTop: '10px',
    background: 'rgba(124,92,252,0.06)',
    border: '1px solid rgba(124,92,252,0.2)',
    borderRadius: '14px',
    overflow: 'hidden',
  },
  confirmHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '12px 16px',
    borderBottom: '1px solid rgba(124,92,252,0.12)',
  },
  confirmIcon: {
    width: '24px',
    height: '24px',
    borderRadius: '6px',
    background: 'rgba(124,92,252,0.2)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: 'var(--accent)',
    flexShrink: 0,
  },
  confirmTitle: { fontSize: '13px', fontWeight: 600, color: 'var(--text)' },
  pendingList: { display: 'flex', flexDirection: 'column', gap: '4px', padding: '10px 12px' },
  pendingCard: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    background: 'rgba(255,255,255,0.03)',
    border: '1px solid rgba(255,255,255,0.06)',
    borderRadius: '8px',
    padding: '9px 12px',
  },
  pendingDot: {
    width: '6px', height: '6px', borderRadius: '50%',
    background: 'var(--accent)', flexShrink: 0, opacity: 0.7,
  },
  pendingInput: {
    flex: 1,
    background: 'transparent',
    border: 'none',
    outline: 'none',
    fontSize: '13.5px',
    color: 'var(--text)',
    fontFamily: 'inherit',
  },
  assigneeChip: {
    fontSize: '11px',
    color: 'var(--accent)',
    background: 'rgba(124,92,252,0.15)',
    borderRadius: '100px',
    padding: '2px 8px',
    whiteSpace: 'nowrap' as const,
    flexShrink: 0,
  },
  removeBtn: {
    background: 'none', border: 'none', color: 'var(--muted)',
    cursor: 'pointer', display: 'flex', alignItems: 'center',
    padding: '3px', borderRadius: '4px', flexShrink: 0, opacity: 0.6,
  },
  confirmActions: {
    display: 'flex', justifyContent: 'flex-end', gap: '8px',
    padding: '10px 12px 12px', borderTop: '1px solid rgba(255,255,255,0.05)',
  },
  cancelBtn: {
    background: 'none', border: '1px solid var(--border)', borderRadius: '8px',
    color: 'var(--muted)', fontSize: '13px', padding: '7px 14px',
    cursor: 'pointer', fontFamily: 'inherit',
  },
  confirmBtn: {
    display: 'flex', alignItems: 'center', gap: '6px',
    background: 'var(--accent)', color: 'white', border: 'none',
    borderRadius: '8px', fontSize: '13px', fontWeight: 600,
    padding: '7px 16px', cursor: 'pointer', fontFamily: 'inherit',
  },
  confirmBtnDisabled: { opacity: 0.5, cursor: 'not-allowed' },
}
