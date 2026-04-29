/** InsightCard — a single insight item on the debrief screen. */
export function InsightCard({ icon, title, value, sub, accent }) {
  return (
    <div className="v2-card" style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
      {icon && (
        <div style={{
          width: 40, height: 40, borderRadius: 10, flexShrink: 0,
          background: accent ? `${accent}22` : 'var(--surface-2)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 20,
        }}>
          {icon}
        </div>
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ color: '#7A7A96', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 2 }}>{title}</div>
        <div style={{ color: accent ?? 'var(--text)', fontWeight: 600, fontSize: 18, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
        {sub && <div style={{ color: '#7A7A96', fontSize: 12, marginTop: 2 }}>{sub}</div>}
      </div>
    </div>
  );
}
