/** SensorStatusBar — shows active sensors and their status. */
const DOT = ({ ok }) => (
  <div style={{
    width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
    background: ok ? '#00D084' : '#E24B4A',
    boxShadow: ok ? '0 0 6px #00D084' : 'none',
  }} />
);

export function SensorStatusBar({ mode, sensorStatus, rfLocked, sqi }) {
  const sensors = [];
  if (mode === 1) sensors.push({ label: 'rPPG', ok: sensorStatus === 'ready' });
  if (mode === 2 || mode === 3) sensors.push({ label: 'H10', ok: sensorStatus === 'ready' });
  if (mode !== 2) {
    sensors.push({ label: 'Face', ok: sensorStatus === 'ready' });
    sensors.push({ label: 'Pose', ok: sensorStatus === 'ready' });
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
      {sensors.map(s => (
        <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <DOT ok={s.ok} />
          <span style={{ color: '#7A7A96', fontSize: 12 }}>{s.label}</span>
        </div>
      ))}
      {rfLocked != null && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <DOT ok={rfLocked} />
          <span style={{ color: '#7A7A96', fontSize: 12 }}>RF{rfLocked ? ' ✓' : '…'}</span>
        </div>
      )}
      {sqi != null && (
        <div style={{ color: sqi >= 0.75 ? '#00D084' : '#EF9F27', fontSize: 12 }}>
          SQI {Math.round(sqi * 100)}%
        </div>
      )}
    </div>
  );
}
