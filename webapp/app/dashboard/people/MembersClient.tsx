'use client'

import { useState } from 'react'

type Member = {
  profileId: string
  name: string
  email: string
  role: string
  activeTasks: number
}

type Props = {
  members: Member[]
  slackUsers: { slack_user_id: string; name: string; email: string }[]
  workspaceId: string
  workspaceName: string
  currentUserId: string
  isOwner: boolean
}

export default function MembersClient({ members, slackUsers, workspaceId, workspaceName, currentUserId, isOwner }: Props) {
  const [inviteLink, setInviteLink] = useState<string | null>(null)
  const [loadingInvite, setLoadingInvite] = useState(false)
  const [copied, setCopied] = useState(false)

  async function handleGetInvite() {
    setLoadingInvite(true)
    const res = await fetch('/api/invites')
    const data = await res.json()
    if (data.token) {
      const url = `${window.location.origin}/join/${data.token}`
      setInviteLink(url)
    }
    setLoadingInvite(false)
  }

  async function handleCopy() {
    if (!inviteLink) return
    await navigator.clipboard.writeText(inviteLink)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  async function handleRegenerate() {
    setLoadingInvite(true)
    const res = await fetch('/api/invites', { method: 'POST' })
    const data = await res.json()
    if (data.token) {
      const url = `${window.location.origin}/join/${data.token}`
      setInviteLink(url)
    }
    setLoadingInvite(false)
  }

  return (
    <div>
      <div style={s.header}>
        <h1 style={s.heading}>Members</h1>
        <span style={s.badge}>{members.length} member{members.length !== 1 ? 's' : ''}</span>
        <button
          onClick={handleGetInvite}
          disabled={loadingInvite}
          style={{ ...s.inviteBtn, ...(loadingInvite ? s.btnDisabled : {}) }}
        >
          {loadingInvite ? 'Loading…' : 'Invite teammates'}
        </button>
      </div>

      {/* Invite link panel */}
      {inviteLink && (
        <div style={s.invitePanel}>
          <p style={s.inviteLabel}>Share this link to invite people to <strong>{workspaceName}</strong>:</p>
          <div style={s.linkRow}>
            <code style={s.linkText}>{inviteLink}</code>
            <button onClick={handleCopy} style={s.copyBtn}>
              {copied ? 'Copied!' : 'Copy'}
            </button>
          </div>
          <button onClick={handleRegenerate} style={s.regenBtn}>
            Generate new link (invalidates old one)
          </button>
        </div>
      )}

      {/* Web workspace members */}
      {members.length > 0 && (
        <div style={s.section}>
          <h2 style={s.sectionTitle}>Workspace members</h2>
          <div style={s.list}>
            {members.map(m => (
              <div key={m.profileId} style={s.card}>
                <div style={s.avatar}>{(m.name || m.email || '?')[0].toUpperCase()}</div>
                <div style={s.info}>
                  <div style={s.name}>
                    {m.name}
                    {m.profileId === currentUserId && <span style={s.youTag}> (you)</span>}
                    {m.role === 'owner' && <span style={s.ownerTag}> owner</span>}
                  </div>
                  <div style={s.email}>{m.email}</div>
                </div>
                <span style={s.taskCount}>{m.activeTasks} active</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Slack users (if workspace has Slack connected) */}
      {slackUsers.length > 0 && (
        <div style={{ ...s.section, marginTop: '32px' }}>
          <h2 style={s.sectionTitle}>Slack workspace members</h2>
          <div style={s.list}>
            {slackUsers.map(u => (
              <div key={u.slack_user_id} style={s.card}>
                <div style={s.avatar}>{(u.name || u.email || '?')[0].toUpperCase()}</div>
                <div style={s.info}>
                  <div style={s.name}>{u.name || '(No name)'}</div>
                  <div style={s.email}>{u.email || 'No email'}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {members.length === 0 && slackUsers.length === 0 && (
        <div style={s.empty}>
          <p style={s.emptyTitle}>No members yet</p>
          <p style={s.emptyText}>Invite teammates using the button above.</p>
        </div>
      )}
    </div>
  )
}

const s: Record<string, React.CSSProperties> = {
  header: { display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '24px', flexWrap: 'wrap' as const },
  heading: { fontSize: '22px', fontWeight: 700, letterSpacing: '-0.03em', color: 'var(--text)' },
  badge: { background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: '100px', padding: '3px 10px', fontSize: '12px', color: 'var(--muted)' },
  inviteBtn: { marginLeft: 'auto', background: 'var(--accent)', color: 'white', border: 'none', borderRadius: '8px', padding: '8px 16px', fontSize: '13px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' },
  btnDisabled: { opacity: 0.6, cursor: 'not-allowed' },
  invitePanel: { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '12px', padding: '16px 20px', marginBottom: '28px' },
  inviteLabel: { fontSize: '13px', color: 'var(--muted)', marginBottom: '10px' },
  linkRow: { display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px' },
  linkText: { flex: 1, fontSize: '13px', color: 'var(--text)', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: '6px', padding: '8px 12px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const, fontFamily: 'monospace' },
  copyBtn: { background: 'var(--accent)', color: 'white', border: 'none', borderRadius: '6px', padding: '8px 14px', fontSize: '13px', fontWeight: 600, cursor: 'pointer', flexShrink: 0, fontFamily: 'inherit' },
  regenBtn: { background: 'none', border: 'none', color: 'var(--muted)', fontSize: '12px', cursor: 'pointer', padding: 0, fontFamily: 'inherit', textDecoration: 'underline' },
  section: {},
  sectionTitle: { fontSize: '13px', fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase' as const, letterSpacing: '0.04em', marginBottom: '10px' },
  list: { display: 'flex', flexDirection: 'column', gap: '8px' },
  card: { display: 'flex', alignItems: 'center', gap: '14px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '12px', padding: '14px 16px' },
  avatar: { width: '36px', height: '36px', borderRadius: '50%', background: 'linear-gradient(135deg, #E06C4D, #F0926E)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '14px', fontWeight: 700, color: 'white', flexShrink: 0 },
  info: { flex: 1, minWidth: 0 },
  name: { fontSize: '14px', fontWeight: 600, color: 'var(--text)', whiteSpace: 'nowrap' as const, overflow: 'hidden', textOverflow: 'ellipsis' },
  email: { fontSize: '12px', color: 'var(--muted)', whiteSpace: 'nowrap' as const, overflow: 'hidden', textOverflow: 'ellipsis' },
  taskCount: { fontSize: '12px', color: 'var(--muted)', flexShrink: 0 },
  youTag: { fontWeight: 400, color: 'var(--muted)', fontSize: '12px' },
  ownerTag: { fontWeight: 400, color: 'var(--accent)', fontSize: '12px' },
  empty: { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '16px', padding: '48px 32px', textAlign: 'center' as const },
  emptyTitle: { fontSize: '16px', fontWeight: 600, color: 'var(--text)', marginBottom: '8px' },
  emptyText: { fontSize: '14px', color: 'var(--muted)' },
}
