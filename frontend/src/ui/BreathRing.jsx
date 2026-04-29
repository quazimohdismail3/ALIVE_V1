// frontend/src/ui/BreathRing.jsx
import { useEffect, useState } from 'react';

export default function BreathRing({ rfBpm = 6, locked = false }) {
    const [scale, setScale] = useState(1);

    useEffect(() => {
        const periodMs = (60 / Math.max(rfBpm, 1)) * 1000;
        let frame;
        const start = Date.now();
        function tick() {
            const t = ((Date.now() - start) % periodMs) / periodMs;
            setScale(1 + 0.38 * Math.sin(t * Math.PI * 2));
            frame = requestAnimationFrame(tick);
        }
        frame = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(frame);
    }, [rfBpm]);

    const color = locked ? '#1D9E75' : '#534AB7';
    return (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center',
                      height: 160, margin: '8px 0' }}>
            <div style={{
                width: 110, height: 110, borderRadius: '50%',
                border: `3px solid ${color}`,
                transform: `scale(${scale})`,
                transition: 'border-color 1s ease',
                boxShadow: locked ? `0 0 24px ${color}55` : 'none',
            }} />
        </div>
    );
}
