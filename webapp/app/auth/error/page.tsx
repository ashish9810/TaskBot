'use client'

import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'

function AuthErrorContent() {
  const searchParams = useSearchParams()
  const reason = searchParams.get('reason')

  const isExpired = reason === 'link_expired'

  const title = isExpired ? 'Link expired' : 'Something went wrong'
  const description = isExpired
    ? 'This confirmation or reset link has expired or has already been used. Links are only valid for 24 hours and can only be clicked once.'
    : 'We weren\'t able to complete the sign-in. This can happen if the link is invalid or has already been used.'

  return (
    <div style={s.page}>
      <div style={s.card}>
        <div style={s.logoRow}><span style={s.logo}>Ping</span></div>
        <div style={s.icon}>{isExpired ? '⏰' : '⚠️'}</div>
        <h1 style={s.title}>{title}</h1>
        <p style={s.desc}>{description}</p>

        <div style={s.actions}>
          <Link href="/login" style={s.primaryBtn}>Go to sign in</Link>
          {isExpired && (
            <Link href="/signup" style={s.secondaryBtn}>Create a new account</Link>
          )}
        </div>

        <p style={s.hint}>
          If you were trying to reset your password, use the <strong>&quot;Forgot password?&quot;</strong> link on the sign-in page to get a fresh link.
        </p>
      </div>
    </div>
  )
}

export default function AuthErrorPage() {
  return <Suspense><AuthErrorContent /></Suspense>
}

const s: Record<string, React.CSSProperties> = {
  page: { minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)', padding: '24px' },
  card: { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '18px', padding: '40px', width: '100%', maxWidth: '400px', textAlign: 'center' as const },
  logoRow: { marginBottom: '28px', textAlign: 'left' as const },
  logo: { fontSize: '18px', fontWeight: 700, letterSpacing: '-0.03em', color: 'var(--text)' },
  icon: { fontSize: '40px', marginBottom: '16px' },
  title: { fontSize: '22px', fontWeight: 700, letterSpacing: '-0.03em', color: 'var(--text)', marginBottom: '12px' },
  desc: { fontSize: '14px', color: 'var(--muted)', lineHeight: 1.65, marginBottom: '28px' },
  actions: { display: 'flex', flexDirection: 'column' as const, gap: '10px', marginBottom: '24px' },
  primaryBtn: { background: 'var(--accent)', color: 'white', border: 'none', borderRadius: '8px', padding: '12px', fontSize: '15px', fontWeight: 600, textDecoration: 'none', display: 'block' },
  secondaryBtn: { background: 'var(--surface2)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: '8px', padding: '11px', fontSize: '14px', fontWeight: 500, textDecoration: 'none', display: 'block' },
  hint: { fontSize: '12px', color: 'var(--muted)', lineHeight: 1.6, background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: '8px', padding: '12px 14px', textAlign: 'left' as const },
}
