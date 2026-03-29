import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Ping - Support',
}

export default function SupportPage() {
  return (
    <div style={{ fontFamily: 'Arial, sans-serif', maxWidth: 800, margin: '40px auto', padding: '0 20px', color: '#333' }}>
      <h1 style={{ color: '#1a1a1a' }}>Ping</h1>

      <h2 style={{ color: '#444', marginTop: 30 }}>What is Ping?</h2>
      <p>Ping is a Slack app that helps teams manage tasks, track progress, and monitor employee workload directly inside Slack.</p>

      <h2 style={{ color: '#444', marginTop: 30 }}>How to use Ping</h2>
      <ul>
        <li>Open the Ping app in your Slack sidebar</li>
        <li>Use <strong>My Tasks</strong> to add and manage your own tasks</li>
        <li>Use <strong>People</strong> to view tasks of your team members</li>
        <li>Use <strong>Pinned</strong> to quickly access your most important team members</li>
      </ul>

      <h2 style={{ color: '#444', marginTop: 30 }}>Contact Support</h2>
      <p>For help or questions, email us at: <a href="mailto:info.ak.ashish@gmail.com">info.ak.ashish@gmail.com</a></p>
    </div>
  )
}
