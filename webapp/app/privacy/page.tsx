import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Ping - Privacy Policy',
}

export default function PrivacyPage() {
  return (
    <div style={{ fontFamily: 'Arial, sans-serif', maxWidth: 800, margin: '40px auto', padding: '0 20px', color: '#333' }}>
      <h1 style={{ color: '#1a1a1a' }}>Ping Privacy Policy</h1>
      <p>Last updated: February 2026</p>

      <h2 style={{ color: '#444', marginTop: 30 }}>What data we collect</h2>
      <p>Ping collects the following data from your Slack workspace:</p>
      <ul>
        <li>Slack user IDs, names, and email addresses</li>
        <li>Tasks created by users</li>
        <li>Progress updates added to tasks</li>
      </ul>

      <h2 style={{ color: '#444', marginTop: 30 }}>How we use your data</h2>
      <p>Data is used solely to provide Ping{"'"}s task management functionality. We do not sell or share your data with third parties.</p>

      <h2 style={{ color: '#444', marginTop: 30 }}>Data storage</h2>
      <p>Data is stored securely in Supabase. Each workspace{"'"}s data is isolated and not accessible by other workspaces.</p>

      <h2 style={{ color: '#444', marginTop: 30 }}>Data deletion</h2>
      <p>To request deletion of your workspace{"'"}s data, contact us at the support page.</p>

      <h2 style={{ color: '#444', marginTop: 30 }}>Contact</h2>
      <p>For privacy concerns, visit our <a href="/support">support page</a>.</p>
    </div>
  )
}
