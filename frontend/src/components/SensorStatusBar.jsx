// frontend/src/components/SensorStatusBar.jsx
import { useSensorContext } from '../context/SensorContext.jsx'

const DOT_BASE = {
    width: 8, height: 8, borderRadius: '50%', flexShrink: 0, display: 'inline-block',
}

function StatusDot({ status }) {
    const color = {
        connected:     '#00D084',
        active:        '#00D084',
        open:          '#00D084',
        reconnecting:  '#EF9F27',
        fallback_rppg: '#EF9F27',
        failed:        '#E24B4A',
        error:         '#E24B4A',
        unavailable:   '#E24B4A',
        closed:        '#E24B4A',
        idle:          '#555',
    }[status] ?? '#555'
    const pulse = status === 'reconnecting'
    return (
        <div style={{
            ...DOT_BASE,
            background: color,
            boxShadow: color !== '#555' ? `0 0 6px ${color}` : 'none',
            animation: pulse ? 'pulse-dot 1s ease-in-out infinite' : 'none',
        }} />
    )
}

export function SensorStatusBar({ rfLocked, sqi }) {
    const { bleStatus, micStatus, latestHR } = useSensorContext()

    const bleLabel = {
        fallback_rppg: 'rPPG (H10 fallback)',
        reconnecting:  'H10 (retry…)',
    }[bleStatus] ?? 'H10'

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <StatusDot status={bleStatus} />
                    <span style={{ color: '#7A7A96', fontSize: 12 }}>{bleLabel}</span>
                    {latestHR != null && bleStatus === 'connected' && (
                        <span style={{ color: '#fff', fontSize: 12, marginLeft: 2 }}>
                            {latestHR} bpm
                        </span>
                    )}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <StatusDot status={micStatus} />
                    <span style={{ color: '#7A7A96', fontSize: 12 }}>Mic</span>
                </div>
                {rfLocked != null && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                        <StatusDot status={rfLocked ? 'connected' : 'reconnecting'} />
                        <span style={{ color: '#7A7A96', fontSize: 12 }}>RF{rfLocked ? ' ✓' : '…'}</span>
                    </div>
                )}
                {sqi != null && (
                    <div style={{ color: sqi >= 0.75 ? '#00D084' : '#EF9F27', fontSize: 12 }}>
                        SQI {Math.round(sqi * 100)}%
                    </div>
                )}
            </div>
            {bleStatus === 'fallback_rppg' && (
                <div style={{
                    fontSize: 11, color: '#EF9F27',
                    background: 'rgba(239,159,39,0.1)',
                    padding: '3px 8px', borderRadius: 4, alignSelf: 'flex-start',
                }}>
                    H10 unavailable — using phone camera for HR
                </div>
            )}
        </div>
    )
}
