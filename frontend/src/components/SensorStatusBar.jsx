/** SensorStatusBar — shows active sensors and their status. */
const DOT = ({ ok }) => (
  <div style={{
    width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
    background: ok ? '#00D084' : '#E24B4A',
    boxShadow: ok ? '0 0 6px #00D084' : 'none',
  }} />
);

export function SensorStatusBar({ mode, sensorStatus, rfLocked, sqi }) {
  // Mirrors SensorFusion.start():
  //   mode 1 = rPPG + mic
  //   mode 2 = H10 + mic
  //   mode 3 = H10 + mic + face + pose (front-cam stack)
  const ok = sensorStatus === 'ready';
  const sensors = [];
  if (mode === 1) sensors.push({ label: 'rPPG', ok });
  if (mode === 2 || mode === 3) sensors.push({ label: 'H10', ok });
  sensors.push({ label: 'Mic', ok });
  if (mode === 3) {
    sensors.push({ label: 'Face', ok });
    sensors.push({ label: 'Pose', ok });
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
