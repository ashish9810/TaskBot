'use client'

import { useState, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase-browser'
import RouteProgressBar from '@/components/RouteProgressBar'

type Screen = 'form' | 'check-email'

function SignupForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const prefillEmail = searchParams.get('email') || ''
  const nextUrl = searchParams.get('next') || '/dashboard'

  const [screen, setScreen] = useState<Screen>('form')
  const [name, setName] = useState('')
  const [email, setEmail] = useState(prefillEmail)
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [errors, setErrors] = useState<{ name?: string; email?: string; password?: string; general?: string }>({})
  const [loading, setLoading] = useState(false)
  const [resendCooldown, setResendCooldown] = useState(0)

  function validate() {
    const e: typeof errors = {}
    if (!name.trim()) e.name = 'Please enter your name.'
    if (!email.trim()) e.email = 'Please enter your email address.'
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) e.email = "That doesn't look like a valid email."
    if (!password) e.password = 'Please choose a password.'
    else if (password.length < 6) e.password = 'Password must be at least 6 characters.'
    return e
  }

  async function handleSignup(e: React.FormEvent) {
    e.preventDefault()
    const errs = validate()
    if (Object.keys(errs).length) { setErrors(errs); return }
    setErrors({})
    setLoading(true)

    const supabase = createClient()
    let data, error
    try {
      const appUrl = process.env.NEXT_PUBLIC_APP_URL || window.location.origin
      const result = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { name },
          emailRedirectTo: `${appUrl}/auth/callback`,
        },
      })
      data = result.data
      error = result.error
    } catch {
      setLoading(false)
      setErrors({ general: 'Network error. Check your internet connection and try again.' })
      return
    }

    if (error) {
      setLoading(false)
      const msg = error.message.toLowerCase()
      if (msg.includes('already registered') || msg.includes('already exists') || msg.includes('user already')) {
        setErrors({
          general: `An account with ${email} already exists. Try signing in instead, or reset your password if you've forgotten it.`,
        })
      } else if (msg.includes('invalid email')) {
        setErrors({ email: "That email address isn't valid. Please double-check it." })
      } else if (msg.includes('weak password') || msg.includes('password should')) {
        setErrors({ password: 'Please choose a stronger password (at least 6 characters).' })
      } else if (msg.includes('too many requests') || msg.includes('rate limit') || msg.includes('over_email_send_rate_limit')) {
        setErrors({ general: 'Too many attempts. Please wait a minute and try again.' })
      } else {
        setErrors({ general: 'Something went wrong on our end. Please try again in a moment.' })
      }
      return
    }

    // Supabase returns a session if email confirmation is disabled, or null if confirmation is required
    if (data.session) {
      // Email confirmation disabled — user is logged in immediately
      if (data.user) {
        await supabase.from('profiles').upsert({ id: data.user.id, email, name })
        await fetch('/api/auth/sync-slack', { method: 'POST' })
      }
      router.push(nextUrl)
      router.refresh()
    } else {
      // Email confirmation required — show check email screen
      setLoading(false)
      setScreen('check-email')
    }
  }

  async function handleResend() {
    if (resendCooldown > 0) return
    const supabase = createClient()
    await supabase.auth.resend({ type: 'signup', email })
    // Start 60-second cooldown
    setResendCooldown(60)
    const interval = setInterval(() => {
      setResendCooldown(prev => {
        if (prev <= 1) { clearInterval(interval); return 0 }
        return prev - 1
      })
    }, 1000)
  }

  // ── Check email screen ──
  if (screen === 'check-email') {
    return (
      <div style={s.page}>
        <div style={s.card}>
          <div style={s.emailIcon}>✉️</div>
          <h1 style={s.title}>Check your inbox</h1>
          <p style={s.emailDesc}>
            We sent a confirmation link to <strong style={{ color: 'var(--text)' }}>{email}</strong>.
            Click that link to activate your account and get started.
          </p>

          <div style={s.steps}>
            <div style={s.step}><span style={s.stepNum}>1</span> Open your email app</div>
            <div style={s.step}><span style={s.stepNum}>2</span> Find the email from Ping</div>
            <div style={s.step}><span style={s.stepNum}>3</span> Click <strong>&quot;Confirm your email&quot;</strong></div>
          </div>

          <div style={s.divider} />

          <p style={s.resendText}>Didn&apos;t get it? Check your spam folder, or</p>
          <button
            onClick={handleResend}
            disabled={resendCooldown > 0}
            style={{ ...s.resendBtn, ...(resendCooldown > 0 ? s.resendBtnDisabled : {}) }}
          >
            {resendCooldown > 0 ? `Resend in ${resendCooldown}s` : 'Resend confirmation email'}
          </button>

          <p style={s.switchText}>
            Wrong email?{' '}
            <button onClick={() => setScreen('form')} style={s.backBtn}>Go back</button>
          </p>
        </div>
      </div>
    )
  }

  // ── Signup form ──
  return (
    <div style={s.page}>
      <div style={s.card}>
        <div style={s.logoRow}><a href="/home" style={{ textDecoration: 'none' }}><span style={s.logo}>Ping</span></a></div>
        <h1 style={s.title}>Create your account</h1>
        <p style={s.subtitle}>Free to get started — no credit card needed</p>

        <form onSubmit={handleSignup} style={s.form} noValidate>
          <div style={s.field}>
            <label style={s.label}>Your name</label>
            <input
              type="text"
              value={name}
              onChange={e => { setName(e.target.value); setErrors(p => ({ ...p, name: undefined })) }}
              placeholder="Ashish Kumar"
              style={{ ...s.input, ...(errors.name ? s.inputErr : {}) }}
              autoComplete="name"
              autoFocus
            />
            {errors.name && <p style={s.fieldErr}>{errors.name}</p>}
          </div>

          <div style={s.field}>
            <label style={s.label}>Work email</label>
            <input
              type="email"
              value={email}
              onChange={e => { setEmail(e.target.value); setErrors(p => ({ ...p, email: undefined, general: undefined })) }}
              placeholder="you@company.com"
              style={{ ...s.input, ...(errors.email ? s.inputErr : {}) }}
              autoComplete="email"
            />
            {errors.email && <p style={s.fieldErr}>{errors.email}</p>}
          </div>

          <div style={s.field}>
            <label style={s.label}>Password</label>
            <div style={s.pwWrap}>
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={e => { setPassword(e.target.value); setErrors(p => ({ ...p, password: undefined })) }}
                placeholder="Min 6 characters"
                style={{ ...s.input, paddingRight: '44px', ...(errors.password ? s.inputErr : {}) }}
                autoComplete="new-password"
              />
              <button type="button" onClick={() => setShowPassword(v => !v)} style={s.eyeBtn} tabIndex={-1}>
                {showPassword ? '🙈' : '👁️'}
              </button>
            </div>
            {errors.password && <p style={s.fieldErr}>{errors.password}</p>}
          </div>

          {errors.general && (
            <div style={s.errBox}>
              <span style={{ flexShrink: 0 }}>⚠️</span>
              <span>
                {errors.general}
                {errors.general.includes('already exists') && (
                  <>
                    {' '}<Link href="/login" style={s.link}>Sign in instead →</Link>
                  </>
                )}
              </span>
            </div>
          )}

          <button type="submit" disabled={loading} style={{ ...s.btn, ...(loading ? s.btnDisabled : {}) }}>
            {loading
              ? <span style={s.btnInner}><span style={s.spinner} />Creating account…</span>
              : 'Create account'}
          </button>
        </form>

        <div style={s.hint}>
          🔗 Already using Ping in Slack? Sign up with your work email and your tasks will sync automatically.
        </div>

        <p style={s.switchText}>
          Already have an account?{' '}
          <Link href="/login" style={s.link}>Sign in</Link>
        </p>
      </div>
    </div>
  )
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
  hint: { marginTop: '20px', fontSize: '12px', color: 'var(--muted)', lineHeight: 1.6, padding: '12px 14px', background: 'var(--surface2)', borderRadius: '8px', border: '1px solid var(--border)' },
  switchText: { marginTop: '20px', textAlign: 'center', fontSize: '14px', color: 'var(--muted)' },
  link: { color: 'var(--accent)', textDecoration: 'none', fontWeight: 500 },
  // Check email screen
  emailIcon: { fontSize: '40px', marginBottom: '16px', textAlign: 'center' as const },
  emailDesc: { fontSize: '14px', color: 'var(--muted)', lineHeight: 1.65, marginBottom: '24px', textAlign: 'center' as const },
  steps: { display: 'flex', flexDirection: 'column' as const, gap: '10px', marginBottom: '24px' },
  step: { display: 'flex', alignItems: 'center', gap: '12px', fontSize: '14px', color: 'rgba(240,240,248,0.75)' },
  stepNum: { width: '24px', height: '24px', borderRadius: '50%', background: 'var(--surface2)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px', fontWeight: 600, color: 'var(--accent)', flexShrink: 0 },
  divider: { height: '1px', background: 'var(--border)', margin: '4px 0 20px' },
  resendText: { fontSize: '13px', color: 'var(--muted)', marginBottom: '10px', textAlign: 'center' as const },
  resendBtn: { width: '100%', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: '8px', padding: '10px', fontSize: '14px', color: 'var(--text)', cursor: 'pointer', fontFamily: 'inherit', transition: 'opacity 0.2s' },
  resendBtnDisabled: { opacity: 0.5, cursor: 'not-allowed' },
  backBtn: { background: 'none', border: 'none', color: 'var(--accent)', fontSize: '14px', cursor: 'pointer', padding: 0, fontFamily: 'inherit', fontWeight: 500 },
}

export default function SignupPage() {
  return <><RouteProgressBar /><Suspense><SignupForm /></Suspense></>
}
