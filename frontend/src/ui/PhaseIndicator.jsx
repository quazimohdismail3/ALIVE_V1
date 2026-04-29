// frontend/src/ui/PhaseIndicator.jsx
const LABELS = {
    ACKNOWLEDGE: 'Acknowledging', SLOW: 'Slowing down', ANCHOR: 'Anchoring',
    RELEASE: 'Releasing', MEET: 'Meeting you here', DECELERATE: 'Decelerating',
    DEEPEN: 'Deepening', DISSOLVE: 'Dissolving', MONITOR: 'Resting',
    ORIENT: 'Orienting', ACTIVATE: 'Activating', ENERGIZE: 'Energizing', PRIME: 'Priming',
};

export default function PhaseIndicator({ phase = '' }) {
    const label = LABELS[phase] || '';
    if (!label) return null;
    return (
        <div style={{ textAlign: 'center', color: '#555', fontSize: 12,
                      letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 8 }}>
            {label}
        </div>
    );
}
