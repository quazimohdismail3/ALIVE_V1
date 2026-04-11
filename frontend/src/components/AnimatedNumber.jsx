import React, { useEffect, useRef, useState } from 'react'

/**
 * Smoothly counts from the previous value to `value` on mount/update.
 *
 * Props:
 *   value    – target number
 *   duration – animation duration in ms (default 1200)
 *   suffix   – text appended after the number (e.g. 'ms', 'bpm', '%')
 *   decimals – decimal places (default 0)
 */
export default function AnimatedNumber({
  value,
  duration = 1200,
  suffix = '',
  decimals = 0,
}) {
  const [displayed, setDisplayed] = useState(value ?? 0)
  const frameRef = useRef(null)
  const startRef = useRef(null)
  const fromRef  = useRef(displayed)

  useEffect(() => {
    if (value == null) return
    const from = fromRef.current
    const to   = value

    if (frameRef.current) cancelAnimationFrame(frameRef.current)
    startRef.current = null

    const step = (ts) => {
      if (!startRef.current) startRef.current = ts
      const elapsed = ts - startRef.current
      const progress = Math.min(elapsed / duration, 1)
      // ease-out cubic
      const eased = 1 - Math.pow(1 - progress, 3)
      const current = from + (to - from) * eased
      setDisplayed(current)
      if (progress < 1) {
        frameRef.current = requestAnimationFrame(step)
      } else {
        fromRef.current = to
      }
    }

    frameRef.current = requestAnimationFrame(step)
    return () => { if (frameRef.current) cancelAnimationFrame(frameRef.current) }
  }, [value, duration])

  const formatted = displayed.toFixed(decimals)

  return (
    <span style={{ fontVariantNumeric: 'tabular-nums' }}>
      {formatted}{suffix}
    </span>
  )
}
