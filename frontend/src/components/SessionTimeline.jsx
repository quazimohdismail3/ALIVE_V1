/** SessionTimeline — horizontal phase arc indicator. */
const PHASE_COLORS = {
  // find_your_calm
  ACKNOWLEDGE: '#7C6FF7',
  SLOW:        '#1D9E75',
  ANCHOR:      '#00D084',
  RELEASE:     '#534AB7',
  // wind_down
  MEET:        '#7C6FF7',
  DECELERATE:  '#1D9E75',
  DEEPEN:      '#00D084',
  DISSOLVE:    '#534AB7',
  MONITOR:     '#7A7A96',
  // morning_emergence
  ORIENT:      '#EF9F27',
  ACTIVATE:    '#E24B4A',
  ENERGIZE:    '#EF9F27',
  PRIME:       '#00D084',
};

export function SessionTimeline({ currentPhase, sessionType, elapsed, duration }) {
  const progress = duration > 0 ? Math.min(1, elapsed / duration) : 0;
  const color = PHASE_COLORS[currentPhase] ?? '#7C6FF7';

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
        <span style={{ color, fontSize: 13, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          {currentPhase ?? '—'}
        </span>
        <span style={{ color: '#7A7A96', fontSize: 12 }}>
          {Math.floor(elapsed / 60)}:{String(Math.floor(elapsed % 60)).padStart(2, '0')} / {Math.floor(duration / 60)}min
        </span>
      </div>
      <div style={{ height: 4, background: 'var(--surface-2)', borderRadius: 4, overflow: 'hidden' }}>
        <div style={{
          height: '100%', borderRadius: 4,
          width: `${progress * 100}%`,
          background: color,
          transition: 'width 1000ms linear, background 600ms ease',
        }} />
      </div>
    </div>
  );
}
