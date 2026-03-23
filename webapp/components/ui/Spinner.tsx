'use client'

type Props = {
  size?: 'sm' | 'md'
  color?: string
}

/**
 * Reusable spinning loader. sm = 12px (inline/buttons), md = 24px (page-level).
 */
export default function Spinner({ size = 'sm', color }: Props) {
  const px = size === 'sm' ? 12 : 24
  const border = size === 'sm' ? 2 : 2.5

  return (
    <span
      style={{
        display: 'inline-block',
        width: `${px}px`,
        height: `${px}px`,
        border: `${border}px solid var(--border)`,
        borderTopColor: color || 'var(--accent)',
        borderRadius: '50%',
        animation: 'spin 0.7s linear infinite',
        flexShrink: 0,
      }}
    />
  )
}
