'use client'

import { Suspense, useEffect, useState, useRef } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'

/**
 * A thin progress bar at the top of the viewport that animates during route changes.
 * Mount once in a layout — it automatically detects pathname changes.
 */
export default function RouteProgressBar() {
  return <Suspense><RouteProgressBarInner /></Suspense>
}

function RouteProgressBarInner() {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [progress, setProgress] = useState(0)
  const [visible, setVisible] = useState(false)
  const prevPath = useRef(pathname)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    // On pathname or search param change, animate the bar
    const currentPath = pathname + searchParams.toString()
    const prev = prevPath.current
    prevPath.current = currentPath

    if (prev !== currentPath) {
      // Start: jump to ~30%, then creep to ~80%
      setProgress(30)
      setVisible(true)

      timer.current = setTimeout(() => setProgress(70), 150)

      // Complete after a short delay (route has already loaded at this point)
      const done = setTimeout(() => {
        setProgress(100)
        setTimeout(() => {
          setVisible(false)
          setProgress(0)
        }, 250)
      }, 350)

      return () => {
        if (timer.current) clearTimeout(timer.current)
        clearTimeout(done)
      }
    }
  }, [pathname, searchParams])

  if (!visible && progress === 0) return null

  return (
    <div style={styles.track}>
      <div
        style={{
          ...styles.bar,
          width: `${progress}%`,
          opacity: visible ? 1 : 0,
        }}
      />
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  track: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    height: '3px',
    zIndex: 9999,
    pointerEvents: 'none',
  },
  bar: {
    height: '100%',
    background: 'linear-gradient(90deg, #E06C4D, #EF8265)',
    boxShadow: '0 0 10px rgba(224, 108, 77, 0.45)',
    borderRadius: '0 2px 2px 0',
    transition: 'width 0.3s ease, opacity 0.2s ease',
  },
}
