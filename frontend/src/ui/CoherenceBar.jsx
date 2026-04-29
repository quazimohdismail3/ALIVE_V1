// frontend/src/ui/CoherenceBar.jsx
export default function CoherenceBar({ coherence = 0, locked = false }) {
    const pct = Math.round(Math.min(1, Math.max(0, coherence)) * 100);
    const color = locked ? '#1D9E75' : pct > 50 ? '#EF9F27' : '#555';
    return (
        <div style={{ margin: '12px 0' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between',
                          fontSize: 12, color: '#666', marginBottom: 5 }}>
                <span>Flow state</span>
                <span style={{ color: locked ? '#1D9E75' : '#666' }}>
                    {pct}%{locked ? ' · Rhythm locked' : ''}
                </span>
            </div>
            <div style={{ background: '#1a1a1a', borderRadius: 4, height: 5 }}>
                <div style={{ width: `${pct}%`, background: color, height: '100%',
                              borderRadius: 4, transition: 'width 1.2s ease, background 1s ease' }} />
            </div>
        </div>
    );
}
