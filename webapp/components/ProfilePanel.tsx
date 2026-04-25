'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

const TEAMS = [
  'Product',
  'Engineering',
  'Sales',
  'Marketing',
  'Content',
  'Customer Support',
] as const

interface Props {
  open: boolean
  onClose: () => void
  name: string
  email: string
  team: string | null
}

function initialsOf(name: string, email: string): string {
  const source = (name || email || '?').trim()
  const parts = source.split(/\s+/).filter(Boolean)
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
  return source.slice(0, 2).toUpperCase()
}

export default function ProfilePanel({ open, onClose, name, email, team }: Props) {
  const router = useRouter()
  const [currentTeam, setCurrentTeam] = useState<string | null>(team ?? null)
  const [saving, setSaving] = useState(false)
  const [savedTick, setSavedTick] = useState(0)

  // Sync prop → state when panel opens (in case server data updates).
  useEffect(() => {
    if (open) setCurrentTeam(team ?? null)
  }, [open, team])

  // Close on Escape
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onClose])

  async function handleTeamChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const raw = e.target.value
    const next: string | null = raw === '' ? null : raw
    setCurrentTeam(next)
    setSaving(true)
    try {
      const res = await fetch('/api/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ team: next }),
      })
      if (!res.ok) {
        // Revert on error
        setCurrentTeam(team ?? null)
      } else {
        setSavedTick(t => t + 1)
        // Refresh server-rendered data so the dashboard reflects the new team
        // without a hard reload.
        router.refresh()
      }
    } catch {
      setCurrentTeam(team ?? null)
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      {/* Overlay */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.55)',
          opacity: open ? 1 : 0,
          pointerEvents: open ? 'auto' : 'none',
          transition: 'opacity 200ms ease',
          zIndex: 1000,
        }}
      />

      {/* Panel */}
      <aside
        aria-hidden={!open}
        style={{
          position: 'fixed',
          top: 0,
          right: 0,
          height: '100vh',
          width: '400px',
          maxWidth: '92vw',
          background: 'var(--surface)',
          borderLeft: '1px solid var(--border)',
          boxShadow: '-8px 0 24px rgba(0,0,0,0.4)',
          transform: open ? 'translateX(0)' : 'translateX(100%)',
          transition: 'transform 220ms ease-out',
          zIndex: 1001,
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '16px 20px',
            borderBottom: '1px solid var(--border)',
          }}
        >
          <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text)' }}>Profile</div>
          <button
            onClick={onClose}
            aria-label="Close profile panel"
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--muted)',
              cursor: 'pointer',
              fontSize: '20px',
              lineHeight: 1,
              padding: '4px 8px',
              borderRadius: '6px',
            }}
            onMouseEnter={e => (e.currentTarget.style.color = 'var(--text)')}
            onMouseLeave={e => (e.currentTarget.style.color = 'var(--muted)')}
          >
            ×
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: '24px 20px', overflowY: 'auto', flex: 1 }}>
          {/* Avatar + identity */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px', marginBottom: '28px' }}>
            <div
              style={{
                width: '64px',
                height: '64px',
                borderRadius: '50%',
                background: 'linear-gradient(135deg, #4F46E5, #6366F1)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '22px',
                fontWeight: 700,
                color: 'white',
                flexShrink: 0,
              }}
            >
              {initialsOf(name, email)}
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text)', lineHeight: 1.3 }}>
                {name || 'Unnamed'}
              </div>
              <div style={{ fontSize: '12px', color: 'var(--muted)', marginTop: '2px' }}>{email}</div>
            </div>
          </div>

          {/* Team field */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <label htmlFor="team-select" style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: '0.03em' }}>
                Team
              </label>
              {saving ? (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '11px', color: 'var(--muted)' }}>
                  <span
                    style={{
                      display: 'inline-block',
                      width: '11px',
                      height: '11px',
                      border: '2px solid var(--border2)',
                      borderTopColor: 'var(--accent-light)',
                      borderRadius: '50%',
                      animation: 'spin 0.7s linear infinite',
                    }}
                  />
                  Saving…
                </span>
              ) : savedTick > 0 ? (
                <span
                  key={savedTick}
                  style={{
                    fontSize: '11px',
                    color: 'var(--accent-light)',
                    animation: 'confirmFlash 1.2s ease',
                  }}
                >
                  ✓ Saved
                </span>
              ) : null}
            </div>
            <select
              id="team-select"
              value={currentTeam ?? ''}
              onChange={handleTeamChange}
              disabled={saving}
              style={{
                width: '100%',
                padding: '10px 12px',
                background: 'var(--surface2)',
                border: '1px solid var(--border)',
                borderRadius: '8px',
                color: 'var(--text)',
                fontSize: '13px',
                fontFamily: 'inherit',
                cursor: saving ? 'wait' : 'pointer',
                outline: 'none',
              }}
              onFocus={e => (e.currentTarget.style.borderColor = 'var(--accent)')}
              onBlur={e => (e.currentTarget.style.borderColor = 'var(--border)')}
            >
              <option value="">Select your team</option>
              {TEAMS.map(t => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
            <div style={{ fontSize: '11px', color: 'var(--muted)', marginTop: '4px', lineHeight: 1.5 }}>
              This helps your manager see team-wise tasks.
            </div>
          </div>
        </div>
      </aside>
    </>
  )
}
