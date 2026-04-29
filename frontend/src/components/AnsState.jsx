/** AnsState — displays current ANS polyvagal state with color glow. */
const ANS_LABELS = {
  ventral_vagal:       { label: 'Ventral Vagal',       color: '#00D084' },
  healthy_sympathetic: { label: 'Healthy Sympathetic',  color: '#EF9F27' },
  anxious_sympathetic: { label: 'Anxious Sympathetic',  color: '#E24B4A' },
  dorsal_vagal:        { label: 'Dorsal Vagal',         color: '#534AB7' },
  burnout_rigidity:    { label: 'Burnout / Rigidity',   color: '#7A7A96' },
};

export function AnsState({ state, confidence, actionable }) {
  const info = ANS_LABELS[state] ?? { label: state ?? '—', color: '#7C6FF7' };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <div style={{
        width: 12, height: 12, borderRadius: '50%',
        background: info.color,
        boxShadow: `0 0 8px ${info.color}`,
        flexShrink: 0,
      }} />
      <div>
        <div style={{ color: info.color, fontWeight: 600, fontSize: 14 }}>{info.label}</div>
        {confidence != null && (
          <div style={{ color: '#7A7A96', fontSize: 11 }}>
            {Math.round(confidence * 100)}% confidence
            {actionable === false && ' · monitoring'}
          </div>
        )}
      </div>
    </div>
  );
}
