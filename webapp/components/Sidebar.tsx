'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useState } from 'react'
import { createClient } from '@/lib/supabase-browser'

type Props = {
  user: { name: string; email: string }
  workspace: { id: string; name: string; slackConnected: boolean; slackTeamId?: string | null; slackWorkspaceName?: string | null } | null
  role: 'owner' | 'member'
}

const navItems = [
  {
    href: '/dashboard',
    label: 'My Tasks',
    exactMatch: true,
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <rect x="1" y="1" width="6" height="6" rx="1.5" fill="currentColor" opacity="0.9"/>
        <rect x="9" y="1" width="6" height="6" rx="1.5" fill="currentColor" opacity="0.5"/>
        <rect x="1" y="9" width="6" height="6" rx="1.5" fill="currentColor" opacity="0.5"/>
        <rect x="9" y="9" width="6" height="6" rx="1.5" fill="currentColor" opacity="0.3"/>
      </svg>
    ),
  },
  {
    href: '/dashboard/all-tasks',
    label: 'All Tasks',
    exactMatch: false,
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <path d="M2 4h12M2 8h8M2 12h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
      </svg>
    ),
  },
  // Members tab hidden — emails exposed feels spooky to users
  // {
  //   href: '/dashboard/people',
  //   label: 'Members',
  //   exactMatch: false,
  //   icon: ( <svg>...</svg> ),
  // },
]

