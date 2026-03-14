export default function AllTasksLoading() {
  return (
    <div style={s.wrap}>
      <div style={s.spinner} />
      <p style={s.text}>Loading all tasks...</p>
    </div>
  )
}

const s: Record<string, React.CSSProperties> = {
  wrap: {
    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
    gap: '14px', flex: 1, minHeight: '300px', opacity: 0.7,
  },
  spinner: {
    width: '24px', height: '24px',
    border: '2.5px solid var(--border)',
    borderTopColor: 'var(--accent)',
    borderRadius: '50%',
    animation: 'spin 0.7s linear infinite',
  },
  text: { fontSize: '14px', color: 'var(--muted)', fontWeight: 500 },
}
