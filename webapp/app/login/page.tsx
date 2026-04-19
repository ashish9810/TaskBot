'use client'

import { useState, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase-browser'
import RouteProgressBar from '@/components/RouteProgressBar'

function LoginForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const message = searchParams.get('message')
  const errorParam = searchParams.get('error')
  const nextUrl = searchParams.get('next') || '/dashboard'

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [errors, setErrors] = useState<{ email?: string; password?: string; general?: string }>({})
  const [loading, setLoading] = useState(false)
  const [resendCooldown, setResendCooldown] = useState(0)
  const [resendEmail, setResendEmail] = useState('')

  // Map URL error params to user-friendly messages
  const urlError =
    errorParam === 'auth_failed'
      ? 'That sign-in link has expired or is invalid. Please try signing in again.'
      : errorParam === 'reset_link_invalid'
      ? 'That password reset link has expired or already been used. Request a new one below.'
      : null

  function validate() {
    const e: typeof errors = {}
    if (!email.trim()) e.email = 'Please enter your email address.'
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) e.email = "That doesn't look like a valid email."
    if (!password) e.password = 'Please enter your password.'
    return e
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    const errs = validate()
    if (Object.keys(errs).length) { setErrors(errs); return }
    setErrors({})
    setLoading(true)

    const supabase = createClient()

    try {
      // Check if account exists first
      const checkRes = await fetch('/api/auth/check-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      })
      const { exists } = await checkRes.json()

      if (!exists) {
        setLoading(false)
        setErrors({ general: 'no-account' })
        return
      }

      // Account exists — attempt login
      const { data, error } = await supabase.auth.signInWithPassword({ email, password })

      if (error) {
        setLoading(false)
        const msg = error.message.toLowerCase()

        if (msg.includes('email not confirmed')) {
          setResendEmail(email)
          setErrors({ general: 'unconfirmed' })
        } else if (msg.includes('too many requests') || msg.includes('rate limit') || msg.includes('over_email_send_rate_limit')) {
          setErrors({ general: 'Too many attempts. Please wait a minute and try again.' })
        } else {
          setErrors({ password: "Incorrect password. Try again or reset your password." })
        }
        return
      }

      // Sync Slack identity server-side (bypasses RLS)
      await fetch('/api/auth/sync-slack', { method: 'POST' })
      router.push(nextUrl)
      router.refresh()
    } catch {
      setLoading(false)
      setErrors({ general: 'Network error. Check your internet connection and try again.' })
    }
  }

  const [forgotLoading, setForgotLoading] = useState(false)

  async function handleForgotPassword() {
    if (!email.trim()) {
      setErrors({ email: 'Enter your email above first, then click "Forgot password?".' })
      return
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setErrors({ email: "That doesn't look like a valid email." })
      return
    }

    setForgotLoading(true)
    const supabase = createClient()

    try {
      const appUrl = process.env.NEXT_PUBLIC_APP_URL || window.location.origin
      await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${appUrl}/auth/callback?type=recovery`,
      })
      router.push(`/login?message=If an account exists with ${email}, we've sent a password reset link. Check your inbox (and spam folder).`)
    } catch {
      setForgotLoading(false)
      setErrors({ general: 'Network error. Check your internet connection and try again.' })
    }
  }

  async function handleResendConfirmation() {
    if (resendCooldown > 0) return
    const supabase = createClient()
    await supabase.auth.resend({ type: 'signup', email: resendEmail })
    setResendCooldown(60)
    const interval = setInterval(() => {
      setResendCooldown(prev => {
        if (prev <= 1) { clearInterval(interval); return 0 }
        return prev - 1
      })
    }, 1000)
  }

  return (
    <div style={s.page}>
      <div style={s.card}>
        <div style={s.logoRow}><Link href="/home" style={{ textDecoration: 'none' }}><span style={s.logo}>Ping</span></Link></div>
        <h1 style={s.title}>Welcome back</h1>
        <p style={s.subtitle}>Sign in to your account</p>

        {urlError && (
          <div style={s.errBox}>
            <span>⚠️</span>
            <span>{urlError}</span>
          </div>
        )}

        {message && (
          <div style={s.infoBox}>
            <span>✉️</span>
            <span>{message}</span>
          </div>
        )}

        <form onSubmit={handleLogin} style={s.form} noValidate>
          <div style={s.field}>
            <label style={s.label}>Email</label>
            <input
              type="email"
              value={email}
              onChange={e => { setEmail(e.target.value); setErrors(p => ({ ...p, email: undefined, general: undefined })) }}
              placeholder="you@company.com"
              style={{ ...s.input, ...(errors.email ? s.inputErr : {}) }}
              autoComplete="email"
              autoFocus
            />
            {errors.email && <p style={s.fieldErr}>{errors.email}</p>}
          </div>

          <div style={s.field}>
            <div style={s.labelRow}>
              <label style={s.label}>Password</label>
              <button type="button" onClick={handleForgotPassword} disabled={forgotLoading} style={{ ...s.forgotBtn, opacity: forgotLoading ? 0.5 : 1 }}>{forgotLoading ? 'Sending...' : 'Forgot password?'}</button>
            </div>
            <div style={s.pwWrap}>
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={e => { setPassword(e.target.value); setErrors(p => ({ ...p, password: undefined, general: undefined })) }}
                placeholder="••••••••"
                style={{ ...s.input, paddingRight: '44px', ...(errors.password ? s.inputErr : {}) }}
                autoComplete="current-password"
              />
              <button type="button" onClick={() => setShowPassword(v => !v)} style={s.eyeBtn} tabIndex={-1}>
                {showPassword ? '🙈' : '👁️'}
              </button>
            </div>
            {errors.password && <p style={s.fieldErr}>{errors.password}</p>}
          </div>

          {errors.general && errors.general !== 'no-account' && errors.general !== 'unconfirmed' && (
            <div style={s.errBox}>
              <span>⚠️</span>
              <span>{errors.general}</span>
            </div>
          )}

          {errors.general === 'unconfirmed' && (
            <div style={s.infoBox}>
              <div style={{ display: 'flex', flexDirection: 'column' as const, gap: '10px', width: '100%' }}>
                <span>You haven&apos;t verified your email yet. Check your inbox for the confirmation link we sent when you signed up.</span>
                <button
                  type="button"
                  onClick={handleResendConfirmation}
                  disabled={resendCooldown > 0}
                  style={{ ...s.resendBtn, ...(resendCooldown > 0 ? s.resendBtnDisabled : {}) }}
                >
                  {resendCooldown > 0 ? `Resend in ${resendCooldown}s` : 'Resend confirmation email'}
                </button>
              </div>
            </div>
          )}

          {errors.general === 'no-account' && (
            <div style={s.noAccountBox}>
              <p style={s.noAccountText}>
                No account found with <strong style={{ color: 'var(--text)' }}>{email}</strong>. Please sign up first.
              </p>
              <Link href={`/signup?email=${encodeURIComponent(email)}`} style={s.signupCta}>
                Create a free account →
              </Link>
            </div>
          )}

          <button type="submit" disabled={loading} style={{ ...s.btn, ...(loading ? s.btnDisabled : {}) }}>
            {loading
              ? <span style={s.btnInner}><span style={s.spinner} />Signing in…</span>
              : 'Sign in'}
          </button>
        </form>

        <p style={s.switchText}>
          Don&apos;t have an account?{' '}
          <Link href="/signup" style={s.link}>Create one free</Link>
        </p>
      </div>

      {loading && (
        <div style={s.overlay}>
          <div style={s.overlaySpinner} />
          <p style={s.overlayText}>Signing you in…</p>
        </div>
      )}
    </div>
  )
}

