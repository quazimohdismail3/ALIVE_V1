import React from 'react'

const DEFAULT_COLORS = [
  'var(--accent-amber)',
  'var(--accent-rose)',
  'var(--accent-purple)',
  'var(--accent-teal)',
]

/**
 * SVG sine-wave animator.
 * Each path streams left-to-right via stroke-dashoffset CSS animation.
 *
 * Props:
 *   colors  – array of CSS color strings (default: amber/rose/purple/teal)
 *   opacity – base opacity (default 0.35)
 *   width   – SVG width (default "100%")
 *   height  – SVG height (default 80)
 */
export default function FlowingWaves({
  colors = DEFAULT_COLORS,
  opacity = 0.35,
  width = '100%',
  height = 80,
}) {
  const w = 400  // viewBox width
  const h = height

  // Build sine-wave path strings with different amplitude/frequency
  const waves = colors.map((color, i) => {
    const amp    = 8 + i * 4            // amplitude: 8, 12, 16, 20
    const freq   = 0.018 - i * 0.003    // frequency: slightly different
    const yBase  = h / 2 + (i - 1.5) * 6
    const dur    = 3 + i * 1.8          // animation duration
    const offset = i * 30              // phase offset

    let d = `M 0 ${yBase}`
    for (let x = 0; x <= w; x += 4) {
      const y = yBase + Math.sin((x + offset) * freq * Math.PI * 2) * amp
      d += ` L ${x} ${y}`
    }
    // dasharray ≈ total path length; animate offset for flow effect
    const dash = w * 1.6

    return { color, dur, dash, d, opacity: opacity * (1 - i * 0.08) }
  })

  return (
    <svg
      width={width}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      aria-hidden="true"
      style={{ display: 'block', overflow: 'visible' }}
    >
      {waves.map((w, i) => (
        <path
          key={i}
          d={w.d}
          stroke={w.color}
          strokeWidth={1.5}
          fill="none"
          opacity={w.opacity}
          style={{
            strokeDasharray: w.dash,
            strokeDashoffset: w.dash,
            animation: `waveFlow ${w.dur}s linear infinite`,
          }}
        />
      ))}
    </svg>
  )
}
