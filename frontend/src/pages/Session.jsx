// frontend/src/pages/Session.jsx
import { useEffect, useRef, useState } from 'react';
import { WSClient } from '../utils/ws_client.js';
import VsDisplay from '../ui/VsDisplay.jsx';
import BreathRing from '../ui/BreathRing.jsx';
import CoherenceBar from '../ui/CoherenceBar.jsx';
import PhaseIndicator from '../ui/PhaseIndicator.jsx';
import { SensorFusion } from '../sensors/sensor_fusion.js';

const INITIAL = {
    vs: { vs: 0, confidence: 'LOW' },
    state: '',
    rf_bpm: 6,
    rf_locked: false,
    rf_coherence: 0,
    session_phase: '',
    vs_history: [],
};

export default function Session({ mode, token, session, onEnd }) {
    const [data, setData] = useState(INITIAL);
    const wsRef = useRef(null);
    const fusionRef = useRef(null);
    const sendIntervalRef = useRef(null);

    useEffect(() => {
        const sessionId = `${token}-${Date.now()}`;
        const ws = new WSClient(sessionId, mode, (msg) => {
            if (msg.type === 'state_update') setData(msg);
        });
        ws.connect();
        wsRef.current = ws;

        const fusion = new SensorFusion(mode);
        fusionRef.current = fusion;

        fusion.start().then(() => {
            sendIntervalRef.current = setInterval(() => {
                const reading = fusion.getReading();
                if (reading?.rr?.rr_ms?.length > 0) {
                    const latest = reading.rr.rr_ms.slice(-5);
                    latest.forEach(rr => ws.send({
                        type: 'rr_interval', rr_ms: rr,
                        timestamp: Date.now() / 1000, source: reading.rr.source
                    }));
                }
                if (reading?.face) ws.send({ type: 'sensor_update', sensor: 'facemesh', data: reading.face });
                if (reading?.pose) ws.send({ type: 'sensor_update', sensor: 'pose', data: reading.pose });
                if (reading?.breath) ws.send({ type: 'sensor_update', sensor: 'breath', data: reading.breath });
            }, 500);
        });

        return () => {
            ws.close();
            fusion.stop();
            if (sendIntervalRef.current) clearInterval(sendIntervalRef.current);
        };
    }, []);

    const vs = typeof data.vs === 'object' ? (data.vs?.vs ?? 0) : (data.vs ?? 0);
    const conf = typeof data.vs === 'object' ? (data.vs?.confidence ?? 'LOW') : 'LOW';

    return (
        <div style={{ padding: '24px 20px', maxWidth: 480, margin: '0 auto',
                      fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
                      color: '#fff', minHeight: '100dvh', background: '#0a0a0a',
                      boxSizing: 'border-box' }}>
            <PhaseIndicator phase={data.session_phase} />
            <VsDisplay vs={vs} confidence={conf} history={data.vs_history ?? []} />
            <BreathRing rfBpm={data.rf_bpm} locked={data.rf_locked} />
            <CoherenceBar coherence={data.rf_coherence} locked={data.rf_locked} />
            <div style={{ marginTop: 32, textAlign: 'center' }}>
                <button onClick={onEnd}
                        style={{ padding: '12px 32px', borderRadius: 10, fontSize: 14,
                                 background: 'transparent', border: '1px solid #2a2a2a',
                                 color: '#444', cursor: 'pointer' }}>
                    End session
                </button>
            </div>
        </div>
    );
}
