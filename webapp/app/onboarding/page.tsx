'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function OnboardingPage() {
  const router = useRouter()
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) { setError('Please enter a workspace name.'); return }
    if (trimmed.length < 2) { setError('Name must be at least 2 characters.'); return }

    setError('')
    setLoading(true)

    try {
      const res = await fetch('/api/workspaces', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Something went wrong. Please try again.')
        setLoading(false)
        return
      }
      window.location.href = '/dashboard'
    } catch {
      setError('Something went wrong. Please try again.')
      setLoading(false)
    }
  }

  return (
    <div style={s.page}>
      <div style={s.card}>
        <div style={s.logoRow}><span style={s.logo}>Ping</span></div>
        <h1 style={s.title}>Name your workspace</h1>
        <p style={s.subtitle}>This is where your team's tasks will live. You can change it later.</p>

        <form onSubmit={handleSubmit} style={s.form} noValidate>
          <div style={s.field}>
            <label style={s.label}>Workspace name</label>
            <input
              type="text"
              value={name}
              onChange={e => { setName(e.target.value); setError('') }}
              placeholder="e.g. Stablemoney, My Team, Personal"
              style={{ ...s.input, ...(error ? s.inputErr : {}) }}
              autoFocus
              autoComplete="off"
            />
            {error && <p style={s.fieldErr}>{error}</p>}
          </div>

          <button
            type="submit"
            disabled={loading}
            style={{ ...s.btn, ...(loading ? s.btnDisabled : {}) }}
          >
            {loading
              ? <span style={s.btnInner}><span style={s.spinner} />Creating…</span>
              : 'Create workspace'}
          </button>
        </form>
      </div>
    </div>
  )
}

const s: Record<string, React.CSSProperties> = {
  page: { minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)', padding: '24px' },
  card: { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '18px', padding: '40px', width: '100%', maxWidth: '400px' },
  logoRow: { marginBottom: '28px' },
  logo: { fontSize: '18px', fontWeight: 700, letterSpacing: '-0.03em', color: 'var(--text)' },
  title: { fontSize: '22px', fontWeight: 700, letterSpacing: '-0.03em', color: 'var(--text)', marginBottom: '6px' },
  subtitle: { fontSize: '14px', color: 'var(--muted)', marginBottom: '28px', lineHeight: 1.5 },
  form: { display: 'flex', flexDirection: 'column', gap: '20px' },
  field: { display: 'flex', flexDirection: 'column', gap: '6px' },
  label: { fontSize: '13px', fontWeight: 500, color: 'var(--muted)' },
  input: { background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: '8px', padding: '10px 14px', fontSize: '14px', color: 'var(--text)', outline: 'none', width: '100%', fontFamily: 'inherit' },
  inputErr: { borderColor: 'rgba(248,113,113,0.6)' },
  fieldErr: { fontSize: '12px', color: '#f87171', marginTop: '2px' },
  btn: { background: 'var(--accent)', color: 'white', border: 'none', borderRadius: '8px', padding: '12px', fontSize: '15px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'center' },
  btnDisabled: { opacity: 0.65, cursor: 'not-allowed' },
  btnInner: { display: 'flex', alignItems: 'center', gap: '8px' },
  spinner: { display: 'inline-block', width: '14px', height: '14px', border: '2px solid rgba(255,255,255,0.3)', borderTopColor: 'white', borderRadius: '50%', animation: 'spin 0.7s linear infinite', flexShrink: 0 },
}
