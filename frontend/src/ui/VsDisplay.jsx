// frontend/src/ui/VsDisplay.jsx
const BANDS = [
    { max: 30,  color: '#E24B4A', label: 'Low energy' },
    { max: 55,  color: '#EF9F27', label: 'High tension' },
    { max: 75,  color: '#1D9E75', label: 'Calm & Clear' },
    { max: 100, color: '#534AB7', label: 'In the zone' },
];

function vsColor(vs) { return BANDS.find(b => vs <= b.max)?.color ?? '#1D9E75'; }
function vsLabel(vs) { return BANDS.find(b => vs <= b.max)?.label ?? ''; }

export default function VsDisplay({ vs = 0, confidence = 'LOW', history = [] }) {
    const color = vsColor(vs);
    const W = 220, H = 44;
    const maxV = Math.max(...history, 1);
    const pts = history.length > 1
        ? history.map((v, i) =>
            `${(i / (history.length - 1)) * W},${H - (v / maxV) * H}`).join(' ')
        : '';

    return (
        <div style={{ textAlign: 'center', padding: '16px 0' }}>
            <div style={{ fontSize: 80, fontWeight: 700, color, lineHeight: 1,
                          fontVariantNumeric: 'tabular-nums' }}>{vs}</div>
            <div style={{ color: '#666', fontSize: 13, marginTop: 4 }}>
                {vsLabel(vs)} · {confidence}
            </div>
            {pts && (
                <svg width={W} height={H} style={{ marginTop: 10, display: 'block', margin: '10px auto 0' }}>
                    <polyline points={pts} fill="none" stroke={color} strokeWidth={2} opacity={0.7} />
                </svg>
            )}
        </div>
    );
}
