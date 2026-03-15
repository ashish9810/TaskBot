import './home.css'
import Link from 'next/link'
import type { Metadata } from 'next'
import RevealOnScroll from './components'

export const metadata: Metadata = {
  title: 'Ping — Task Management Inside Slack',
  description: 'Assign tasks from Slack, track progress on a beautiful dashboard. Free for small teams. No credit card required.',
}

const SLACK_INSTALL_URL = 'https://taskbot-142i.onrender.com/slack/install'

export default function HomePage() {
  return (
    <div style={s.page}>
      <RevealOnScroll />

      {/* ── NAVBAR ── */}
      <nav className="nav-blur" style={s.nav}>
        <div style={s.navInner}>
          <Link href="/home" style={s.navLogo}>
            <span style={s.logoIcon}>P</span>
            <span style={s.logoText}>Ping</span>
          </Link>

          <div className="nav-links" style={s.navLinks}>
            <a href="#features" style={s.navLink}>Features</a>
            <a href="#how-it-works" style={s.navLink}>How it works</a>
          </div>

          <div style={s.navRight}>
            <Link href="/login" style={s.navSignIn}>Sign in</Link>
            <Link href="/signup" className="cta-primary" style={s.navCta}>
              Sign up free
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ marginLeft: '4px' }}>
                <path d="M3 7h8M8 4l3 3-3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </Link>
          </div>
        </div>
      </nav>

      {/* ── HERO ── */}
      <section style={s.hero}>
        <div className="hero-glow" />
        <div style={s.heroContent}>
          {/* Badge */}
          <div className="reveal" style={s.heroBadge}>
            <span className="pulse-dot" style={s.badgeDot} />
            Free for teams
          </div>

          {/* Headline */}
          <h1 className="reveal hero-headline" style={s.heroH1}>
            Task management that{'\n'}lives in <span className="gradient-text">Slack.</span>
          </h1>

          {/* Subheadline */}
          <p className="reveal hero-sub" style={s.heroSub}>
            Assign tasks with @Ping, track progress on a beautiful dashboard,{' '}
            and never ask &quot;any update?&quot; again.
          </p>

          {/* CTAs */}
          <div className="reveal hero-ctas" style={s.heroCtas}>
            <Link href="/signup" className="cta-primary" style={s.ctaPrimary}>
              Sign up free
            </Link>
            <a href={SLACK_INSTALL_URL} style={s.ctaSecondary}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" style={{ flexShrink: 0, opacity: 0.7 }}>
                <path d="M5.04 15.33a2.52 2.52 0 01-2.52 2.52A2.52 2.52 0 010 15.33a2.52 2.52 0 012.52-2.52h2.52v2.52zm1.26 0a2.52 2.52 0 012.52-2.52 2.52 2.52 0 012.52 2.52v6.3a2.52 2.52 0 01-2.52 2.52 2.52 2.52 0 01-2.52-2.52v-6.3zM8.82 5.04a2.52 2.52 0 01-2.52-2.52A2.52 2.52 0 018.82 0a2.52 2.52 0 012.52 2.52v2.52H8.82zm0 1.26a2.52 2.52 0 012.52 2.52 2.52 2.52 0 01-2.52 2.52H2.52A2.52 2.52 0 010 8.82a2.52 2.52 0 012.52-2.52h6.3zm10.29 2.52a2.52 2.52 0 012.52-2.52A2.52 2.52 0 0124 8.82a2.52 2.52 0 01-2.52 2.52h-2.52V8.82zm-1.26 0a2.52 2.52 0 01-2.52 2.52 2.52 2.52 0 01-2.52-2.52V2.52A2.52 2.52 0 0115.18 0a2.52 2.52 0 012.52 2.52v6.3zm-2.52 10.29a2.52 2.52 0 012.52 2.52A2.52 2.52 0 0115.18 24a2.52 2.52 0 01-2.52-2.52v-2.52h2.52zm0-1.26a2.52 2.52 0 01-2.52-2.52 2.52 2.52 0 012.52-2.52h6.3A2.52 2.52 0 0124 15.33a2.52 2.52 0 01-2.52 2.52h-6.3z"/>
              </svg>
              Add to Slack
            </a>
          </div>

          {/* Trust */}
          <div className="reveal trust-row" style={s.trustRow}>
            <span style={s.trustItem}>
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2.5 7.5L5.5 10.5L11.5 3.5" stroke="#4ade80" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>
              No credit card
            </span>
            <span style={s.trustItem}>
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2.5 7.5L5.5 10.5L11.5 3.5" stroke="#4ade80" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>
              30-second setup
            </span>
            <span style={s.trustItem}>
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2.5 7.5L5.5 10.5L11.5 3.5" stroke="#4ade80" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>
              Free for small teams
            </span>
          </div>

          {/* Dashboard mockup */}
          <div className="reveal float-anim" style={s.mockup}>
            <div style={s.mockupBar}>
              <div style={s.mockupDots}>
                <span style={{ ...s.mockupDot, background: '#ff5f57' }} />
                <span style={{ ...s.mockupDot, background: '#ffbd2e' }} />
                <span style={{ ...s.mockupDot, background: '#28c840' }} />
              </div>
              <span style={s.mockupTitle}>Ping Dashboard</span>
            </div>
            <div style={s.mockupBody}>
              {[
                { label: 'Inbox', color: '#f59e0b', count: 2 },
                { label: 'To Do', color: '#64748b', count: 3 },
                { label: 'In Progress', color: '#3b82f6', count: 2 },
                { label: 'Done', color: '#22c55e', count: 4 },
              ].map(col => (
                <div key={col.label} style={s.mockupCol}>
                  <div style={s.mockupColHeader}>
                    <span style={{ ...s.mockupColDot, background: col.color }} />
                    <span style={s.mockupColLabel}>{col.label}</span>
                    <span style={s.mockupColCount}>{col.count}</span>
                  </div>
                  {Array.from({ length: col.count }).map((_, i) => (
                    <div key={i} style={s.mockupCard}>
                      <div style={{ ...s.mockupCardBar, background: col.color }} />
                      <div style={s.mockupCardLines}>
                        <div style={{ ...s.mockupLine, width: `${60 + Math.random() * 30}%` }} />
                        <div style={{ ...s.mockupLine, width: '40%', opacity: 0.4 }} />
                      </div>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── PROBLEM ── */}
      <section style={s.section}>
        <div style={s.sectionInner}>
          <div className="reveal" style={s.sectionLabel}>THE PROBLEM</div>
          <h2 className="reveal section-title" style={s.sectionTitle}>
            Managing a team shouldn&apos;t feel like guesswork.
          </h2>
          <p className="reveal" style={s.sectionSub}>
            Tasks get lost in Slack, updates require nagging, and nobody knows who&apos;s doing what.
          </p>

          <div className="three-col" style={s.threeCol}>
            {[
              { icon: '💬', title: 'Tasks get buried in threads', desc: "Someone said 'can you handle this?' three days ago. Good luck finding it now." },
              { icon: '🔄', title: "You're always asking for updates", desc: "'Any update on this?' — the most dreaded Slack message. You send it daily." },
              { icon: '🌫', title: 'Zero visibility without standups', desc: "Without a 30-minute meeting, you have no idea what your team is working on." },
            ].map(card => (
              <div key={card.title} className="reveal problem-card" style={s.problemCard}>
                <span style={s.problemIcon}>{card.icon}</span>
                <h3 style={s.problemTitle}>{card.title}</h3>
                <p style={s.problemDesc}>{card.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── FEATURES ── */}
      <section id="features" style={s.section}>
        <div style={s.sectionInner}>
          <div className="reveal" style={s.sectionLabel}>FEATURES</div>
          <h2 className="reveal section-title" style={s.sectionTitle}>
            Everything your team needs. Nothing they don&apos;t.
          </h2>
          <p className="reveal" style={s.sectionSub}>
            Ping lives where your team already works — Slack and the web.
          </p>

          <div className="bento-grid" style={s.bentoGrid}>
            {/* Large card */}
            <div className="reveal bento-card bento-large" style={{ ...s.bentoCard, gridColumn: 'span 2' }}>
              <div style={s.bentoIcon}>
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" stroke="#7c5cfc" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
              </div>
              <h3 style={s.bentoTitle}>Assign tasks from any Slack channel</h3>
              <p style={s.bentoDesc}>
                Type <code style={s.code}>@Ping assign @sarah Review the Q4 deck</code> in any channel.
                Ping creates the task, notifies Sarah, and tracks it — without opening another app.
              </p>
            </div>

            <div className="reveal bento-card" style={s.bentoCard}>
              <div style={s.bentoIcon}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none"><rect x="3" y="3" width="7" height="7" rx="1.5" stroke="#60a5fa" strokeWidth="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5" stroke="#60a5fa" strokeWidth="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5" stroke="#60a5fa" strokeWidth="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5" stroke="#60a5fa" strokeWidth="1.5"/></svg>
              </div>
              <h3 style={s.bentoTitle}>Visual Kanban dashboard</h3>
              <p style={s.bentoDesc}>Inbox, To Do, In Progress, Done. Drag tasks across columns. See your whole workload at a glance.</p>
            </div>

            <div className="reveal bento-card" style={s.bentoCard}>
              <div style={s.bentoIcon}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M12 8v4l3 3M21 12a9 9 0 11-18 0 9 9 0 0118 0z" stroke="#f59e0b" strokeWidth="1.5" strokeLinecap="round"/></svg>
              </div>
              <h3 style={s.bentoTitle}>Priority & due dates</h3>
              <p style={s.bentoDesc}>Flag what&apos;s urgent. Set deadlines. Keep everyone focused on what matters most.</p>
            </div>

            <div className="reveal bento-card" style={s.bentoCard}>
              <div style={s.bentoIcon}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" stroke="#4ade80" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
              </div>
              <h3 style={s.bentoTitle}>Timeline updates</h3>
              <p style={s.bentoDesc}>Every task has a thread. Drop updates, share context, keep a paper trail — no status meetings needed.</p>
            </div>

            <div className="reveal bento-card" style={s.bentoCard}>
              <div style={s.bentoIcon}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8zM23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" stroke="#a78bfa" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
              </div>
              <h3 style={s.bentoTitle}>See your whole team</h3>
              <p style={s.bentoDesc}>Search by name, check anyone&apos;s task list in seconds. Built for managers who value their time.</p>
            </div>
          </div>
        </div>
      </section>

      {/* ── HOW IT WORKS ── */}
      <section id="how-it-works" style={s.section}>
        <div style={s.sectionInner}>
          <div className="reveal" style={s.sectionLabel}>HOW IT WORKS</div>
          <h2 className="reveal section-title" style={s.sectionTitle}>
            Up and running in 3 steps.
          </h2>
          <p className="reveal" style={s.sectionSub}>
            No onboarding call. No migration. No training.
          </p>

          <div className="steps-grid" style={s.stepsGrid}>
            {[
              { num: '1', title: 'Sign up and create a workspace', desc: 'Enter your email, pick a workspace name. Takes 30 seconds.' },
              { num: '2', title: 'Connect Slack', desc: 'One click to add Ping to your Slack workspace. Your team members sync automatically.' },
              { num: '3', title: 'Assign your first task', desc: 'Type @Ping assign @teammate in any channel, or create tasks from the web dashboard.' },
            ].map(step => (
              <div key={step.num} className="reveal step-card" style={s.stepCard}>
                <div style={s.stepNum}>{step.num}</div>
                <h3 style={s.stepTitle}>{step.title}</h3>
                <p style={s.stepDesc}>{step.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── TESTIMONIALS ── */}
      <section style={s.section}>
        <div style={s.sectionInner}>
          <div className="reveal" style={s.sectionLabel}>WHAT TEAMS SAY</div>
          <h2 className="reveal section-title" style={s.sectionTitle}>
            Teams love working with Ping.
          </h2>

          <div className="three-col" style={s.threeCol}>
            {[
              { quote: "Our standups went from 30 minutes to 10. Everyone already knows what's happening.", name: 'Arjun R.', role: 'Engineering Manager' },
              { quote: "We tried Asana and Linear. Nothing stuck because it wasn't where the team already lived. Ping just works.", name: 'Sarah M.', role: 'Founder' },
              { quote: "I used to ping people individually for updates. Now I just open the dashboard. Saves me 20 minutes a day.", name: 'Karan P.', role: 'Product Lead' },
            ].map(t => (
              <div key={t.name} className="reveal bento-card" style={s.testimonialCard}>
                <p style={s.testimonialQuote}>&quot;{t.quote}&quot;</p>
                <div style={s.testimonialAuthor}>
                  <div style={s.testimonialAvatar}>{t.name[0]}</div>
                  <div>
                    <div style={s.testimonialName}>{t.name}</div>
                    <div style={s.testimonialRole}>{t.role}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── FINAL CTA ── */}
      <section style={s.ctaSection}>
        <div style={s.sectionInner}>
          <div className="hero-glow" style={{ top: '-150px' }} />
          <h2 className="reveal section-title" style={{ ...s.sectionTitle, position: 'relative', zIndex: 1 }}>
            Your team&apos;s progress, always visible.
          </h2>
          <p className="reveal" style={{ ...s.sectionSub, position: 'relative', zIndex: 1 }}>
            Start free. No setup fee. No credit card. Works with any Slack plan.
          </p>
          <div className="reveal" style={{ textAlign: 'center', position: 'relative', zIndex: 1 }}>
            <Link href="/signup" className="cta-primary" style={s.ctaLarge}>
              Sign up free — it takes 30 seconds
            </Link>
            <p style={s.ctaSubLink}>
              or <a href={SLACK_INSTALL_URL} style={s.ctaSubA}>add Ping to Slack</a>
            </p>
          </div>
        </div>
      </section>

      {/* ── FOOTER ── */}
      <footer style={s.footer}>
        <div className="footer-grid" style={s.footerGrid}>
          <div>
            <div style={s.footerLogo}>
              <span style={s.logoIcon}>P</span>
              <span style={s.logoText}>Ping</span>
            </div>
            <p style={s.footerTagline}>Task management that lives where your team works.</p>
          </div>
          <div>
            <h4 style={s.footerHeading}>Product</h4>
            <a href="#features" style={s.footerLink}>Features</a>
            <a href="#how-it-works" style={s.footerLink}>How it works</a>
            <Link href="/login" style={s.footerLink}>Dashboard</Link>
            <a href={SLACK_INSTALL_URL} style={s.footerLink}>Add to Slack</a>
          </div>
          <div>
            <h4 style={s.footerHeading}>Legal</h4>
            <Link href="/privacy_policy.html" style={s.footerLink}>Privacy Policy</Link>
            <Link href="/support.html" style={s.footerLink}>Support</Link>
          </div>
        </div>
        <div style={s.footerBottom}>
          <span>&copy; 2026 Ping. All rights reserved.</span>
        </div>
      </footer>
    </div>
  )
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const s: Record<string, React.CSSProperties> = {
  page: { background: '#08080f', color: '#eeeef8', minHeight: '100vh', overflow: 'hidden' },

  // Nav
  nav: {
    position: 'fixed', top: 0, left: 0, right: 0, zIndex: 100,
    background: 'rgba(8,8,15,0.8)',
    borderBottom: '1px solid rgba(255,255,255,0.05)',
  },
  navInner: {
    maxWidth: '1200px', margin: '0 auto', padding: '14px 24px',
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  },
  navLogo: { display: 'flex', alignItems: 'center', gap: '8px', textDecoration: 'none' },
  logoIcon: {
    width: '28px', height: '28px', borderRadius: '8px',
    background: 'linear-gradient(135deg, #7c5cfc, #a78bfa)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: '14px', fontWeight: 700, color: 'white',
  },
  logoText: { fontSize: '17px', fontWeight: 700, color: '#eeeef8', letterSpacing: '-0.02em' },
  navLinks: { display: 'flex', gap: '28px' },
  navLink: { fontSize: '14px', color: 'rgba(238,238,248,0.5)', textDecoration: 'none', fontWeight: 500 },
  navRight: { display: 'flex', alignItems: 'center', gap: '16px' },
  navSignIn: { fontSize: '14px', color: 'rgba(238,238,248,0.6)', textDecoration: 'none', fontWeight: 500 },
  navCta: {
    display: 'inline-flex', alignItems: 'center',
    background: 'white', color: '#08080f',
    padding: '8px 18px', borderRadius: '8px',
    fontSize: '13px', fontWeight: 600, textDecoration: 'none',
  },

  // Hero
  hero: {
    position: 'relative', paddingTop: '140px', paddingBottom: '60px',
    textAlign: 'center', overflow: 'hidden',
  },
  heroContent: { position: 'relative', zIndex: 1, maxWidth: '1200px', margin: '0 auto', padding: '0 24px' },
  heroBadge: {
    display: 'inline-flex', alignItems: 'center', gap: '8px',
    background: 'rgba(74,222,128,0.08)', border: '1px solid rgba(74,222,128,0.2)',
    borderRadius: '100px', padding: '6px 16px',
    fontSize: '13px', fontWeight: 500, color: '#4ade80',
    marginBottom: '28px',
  },
  badgeDot: { width: '6px', height: '6px', borderRadius: '50%', background: '#4ade80' },
  heroH1: {
    fontSize: 'clamp(40px, 6vw, 72px)', fontWeight: 800,
    letterSpacing: '-0.04em', lineHeight: 1.1,
    color: '#ffffff', marginBottom: '20px',
    whiteSpace: 'pre-line',
  },
  heroSub: {
    fontSize: '18px', lineHeight: 1.65, color: 'rgba(238,238,248,0.55)',
    maxWidth: '560px', margin: '0 auto 36px',
  },
  heroCtas: {
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '16px',
    marginBottom: '28px',
  },
  ctaPrimary: {
    display: 'inline-flex', alignItems: 'center',
    background: 'white', color: '#08080f',
    padding: '14px 32px', borderRadius: '10px',
    fontSize: '16px', fontWeight: 700, textDecoration: 'none',
    boxShadow: '0 4px 20px rgba(124,92,252,0.2)',
  },
  ctaSecondary: {
    display: 'inline-flex', alignItems: 'center', gap: '8px',
    color: 'rgba(238,238,248,0.5)',
    padding: '14px 24px', borderRadius: '10px',
    fontSize: '15px', fontWeight: 500, textDecoration: 'none',
    border: '1px solid rgba(255,255,255,0.1)',
  },
  trustRow: {
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '24px',
    marginBottom: '60px',
  },
  trustItem: {
    display: 'flex', alignItems: 'center', gap: '6px',
    fontSize: '13px', color: 'rgba(238,238,248,0.4)', fontWeight: 500,
  },

  // Mockup
  mockup: {
    maxWidth: '900px', margin: '0 auto',
    background: '#111120', border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: '16px', overflow: 'hidden',
    boxShadow: '0 40px 80px rgba(0,0,0,0.5), 0 0 120px rgba(124,92,252,0.06)',
  },
  mockupBar: {
    display: 'flex', alignItems: 'center', gap: '12px',
    padding: '12px 16px', borderBottom: '1px solid rgba(255,255,255,0.06)',
  },
  mockupDots: { display: 'flex', gap: '6px' },
  mockupDot: { width: '10px', height: '10px', borderRadius: '50%' },
  mockupTitle: { fontSize: '12px', color: 'rgba(238,238,248,0.3)', fontWeight: 500 },
  mockupBody: { display: 'flex', gap: '12px', padding: '16px', minHeight: '200px' },
  mockupCol: { flex: 1, display: 'flex', flexDirection: 'column', gap: '8px' },
  mockupColHeader: { display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' },
  mockupColDot: { width: '7px', height: '7px', borderRadius: '50%' },
  mockupColLabel: { fontSize: '10px', fontWeight: 600, color: 'rgba(238,238,248,0.4)', textTransform: 'uppercase', letterSpacing: '0.05em' },
  mockupColCount: { fontSize: '9px', color: 'rgba(238,238,248,0.25)', background: 'rgba(255,255,255,0.05)', borderRadius: '100px', padding: '0 5px' },
  mockupCard: {
    background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)',
    borderRadius: '8px', padding: '10px', display: 'flex', gap: '8px',
  },
  mockupCardBar: { width: '3px', borderRadius: '2px', flexShrink: 0 },
  mockupCardLines: { flex: 1, display: 'flex', flexDirection: 'column', gap: '5px' },
  mockupLine: { height: '6px', background: 'rgba(255,255,255,0.08)', borderRadius: '3px' },

  // Sections
  section: { padding: '100px 0' },
  sectionInner: { maxWidth: '1100px', margin: '0 auto', padding: '0 24px' },
  sectionLabel: {
    fontSize: '12px', fontWeight: 700, color: '#7c5cfc',
    letterSpacing: '0.12em', textTransform: 'uppercase',
    marginBottom: '14px', textAlign: 'center',
  },
  sectionTitle: {
    fontSize: 'clamp(28px, 4vw, 44px)', fontWeight: 800,
    letterSpacing: '-0.03em', lineHeight: 1.15,
    color: '#ffffff', textAlign: 'center', marginBottom: '14px',
  },
  sectionSub: {
    fontSize: '16px', lineHeight: 1.6, color: 'rgba(238,238,248,0.45)',
    textAlign: 'center', maxWidth: '520px', margin: '0 auto 48px',
  },

  // Problem cards
  threeCol: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px' },
  problemCard: {
    background: '#111120', border: '1px solid rgba(255,255,255,0.07)',
    borderRadius: '16px', padding: '28px 24px',
  },
  problemIcon: { fontSize: '28px', marginBottom: '16px', display: 'block' },
  problemTitle: { fontSize: '17px', fontWeight: 700, color: '#ffffff', marginBottom: '10px', letterSpacing: '-0.01em' },
  problemDesc: { fontSize: '14px', lineHeight: 1.6, color: 'rgba(238,238,248,0.45)' },

  // Bento grid
  bentoGrid: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px' },
  bentoCard: {
    background: '#111120', border: '1px solid rgba(255,255,255,0.07)',
    borderRadius: '16px', padding: '28px 24px',
  },
  bentoIcon: { marginBottom: '16px' },
  bentoTitle: { fontSize: '17px', fontWeight: 700, color: '#ffffff', marginBottom: '10px', letterSpacing: '-0.01em' },
  bentoDesc: { fontSize: '14px', lineHeight: 1.6, color: 'rgba(238,238,248,0.45)' },
  code: {
    background: 'rgba(124,92,252,0.12)', border: '1px solid rgba(124,92,252,0.2)',
    borderRadius: '5px', padding: '2px 7px', fontSize: '13px', color: '#a78bfa',
    fontFamily: 'monospace',
  },

  // Steps
  stepsGrid: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px' },
  stepCard: {
    background: '#111120', border: '1px solid rgba(255,255,255,0.07)',
    borderRadius: '16px', padding: '28px 24px', textAlign: 'center',
  },
  stepNum: {
    width: '40px', height: '40px', borderRadius: '50%',
    background: 'linear-gradient(135deg, #7c5cfc, #a78bfa)',
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    fontSize: '18px', fontWeight: 800, color: 'white', marginBottom: '16px',
  },
  stepTitle: { fontSize: '17px', fontWeight: 700, color: '#ffffff', marginBottom: '10px' },
  stepDesc: { fontSize: '14px', lineHeight: 1.6, color: 'rgba(238,238,248,0.45)' },

  // Testimonials
  testimonialCard: { display: 'flex', flexDirection: 'column', justifyContent: 'space-between' },
  testimonialQuote: { fontSize: '15px', lineHeight: 1.65, color: 'rgba(238,238,248,0.7)', marginBottom: '20px', fontStyle: 'italic' },
  testimonialAuthor: { display: 'flex', alignItems: 'center', gap: '10px' },
  testimonialAvatar: {
    width: '32px', height: '32px', borderRadius: '50%',
    background: 'linear-gradient(135deg, #7c5cfc, #a78bfa)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: '13px', fontWeight: 700, color: 'white',
  },
  testimonialName: { fontSize: '13px', fontWeight: 600, color: '#eeeef8' },
  testimonialRole: { fontSize: '12px', color: 'rgba(238,238,248,0.4)' },

  // Final CTA
  ctaSection: { padding: '100px 0 80px', position: 'relative', overflow: 'hidden' },
  ctaLarge: {
    display: 'inline-flex', alignItems: 'center',
    background: 'white', color: '#08080f',
    padding: '16px 40px', borderRadius: '12px',
    fontSize: '17px', fontWeight: 700, textDecoration: 'none',
    boxShadow: '0 4px 30px rgba(124,92,252,0.25)',
  },
  ctaSubLink: { marginTop: '16px', fontSize: '14px', color: 'rgba(238,238,248,0.4)' },
  ctaSubA: { color: '#7c5cfc', textDecoration: 'none', fontWeight: 500 },

  // Footer
  footer: {
    borderTop: '1px solid rgba(255,255,255,0.06)',
    padding: '48px 24px 32px', maxWidth: '1100px', margin: '0 auto',
  },
  footerGrid: { display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: '48px', marginBottom: '40px' },
  footerLogo: { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' },
  footerTagline: { fontSize: '14px', color: 'rgba(238,238,248,0.35)', lineHeight: 1.5, maxWidth: '280px' },
  footerHeading: { fontSize: '12px', fontWeight: 700, color: 'rgba(238,238,248,0.5)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '14px' },
  footerLink: { display: 'block', fontSize: '14px', color: 'rgba(238,238,248,0.4)', textDecoration: 'none', marginBottom: '10px' },
  footerBottom: { borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '20px', fontSize: '13px', color: 'rgba(238,238,248,0.25)' },
}
