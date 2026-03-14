'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

type Props = {
  token: string
  workspaceName: string
  isLoggedIn: boolean
  userId: string | null
}

export default function JoinClient({ token, workspaceName, isLoggedIn, userId }: Props) {
  const router = useRouter()
  const [joining, setJoining] = useState(false)
  const [error, setError] = useState('')

  async function handleJoin() {
    if (!userId) return
    setJoining(true)
    setError('')

    try {
      const res = await fetch('/api/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      })

      if (res.status === 409) {
        setError("You're already in a workspace. You can only belong to one workspace for now.")
        setJoining(false)
        return
      }

      if (res.status === 404) {
        setError('This invite link is no longer valid. Ask your teammate for a new one.')
        setJoining(false)
        return
      }

      if (!res.ok) {
        setError('Something went wrong. Please try again.')
        setJoining(false)
        return
      }

      router.push('/dashboard')
      router.refresh()
    } catch {
      setError('Something went wrong. Please try again.')
      setJoining(false)
    }
  }

  return (
    <div style={s.page}>
      <div style={s.card}>
        <div style={s.logo}>Ping</div>

        <div style={s.iconWrap}>
          <div style={s.icon}>P</div>
        </div>

        <h1 style={s.title}>You&apos;re invited to join</h1>
        <p style={s.workspaceName}>{workspaceName}</p>
        <p style={s.subtitle}>Task tracking for your team — simple and fast.</p>

        {error && <div style={s.errorBox}>{error}</div>}

        {isLoggedIn ? (
          <button
            onClick={handleJoin}
            disabled={joining}
            style={{ ...s.btn, ...(joining ? s.btnDisabled : {}) }}
          >
            {joining ? 'Joining…' : `Join ${workspaceName}`}
          </button>
        ) : (
          <div style={s.authBtns}>
            <Link
              href={`/signup?next=/join/${token}`}
              style={s.btn}
            >
              Sign up to join
            </Link>
            <Link
              href={`/login?next=/join/${token}`}
              style={s.btnSecondary}
            >
              I already have an account
            </Link>
          </div>
        )}
      </div>
    </div>
  )
}

const s: Record<string, React.CSSProperties> = {
  page: { minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)', padding: '24px' },
  card: { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '18px', padding: '40px', width: '100%', maxWidth: '420px', textAlign: 'center' as const },
  logo: { fontSize: '18px', fontWeight: 700, letterSpacing: '-0.03em', color: 'var(--text)', marginBottom: '28px' },
  iconWrap: { display: 'flex', justifyContent: 'center', marginBottom: '20px' },
  icon: { width: '56px', height: '56px', borderRadius: '14px', background: 'linear-gradient(135deg, #7c5cfc, #a78bfa)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '24px', fontWeight: 700, color: 'white' },
  title: { fontSize: '18px', fontWeight: 600, color: 'var(--text)', marginBottom: '6px' },
  workspaceName: { fontSize: '22px', fontWeight: 700, color: 'var(--text)', letterSpacing: '-0.02em', marginBottom: '8px' },
  subtitle: { fontSize: '14px', color: 'var(--muted)', marginBottom: '28px', lineHeight: 1.5 },
  errorBox: { background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.2)', borderRadius: '8px', padding: '12px 14px', fontSize: '13px', color: '#fca5a5', marginBottom: '16px', textAlign: 'left' as const, lineHeight: 1.5 },
  btn: { display: 'block', width: '100%', background: 'var(--accent)', color: 'white', border: 'none', borderRadius: '10px', padding: '13px', fontSize: '15px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', textDecoration: 'none', textAlign: 'center' as const, marginBottom: '10px' },
  btnDisabled: { opacity: 0.6, cursor: 'not-allowed' },
  btnSecondary: { display: 'block', width: '100%', background: 'none', color: 'var(--muted)', border: '1px solid var(--border)', borderRadius: '10px', padding: '13px', fontSize: '14px', fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit', textDecoration: 'none', textAlign: 'center' as const },
  authBtns: { display: 'flex', flexDirection: 'column' as const, gap: '8px' },
}