export default function LoginPage() {
  return <><RouteProgressBar /><Suspense><LoginForm /></Suspense></>
}

const s: Record<string, React.CSSProperties> = {
  page: { minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)', padding: '24px' },
  card: { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '18px', padding: '40px', width: '100%', maxWidth: '400px' },
  logoRow: { marginBottom: '28px' },
  logo: { fontSize: '18px', fontWeight: 700, letterSpacing: '-0.03em', color: 'var(--text)' },
  title: { fontSize: '22px', fontWeight: 700, letterSpacing: '-0.03em', color: 'var(--text)', marginBottom: '4px' },
  subtitle: { fontSize: '14px', color: 'var(--muted)', marginBottom: '28px' },
  form: { display: 'flex', flexDirection: 'column', gap: '18px' },
  field: { display: 'flex', flexDirection: 'column', gap: '6px' },
  labelRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  label: { fontSize: '13px', fontWeight: 500, color: 'var(--muted)' },
  forgotBtn: { background: 'none', border: 'none', color: 'var(--accent)', fontSize: '12px', cursor: 'pointer', padding: 0, fontFamily: 'inherit' },
  input: { background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: '8px', padding: '10px 14px', fontSize: '14px', color: 'var(--text)', outline: 'none', width: '100%', transition: 'border-color 0.2s', fontFamily: 'inherit' },
  inputErr: { borderColor: 'rgba(185,28,28,0.5)' },
  pwWrap: { position: 'relative' },
  eyeBtn: { position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', fontSize: '15px', padding: 0, lineHeight: 1 },
  fieldErr: { fontSize: '12px', color: '#f87171', marginTop: '2px' },
  errBox: { display: 'flex', gap: '10px', alignItems: 'flex-start', fontSize: '13px', color: "#B91C1C", background: "rgba(185,28,28,0.06)", border: "1px solid rgba(185,28,28,0.25)", borderRadius: '8px', padding: '12px 14px', lineHeight: 1.5 },
  infoBox: { display: 'flex', gap: '10px', alignItems: 'flex-start', fontSize: '13px', color: 'var(--text2)', background: 'rgba(224,108,77,0.08)', border: '1px solid rgba(224,108,77,0.25)', borderRadius: '8px', padding: '12px 14px', marginBottom: '4px', lineHeight: 1.5 },
  btn: { background: 'var(--accent)', color: 'white', border: 'none', borderRadius: '8px', padding: '12px', fontSize: '15px', fontWeight: 600, cursor: 'pointer', marginTop: '4px', fontFamily: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'center' },
  btnDisabled: { opacity: 0.65, cursor: 'not-allowed' },
  btnInner: { display: 'flex', alignItems: 'center', gap: '8px' },
  spinner: { display: 'inline-block', width: '14px', height: '14px', border: '2px solid rgba(255,255,255,0.3)', borderTopColor: 'white', borderRadius: '50%', animation: 'spin 0.7s linear infinite', flexShrink: 0 },
  switchText: { marginTop: '24px', textAlign: 'center', fontSize: '14px', color: 'var(--muted)' },
  link: { color: 'var(--accent)', textDecoration: 'none', fontWeight: 500 },
  noAccountBox: { background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: '8px', padding: '14px 16px', display: 'flex', flexDirection: 'column' as const, gap: '10px' },
  noAccountText: { fontSize: '13px', color: 'var(--muted)', lineHeight: 1.5 },
  signupCta: { fontSize: '14px', fontWeight: 600, color: 'var(--accent)', textDecoration: 'none' },
  resendBtn: { background: 'rgba(224,108,77,0.15)', border: '1px solid rgba(224,108,77,0.3)', borderRadius: '6px', padding: '8px 12px', fontSize: '12px', color: 'var(--text2)', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'center' as const, transition: 'opacity 0.2s' },
  resendBtnDisabled: { opacity: 0.5, cursor: 'not-allowed' },
  overlay: { position: 'fixed', inset: 0, background: 'rgba(31,29,24,0.35)', display: 'flex', flexDirection: 'column' as const, alignItems: 'center', justifyContent: 'center', gap: '16px', zIndex: 50 },
  overlaySpinner: { width: '32px', height: '32px', border: '3px solid rgba(224, 108, 77, 0.25)', borderTopColor: '#E06C4D', borderRadius: '50%', animation: 'spin 0.7s linear infinite' },
  overlayText: { fontSize: '15px', fontWeight: 500, color: 'rgba(238, 238, 248, 0.85)', letterSpacing: '-0.01em' },
}