export default function Sidebar({ user, workspace, role }: Props) {
  const pathname = usePathname()
  const router = useRouter()
  const [collapsed, setCollapsed] = useState(false)
  const [signingOut, setSigningOut] = useState(false)
  const [inviteLink, setInviteLink] = useState<string | null>(null)
  const [inviteCopied, setInviteCopied] = useState(false)
  const [loadingInvite, setLoadingInvite] = useState(false)

  async function handleInvite() {
    if (inviteLink) {
      await navigator.clipboard.writeText(inviteLink)
      setInviteCopied(true)
      setTimeout(() => setInviteCopied(false), 2000)
      return
    }
    setLoadingInvite(true)
    try {
      const res = await fetch('/api/invites')
      const data = await res.json()
      if (data.token) {
        const url = `${window.location.origin}/join/${data.token}`
        setInviteLink(url)
        await navigator.clipboard.writeText(url)
        setInviteCopied(true)
        setTimeout(() => setInviteCopied(false), 2000)
      }
    } catch { /* ignore */ }
    setLoadingInvite(false)
  }

  async function handleSignOut() {
    setSigningOut(true)
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/home')
    router.refresh()
  }

  function isActive(href: string, exactMatch: boolean) {
    return exactMatch ? pathname === href : pathname.startsWith(href)
  }

  return (
    <aside style={{ ...s.sidebar, width: collapsed ? 64 : 220 }}>
      {/* Collapse toggle */}
      <button
        onClick={() => setCollapsed(v => !v)}
        style={s.collapseBtn}
        title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      >
        <svg
          width="12"
          height="12"
          viewBox="0 0 12 12"
          fill="none"
          style={{ transform: collapsed ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.25s ease' }}
        >
          <path d="M7.5 2L3.5 6l4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>

      <div style={s.top}>
        {/* Workspace */}
        <div style={{ ...s.workspaceRow, padding: collapsed ? '4px 0' : '4px 8px', justifyContent: collapsed ? 'center' : 'flex-start' }}>
          <div style={s.workspaceAvatar}>
            {workspace?.name?.[0]?.toUpperCase() || 'P'}
          </div>
          {!collapsed && (
            <div style={s.workspaceName} title={workspace?.name || 'Ping'}>
              {workspace?.name || 'Ping'}
            </div>
          )}
        </div>

        {/* Nav */}
        <nav style={s.nav}>
          {navItems.map(item => {
            const active = isActive(item.href, item.exactMatch)
            return (
              <Link
                key={item.href}
                href={item.href}
                title={collapsed ? item.label : undefined}
                style={{
                  ...s.navItem,
                  ...(active ? s.navItemActive : {}),
                  justifyContent: collapsed ? 'center' : 'flex-start',
                  padding: collapsed ? '9px' : '9px 12px',
                }}
              >
                <span style={{ ...s.navIcon, color: active ? 'var(--text)' : 'var(--muted)' }}>
                  {item.icon}
                </span>
                {!collapsed && (
                  <span style={{ color: active ? 'var(--text)' : 'var(--muted)' }}>
                    {item.label}
                  </span>
                )}
              </Link>
            )
          })}
        </nav>
      </div>

      <div style={s.bottom}>
        {/* Slack CTA */}
        {workspace && !collapsed && (
          <div style={s.slackSection}>
            {workspace.slackConnected ? (
              <a
                href={`https://app.slack.com/client/${workspace.slackTeamId}`}
                target="_blank"
                rel="noopener noreferrer"
                style={s.slackConnectedBtn}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" style={{ flexShrink: 0 }}>
                  <path d="M5.04 15.33a2.52 2.52 0 01-2.52 2.52A2.52 2.52 0 010 15.33a2.52 2.52 0 012.52-2.52h2.52v2.52zm1.26 0a2.52 2.52 0 012.52-2.52 2.52 2.52 0 012.52 2.52v6.3a2.52 2.52 0 01-2.52 2.52 2.52 2.52 0 01-2.52-2.52v-6.3zM8.82 5.04a2.52 2.52 0 01-2.52-2.52A2.52 2.52 0 018.82 0a2.52 2.52 0 012.52 2.52v2.52H8.82zm0 1.26a2.52 2.52 0 012.52 2.52 2.52 2.52 0 01-2.52 2.52H2.52A2.52 2.52 0 010 8.82a2.52 2.52 0 012.52-2.52h6.3zm10.29 2.52a2.52 2.52 0 012.52-2.52A2.52 2.52 0 0124 8.82a2.52 2.52 0 01-2.52 2.52h-2.52V8.82zm-1.26 0a2.52 2.52 0 01-2.52 2.52 2.52 2.52 0 01-2.52-2.52V2.52A2.52 2.52 0 0115.18 0a2.52 2.52 0 012.52 2.52v6.3zm-2.52 10.29a2.52 2.52 0 012.52 2.52A2.52 2.52 0 0115.18 24a2.52 2.52 0 01-2.52-2.52v-2.52h2.52zm0-1.26a2.52 2.52 0 01-2.52-2.52 2.52 2.52 0 012.52-2.52h6.3A2.52 2.52 0 0124 15.33a2.52 2.52 0 01-2.52 2.52h-6.3z"/>
                </svg>
                <span style={s.slackNameWrap}>
                  <span style={s.slackName}>{workspace.slackWorkspaceName || 'Slack'}</span>
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style={{ flexShrink: 0 }}>
                    <path d="M2.5 6.5L5 9l4.5-6" stroke="#4ade80" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </span>
              </a>
            ) : role === 'owner' ? (
              <a href={`/api/slack/connect?workspace_id=${workspace.id}`} style={s.slackBtn}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" style={{ flexShrink: 0 }}>
                  <path d="M5.04 15.33a2.52 2.52 0 01-2.52 2.52A2.52 2.52 0 010 15.33a2.52 2.52 0 012.52-2.52h2.52v2.52zm1.26 0a2.52 2.52 0 012.52-2.52 2.52 2.52 0 012.52 2.52v6.3a2.52 2.52 0 01-2.52 2.52 2.52 2.52 0 01-2.52-2.52v-6.3zM8.82 5.04a2.52 2.52 0 01-2.52-2.52A2.52 2.52 0 018.82 0a2.52 2.52 0 012.52 2.52v2.52H8.82zm0 1.26a2.52 2.52 0 012.52 2.52 2.52 2.52 0 01-2.52 2.52H2.52A2.52 2.52 0 010 8.82a2.52 2.52 0 012.52-2.52h6.3zm10.29 2.52a2.52 2.52 0 012.52-2.52A2.52 2.52 0 0124 8.82a2.52 2.52 0 01-2.52 2.52h-2.52V8.82zm-1.26 0a2.52 2.52 0 01-2.52 2.52 2.52 2.52 0 01-2.52-2.52V2.52A2.52 2.52 0 0115.18 0a2.52 2.52 0 012.52 2.52v6.3zm-2.52 10.29a2.52 2.52 0 012.52 2.52A2.52 2.52 0 0115.18 24a2.52 2.52 0 01-2.52-2.52v-2.52h2.52zm0-1.26a2.52 2.52 0 01-2.52-2.52 2.52 2.52 0 012.52-2.52h6.3A2.52 2.52 0 0124 15.33a2.52 2.52 0 01-2.52 2.52h-6.3z"/>
                </svg>
                Add to Slack
              </a>
            ) : (
              <div style={s.slackMuted}>Ask owner to connect Slack</div>
            )}
          </div>
        )}

        {/* Invite button for owners — copies invite link to clipboard */}
        {role === 'owner' && !collapsed && (
          <button onClick={handleInvite} disabled={loadingInvite} style={s.inviteBtn}>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0 }}>
              <circle cx="6" cy="5" r="3" stroke="currentColor" strokeWidth="1.4"/>
              <path d="M1 14c0-2.8 2.2-5 5-5s5 2.2 5 5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
              <path d="M13 5v4M11 7h4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
            </svg>
            {loadingInvite ? 'Loading…' : inviteCopied ? 'Link copied!' : 'Copy Invite Link'}
          </button>
        )}

        {/* User */}
        {!collapsed ? (
          <div style={s.userRow}>
            <div style={s.avatar}>{(user.name || user.email)[0].toUpperCase()}</div>
            <div style={s.userText}>
              <div style={s.userName}>{user.name}</div>
              <div style={s.userEmail}>{user.email}</div>
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', justifyContent: 'center' }}>
            <div style={{ ...s.avatar, cursor: 'default' }} title={user.name}>{(user.name || user.email)[0].toUpperCase()}</div>
          </div>
        )}
        <button
          onClick={handleSignOut}
          disabled={signingOut}
          style={{ ...s.signOutBtn, justifyContent: collapsed ? 'center' : 'flex-start', padding: collapsed ? '8px' : '8px 12px', opacity: signingOut ? 0.5 : 1 }}
          title={collapsed ? 'Sign out' : undefined}
        >
          {signingOut ? (
            <span style={{ display: 'inline-block', width: '14px', height: '14px', border: '2px solid var(--border)', borderTopColor: 'var(--muted)', borderRadius: '50%', animation: 'spin 0.7s linear infinite', flexShrink: 0 }} />
          ) : (
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0 }}>
              <path d="M6 2H3a1 1 0 00-1 1v10a1 1 0 001 1h3M10 11l3-3-3-3M13 8H6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          )}
          {!collapsed && <span>{signingOut ? 'Signing out...' : 'Sign out'}</span>}
        </button>
      </div>
    </aside>
  )
}

