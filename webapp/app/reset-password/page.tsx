'use client'

import { useState, useEffect, Suspense } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase-browser'

function ResetPasswordForm() {
  const router = useRouter()
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [errors, setErrors] = useState<{ password?: string; confirmPassword?: string; general?: string }>({})
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)
  const [sessionReady, setSessionReady] = useState(false)

  useEffect(() => {
    // Supabase exchanges the token from the URL hash automatically on the client.
    // We just need to wait for the session to be established.
    const supabase = createClient()
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) {
        setSessionReady(true)
      } else {
        // No session — the link may be invalid or expired
        router.replace('/login?error=reset_link_invalid')
      }
    })
  }, [router])

  function validate() {
    const e: typeof errors = {}
    if (!password) e.password = 'Please enter a new password.'
    else if (password.length < 6) e.password = 'Password must be at least 6 characters.'
    else if (password.trim().length === 0) e.password = 'Password cannot be only spaces.'
    if (!confirmPassword) e.confirmPassword = 'Please confirm your new password.'
    else if (password !== confirmPassword) e.confirmPassword = "Passwords don't match."
    return e
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const errs = validate()
    if (Object.keys(errs).length) { setErrors(errs); return }
    setErrors({})
    setLoading(true)

    const supabase = createClient()
    const { error } = await supabase.auth.updateUser({ password })

    if (error) {
      setLoading(false)
      const msg = error.message.toLowerCase()
      if (msg.includes('same password') || msg.includes('should be different')) {
        setErrors({ password: 'Your new password must be different from your current one.' })
      } else if (msg.includes('weak password') || msg.includes('password should')) {
        setErrors({ password: 'Please choose a stronger password (at least 6 characters).' })
      } else if (msg.includes('network') || msg.includes('fetch')) {
        setErrors({ general: 'Network error. Check your internet connection and try again.' })
      } else {
        setErrors({ general: 'Something went wrong. Please try again or request a new reset link.' })
      }
      return
    }

    setDone(true)
    setTimeout(() => router.push('/dashboard'), 2500)
  }

  if (!sessionReady) {
    return (
      <div style={s.page}>
        <div style={s.card}>
          <div style={s.logoRow}><span style={s.logo}>Ping</span></div>
          <div style={s.spinnerWrap}><span style={s.spinner} /></div>
          <p style={s.subtitle}>Verifying your reset link…</p>
        </div>
      </div>
    )
  }

  if (done) {
    return (
      <div style={s.page}>
        <div style={s.card}>
          <div style={s.logoRow}><span style={s.logo}>Ping</span></div>
          <div style={s.successIcon}>✅</div>
          <h1 style={s.title}>Password updated!</h1>
          <p style={s.subtitle}>Your password has been changed. Taking you to your dashboard…</p>
        </div>
      </div>
    )
  }

  return (
    <div style={s.page}>
      <div style={s.card}>
        <div style={s.logoRow}><span style={s.logo}>Ping</span></div>
        <h1 style={s.title}>Set a new password</h1>
        <p style={s.subtitle}>Choose a strong password you haven't used before.</p>

        <form onSubmit={handleSubmit} style={s.form} noValidate>
          <div style={s.field}>
            <label style={s.label}>New password</label>
            <div style={s.pwWrap}>
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={e => { setPassword(e.target.value); setErrors(p => ({ ...p, password: undefined })) }}
                placeholder="Min 6 characters"
                style={{ ...s.input, paddingRight: '44px', ...(errors.password ? s.inputErr : {}) }}
                autoComplete="new-password"
                autoFocus
              />
              <button type="button" onClick={() => setShowPassword(v => !v)} style={s.eyeBtn} tabIndex={-1}>
                {showPassword ? '🙈' : '👁️'}
              </button>
            </div>
            {errors.password && <p style={s.fieldErr}>{errors.password}</p>}
          </div>

          <div style={s.field}>
            <label style={s.label}>Confirm new password</label>
            <input
              type={showPassword ? 'text' : 'password'}
              value={confirmPassword}
              onChange={e => { setConfirmPassword(e.target.value); setErrors(p => ({ ...p, confirmPassword: undefined })) }}
              placeholder="Repeat your password"
              style={{ ...s.input, ...(errors.confirmPassword ? s.inputErr : {}) }}
              autoComplete="new-password"
            />
            {errors.confirmPassword && <p style={s.fieldErr}>{errors.confirmPassword}</p>}
          </div>

          {errors.general && (
            <div style={s.errBox}>
              <span>⚠️</span>
              <span>{errors.general}</span>
            </div>
          )}

          <button type="submit" disabled={loading} style={{ ...s.btn, ...(loading ? s.btnDisabled : {}) }}>
            {loading
              ? <span style={s.btnInner}><span style={s.spinner} />Updating password…</span>
              : 'Update password'}
          </button>
        </form>
      </div>
    </div>
  )
}

export default function ResetPasswordPage() {
  return <Suspense><ResetPasswordForm /></Suspense>
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
  label: { fontSize: '13px', fontWeight: 500, color: 'var(--muted)' },
  input: { background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: '8px', padding: '10px 14px', fontSize: '14px', color: 'var(--text)', outline: 'none', width: '100%', transition: 'border-color 0.2s', fontFamily: 'inherit' },
  inputErr: { borderColor: 'rgba(248,113,113,0.6)' },
  pwWrap: { position: 'relative' },
  eyeBtn: { position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', fontSize: '15px', padding: 0, lineHeight: 1 },
  fieldErr: { fontSize: '12px', color: '#f87171', marginTop: '2px' },
  errBox: { display: 'flex', gap: '10px', alignItems: 'flex-start', fontSize: '13px', color: '#fca5a5', background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.2)', borderRadius: '8px', padding: '12px 14px', lineHeight: 1.5 },
  btn: { background: 'var(--accent)', color: 'white', border: 'none', borderRadius: '8px', padding: '12px', fontSize: '15px', fontWeight: 600, cursor: 'pointer', marginTop: '4px', fontFamily: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'center' },
  btnDisabled: { opacity: 0.65, cursor: 'not-allowed' },
  btnInner: { display: 'flex', alignItems: 'center', gap: '8px' },
  spinner: { display: 'inline-block', width: '14px', height: '14px', border: '2px solid rgba(255,255,255,0.3)', borderTopColor: 'white', borderRadius: '50%', animation: 'spin 0.7s linear infinite', flexShrink: 0 },
  spinnerWrap: { display: 'flex', justifyContent: 'center', margin: '20px 0 12px' },
  successIcon: { fontSize: '40px', textAlign: 'center' as const, marginBottom: '16px' },
}
