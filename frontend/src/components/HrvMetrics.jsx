/** HrvMetrics — compact grid of key HRV values. */
function Metric({ label, value, unit, dim }) {
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ color: dim ? '#7A7A96' : 'var(--text)', fontSize: 20, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
        {value != null ? Math.round(value) : '—'}
        {unit && <span style={{ fontSize: 11, color: '#7A7A96', marginLeft: 2 }}>{unit}</span>}
      </div>
      <div style={{ color: '#7A7A96', fontSize: 10, marginTop: 2, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</div>
    </div>
  );
}

export function HrvMetrics({ metrics }) {
  if (!metrics) return null;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
      <Metric label="RMSSD" value={metrics.rmssd} unit="ms" />
      <Metric label="SDNN"  value={metrics.sdnn}  unit="ms" />
      <Metric label="HR"    value={metrics.hr_bpm} unit="bpm" />
      <Metric label="LF/HF" value={metrics.lf_hf != null ? (metrics.lf_hf).toFixed(1) : null} dim={metrics.lf_hf == null} />
    </div>
  );
}
