import React, { useMemo } from 'react'

/**
 * Full-screen cosmic background layer.
 * Renders behind all screen content via position:absolute, z-index:-1.
 * Includes animated nebula blobs + randomised star particles.
 */
export default function CosmicBackground() {
  // Generate star particles once (stable across re-renders)
  const stars = useMemo(() => {
    const arr = []
    for (let i = 0; i < 70; i++) {
      arr.push({
        id: i,
        top: Math.random() * 100,
        left: Math.random() * 100,
        size: 0.8 + Math.random() * 1.4,
        delay: Math.random() * 6,
        duration: 3 + Math.random() * 5,
        opacity: 0.2 + Math.random() * 0.5,
      })
    }
    return arr
  }, [])

  return (
    <div aria-hidden="true" style={{
      position: 'absolute',
      inset: 0,
      zIndex: -1,
      pointerEvents: 'none',
      overflow: 'hidden',
    }}>
      {/* Nebula blobs */}
      <div className="cosmic-blob cosmic-blob--amber" />
      <div className="cosmic-blob cosmic-blob--rose" />
      <div className="cosmic-blob cosmic-blob--purple" />

      {/* Star particles */}
      {stars.map(s => (
        <span
          key={s.id}
          style={{
            position: 'absolute',
            top: `${s.top}%`,
            left: `${s.left}%`,
            width: s.size,
            height: s.size,
            borderRadius: '50%',
            background: '#fff',
            opacity: s.opacity,
            animation: `cosmicTwinkle ${s.duration}s ${s.delay}s ease-in-out infinite`,
          }}
        />
      ))}
    </div>
  )
}