const s: Record<string, React.CSSProperties> = {
  sidebar: {
    flexShrink: 0,
    background: 'var(--surface)',
    borderRight: '1px solid var(--border)',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'space-between',
    padding: '20px 10px 16px',
    position: 'sticky',
    top: 0,
    height: '100vh',
    transition: 'width 0.25s ease',
    overflow: 'hidden',
    zIndex: 10,
  },
  collapseBtn: {
    position: 'absolute',
    right: '-10px',
    top: '24px',
    width: '20px',
    height: '20px',
    borderRadius: '50%',
    background: 'var(--surface2)',
    border: '1px solid var(--border)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    color: 'var(--muted)',
    zIndex: 20,
    padding: 0,
    flexShrink: 0,
  },
  top: { display: 'flex', flexDirection: 'column', gap: '24px' },
  workspaceRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    overflow: 'hidden',
  },
  workspaceAvatar: {
    width: '28px',
    height: '28px',
    borderRadius: '8px',
    background: 'linear-gradient(135deg, #7c5cfc, #a78bfa)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '13px',
    fontWeight: 700,
    color: 'white',
    flexShrink: 0,
  },
  workspaceName: {
    fontSize: '14px',
    fontWeight: 700,
    letterSpacing: '-0.02em',
    color: 'var(--text)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  nav: { display: 'flex', flexDirection: 'column', gap: '2px' },
  navItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    borderRadius: '8px',
    fontSize: '13.5px',
    fontWeight: 500,
    textDecoration: 'none',
    transition: 'background 0.15s',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
  },
  navItemActive: { background: 'var(--surface2)' },
  navIcon: { flexShrink: 0, display: 'flex', alignItems: 'center' },
  bottom: { display: 'flex', flexDirection: 'column', gap: '8px' },
  inviteBtn: {
    display: 'flex', alignItems: 'center', gap: '8px',
    background: 'rgba(124,92,252,0.1)', border: '1px solid rgba(124,92,252,0.25)',
    borderRadius: '8px', padding: '8px 10px',
    fontSize: '12px', fontWeight: 500, color: 'var(--accent-light)',
    cursor: 'pointer', fontFamily: 'inherit',
    whiteSpace: 'nowrap' as const,
  },
  slackSection: { padding: '0 2px' },
  slackBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    background: 'var(--surface2)',
    border: '1px solid var(--border)',
    borderRadius: '8px',
    padding: '8px 10px',
    fontSize: '12px',
    fontWeight: 500,
    color: 'var(--text)',
    textDecoration: 'none',
    whiteSpace: 'nowrap',
  },
  slackConnectedBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    background: 'rgba(74,222,128,0.06)',
    border: '1px solid rgba(74,222,128,0.2)',
    borderRadius: '8px',
    padding: '8px 10px',
    fontSize: '12px',
    fontWeight: 500,
    color: 'var(--text)',
    textDecoration: 'none',
    whiteSpace: 'nowrap' as const,
    cursor: 'pointer',
  },
  slackNameWrap: {
    display: 'flex',
    alignItems: 'center',
    gap: '5px',
    flex: 1,
    overflow: 'hidden',
  },
  slackName: {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  },
  slackMuted: { fontSize: '11px', color: 'var(--muted)', padding: '4px 8px', lineHeight: 1.4 },
  userRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '8px 10px',
    background: 'var(--surface2)',
    borderRadius: '8px',
    border: '1px solid var(--border)',
    overflow: 'hidden',
  },
  avatar: {
    width: '28px',
    height: '28px',
    borderRadius: '50%',
    background: 'linear-gradient(135deg, #7c5cfc, #a78bfa)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '12px',
    fontWeight: 700,
    color: 'white',
    flexShrink: 0,
  },
  userText: { overflow: 'hidden' },
  userName: { fontSize: '12px', fontWeight: 600, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  userEmail: { fontSize: '11px', color: 'var(--muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  signOutBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    background: 'none',
    border: '1px solid var(--border)',
    borderRadius: '8px',
    color: 'var(--muted)',
    fontSize: '12px',
    cursor: 'pointer',
    fontFamily: 'inherit',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    transition: 'color 0.15s',
  },
}
