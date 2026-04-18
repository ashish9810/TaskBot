'use client'

import { useState, useRef, useEffect, useCallback } from 'react'

interface Message {
  id: string
  role: 'user' | 'assistant'
  text: string
}

// Raw history as sent to / received from the server (OpenAI/Groq-compatible shape).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type HistoryMsg = { role: 'user' | 'assistant' | 'tool'; content: string; tool_call_id?: string; tool_calls?: any }

export default function ChatBot({ onTasksChanged }: { onTasksChanged?: () => void }) {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 'welcome',
      role: 'assistant',
      text: "👋 Hey! I'm Ping, your task assistant. Talk to me naturally — I can create, move, update, or delete your tasks, or just tell you what's on your plate.\n\nTry: *\"create this task: draft Q1 roadmap\"* or *\"how many tasks in To Do?\"*"
    }
  ])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [history, setHistory] = useState<HistoryMsg[]>([])
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [])

  useEffect(() => {
    scrollToBottom()
  }, [messages, scrollToBottom])

  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  const refreshDashboard = useCallback(() => {
    onTasksChanged?.()
    window.dispatchEvent(new Event('tasks-changed'))
  }, [onTasksChanged])

  const addMessage = (role: 'user' | 'assistant', text: string) => {
    const msg: Message = { id: Date.now().toString() + Math.random(), role, text }
    setMessages(prev => [...prev, msg])
    return msg
  }

  const sendMessage = async () => {
    const text = input.trim()
    if (!text || loading) return

    setInput('')
    addMessage('user', text)
    setLoading(true)

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          history,
        })
      })

      const data = await res.json()

      if (Array.isArray(data.history)) {
        setHistory(data.history)
      }

      addMessage('assistant', data.reply || "…")

      if (data.executed) {
        refreshDashboard()
      }

    } catch {
      addMessage('assistant', "Sorry, something went wrong. Please try again.")
    } finally {
      setLoading(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  // Simple markdown-ish rendering: bold and bullet points
  const renderText = (text: string) => {
    return text.split('\n').map((line, i) => {
      // Bold
      const parts = line.split(/(\*[^*]+\*)/g).map((part, j) => {
        if (part.startsWith('*') && part.endsWith('*')) {
          return <strong key={j} style={{ fontWeight: 600, color: 'var(--text)' }}>{part.slice(1, -1)}</strong>
        }
        return <span key={j}>{part}</span>
      })

      // Bullet point
      if (line.startsWith('• ') || line.startsWith('- ')) {
        return <div key={i} style={{ paddingLeft: '12px', position: 'relative' }}>
          <span style={{ position: 'absolute', left: 0 }}>•</span>
          {parts}
        </div>
      }

      return <div key={i}>{parts}</div>
    })
  }

  return (
    <>
      {/* Floating button */}
      <button
        onClick={() => setOpen(v => !v)}
        style={{
          position: 'fixed',
          bottom: '24px',
          right: '24px',
          width: '56px',
          height: '56px',
          borderRadius: '50%',
          background: 'var(--accent, #7c5cfc)',
          border: 'none',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: '0 4px 20px rgba(124, 92, 252, 0.4)',
          zIndex: 1000,
          transition: 'transform 0.2s, box-shadow 0.2s',
          transform: open ? 'rotate(45deg)' : 'none',
        }}
      >
        {open ? (
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
            <path d="M12 5v14M5 12h14" stroke="white" strokeWidth="2.5" strokeLinecap="round" />
          </svg>
        ) : (
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none">
            <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </button>

      {/* Chat panel */}
      {open && (
        <div style={{
          position: 'fixed',
          bottom: '92px',
          right: '24px',
          width: '400px',
          height: '520px',
          background: 'var(--surface, #111120)',
          border: '1px solid var(--border, rgba(255,255,255,0.07))',
          borderRadius: '16px',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          zIndex: 999,
          boxShadow: '0 16px 48px rgba(0,0,0,0.5)',
          animation: 'popIn 0.2s ease',
        }}>
          {/* Header */}
          <div style={{
            padding: '16px 18px',
            borderBottom: '1px solid var(--border, rgba(255,255,255,0.07))',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            flexShrink: 0,
          }}>
            <div style={{
              width: '32px',
              height: '32px',
              borderRadius: '10px',
              background: 'var(--accent, #7c5cfc)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <div>
              <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text, #eeeef8)' }}>Ping Assistant</div>
              <div style={{ fontSize: '11px', color: 'var(--muted, #888)' }}>Ask me anything about your tasks</div>
            </div>
          </div>

          {/* Messages */}
          <div style={{
            flex: 1,
            overflowY: 'auto',
            padding: '16px',
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
            minHeight: 0,
          }}>
            {messages.map(msg => (
              <div key={msg.id} style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: msg.role === 'user' ? 'flex-end' : 'flex-start',
                gap: '6px',
              }}>
                <div style={{
                  maxWidth: '85%',
                  padding: '10px 14px',
                  borderRadius: msg.role === 'user' ? '14px 14px 4px 14px' : '14px 14px 14px 4px',
                  background: msg.role === 'user'
                    ? 'var(--accent, #7c5cfc)'
                    : 'var(--surface3, #1e1e32)',
                  color: msg.role === 'user' ? '#fff' : 'var(--text2, #ccc)',
                  fontSize: '13px',
                  lineHeight: 1.5,
                  wordBreak: 'break-word',
                }}>
                  {renderText(msg.text)}
                </div>
              </div>
            ))}

            {loading && (
              <div style={{
                display: 'flex',
                alignItems: 'flex-start',
              }}>
                <div style={{
                  padding: '10px 14px',
                  borderRadius: '14px 14px 14px 4px',
                  background: 'var(--surface3, #1e1e32)',
                  color: 'var(--muted, #888)',
                  fontSize: '13px',
                }}>
                  <span style={{ animation: 'pulse 1.5s infinite' }}>Thinking...</span>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <div style={{
            padding: '12px 16px',
            borderTop: '1px solid var(--border, rgba(255,255,255,0.07))',
            display: 'flex',
            gap: '8px',
            alignItems: 'flex-end',
            flexShrink: 0,
          }}>
            <textarea
              ref={inputRef}
              value={input}
              onChange={e => { setInput(e.target.value); e.target.style.height = 'auto'; e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px'; }}
              onKeyDown={handleKeyDown}
              placeholder="Ask me anything about your tasks..."
              disabled={loading}
              rows={1}
              style={{
                flex: 1,
                background: 'var(--surface2, #18182a)',
                border: '1px solid var(--border, rgba(255,255,255,0.07))',
                borderRadius: '10px',
                padding: '10px 14px',
                fontSize: '13px',
                color: 'var(--text, #eeeef8)',
                outline: 'none',
                fontFamily: 'inherit',
                resize: 'none',
                lineHeight: 1.5,
                minHeight: '40px',
                maxHeight: '120px',
                overflow: 'auto',
              }}
            />
            <button
              onClick={sendMessage}
              disabled={loading || !input.trim()}
              style={{
                width: '40px',
                height: '40px',
                borderRadius: '10px',
                background: input.trim() ? 'var(--accent, #7c5cfc)' : 'var(--surface3, #1e1e32)',
                border: 'none',
                cursor: input.trim() ? 'pointer' : 'default',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
                transition: 'background 0.15s',
              }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>
        </div>
      )}

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>
    </>
  )
}
