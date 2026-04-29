/** AffectQuadrant — 2D arousal/valence dot on circumplex grid. */
export function AffectQuadrant({ arousal, valence, quadrant }) {
  // arousal and valence: -1..1 normalized from backend
  const x = ((valence  ?? 0) + 1) / 2 * 100;  // 0..100%
  const y = (1 - ((arousal ?? 0) + 1) / 2) * 100;

  return (
    <div style={{ position: 'relative', width: '100%', paddingTop: '100%', background: 'var(--surface-2)', borderRadius: 12, overflow: 'hidden' }}>
      {/* axes */}
      <div style={{ position: 'absolute', inset: 0 }}>
        <div style={{ position: 'absolute', left: '50%', top: 0, bottom: 0, width: 1, background: 'rgba(255,255,255,0.08)' }} />
        <div style={{ position: 'absolute', top: '50%', left: 0, right: 0, height: 1, background: 'rgba(255,255,255,0.08)' }} />
        {/* labels */}
        <span style={{ position: 'absolute', top: 6, left: '50%', transform: 'translateX(-50%)', color: '#7A7A96', fontSize: 10 }}>High</span>
        <span style={{ position: 'absolute', bottom: 6, left: '50%', transform: 'translateX(-50%)', color: '#7A7A96', fontSize: 10 }}>Low</span>
        <span style={{ position: 'absolute', left: 6, top: '50%', transform: 'translateY(-50%)', color: '#7A7A96', fontSize: 10 }}>−</span>
        <span style={{ position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)', color: '#7A7A96', fontSize: 10 }}>+</span>
        {/* dot */}
        <div style={{
          position: 'absolute',
          left: `${x}%`, top: `${y}%`,
          width: 12, height: 12,
          borderRadius: '50%',
          background: 'var(--primary)',
          boxShadow: '0 0 10px var(--primary)',
          transform: 'translate(-50%, -50%)',
          transition: 'left 800ms ease, top 800ms ease',
        }} />
      </div>
      {quadrant && (
        <div style={{ position: 'absolute', bottom: 6, right: 8, color: '#7A7A96', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          {quadrant.replace('_', ' ')}
        </div>
      )}
    </div>
  );
}
