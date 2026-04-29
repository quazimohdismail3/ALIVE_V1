/** MusicParams — displays current music engine parameters. */
const PARAM_LABELS = {
  tempo:         { label: 'Tempo', unit: 'bpm' },
  volume:        { label: 'Volume', unit: '%', scale: 100 },
  reverb:        { label: 'Reverb', unit: '%', scale: 100 },
  harmonicity:   { label: 'Harmony', unit: '%', scale: 100 },
  binaural_beat: { label: 'Binaural', unit: 'Hz' },
};

export function MusicParams({ params, strategy }) {
  if (!params) return null;
  const keys = Object.keys(PARAM_LABELS).filter(k => params[k] != null);

  return (
    <div>
      {strategy && (
        <div style={{ color: '#7A7A96', fontSize: 11, marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          Strategy · {strategy}
        </div>
      )}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        {keys.map(k => {
          const def = PARAM_LABELS[k];
          const val = def.scale ? Math.round(params[k] * def.scale) : Math.round(params[k] * 10) / 10;
          return (
            <div key={k} style={{ background: 'var(--surface-2)', borderRadius: 8, padding: '6px 10px', textAlign: 'center' }}>
              <div style={{ color: 'var(--text)', fontSize: 16, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                {val}<span style={{ fontSize: 10, color: '#7A7A96', marginLeft: 2 }}>{def.unit}</span>
              </div>
              <div style={{ color: '#7A7A96', fontSize: 10 }}>{def.label}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
