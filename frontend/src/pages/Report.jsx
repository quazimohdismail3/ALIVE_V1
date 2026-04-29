// frontend/src/pages/Report.jsx
// Always shows R1, R2, R8, R16. Conditional: R15 (mode 1), R17 (circadian mismatch).

const BEST_PHASE_FOR_SESSION = {
    find_your_calm:    'evening or midday',
    wind_down:         'evening or night',
    morning_emergence: 'morning (6–9am)',
};

const SESSION_LABEL = {
    find_your_calm:    'Find Your Calm',
    wind_down:         'Wind Down',
    morning_emergence: 'Morning Emergence',
};

export default function Report({ sessionData, onDone }) {
    if (!sessionData) {
        return (
            <div style={{ padding: 32, fontFamily: 'system-ui', color: '#fff',
                          background: '#0a0a0a', minHeight: '100dvh' }}>
                No session data.
                <button onClick={onDone} style={{ display: 'block', marginTop: 24 }}>
                    Back
                </button>
            </div>
        );
    }

    const {
        peak_vs = 0, final_vs = 0, mode = 2,
        skill_transfer_score, hrv_summary = {},
        circadian_phase = '', circadian_fit_score = 0.5,
        session_type = '', phases_completed = [],
    } = sessionData;

    const insights = [];

    // R1 — VS summary (always)
    insights.push({
        id: 'R1',
        content: `Nervous system harmony reached ${peak_vs}/100. Final reading: ${final_vs}/100.`,
    });

    // R2 — RMSSD change (always)
    const rmssdStart = hrv_summary.rmssd_start?.toFixed(1) ?? '—';
    const rmssdEnd = hrv_summary.rmssd_end?.toFixed(1) ?? '—';
    insights.push({
        id: 'R2',
        content: `Nervous system harmony: ${rmssdStart}ms → ${rmssdEnd}ms.`,
    });

    // R8 — State journey (always)
    const journey = phases_completed.length > 0
        ? phases_completed.map(p => p.phase).join(' → ')
        : 'Session recorded';
    insights.push({ id: 'R8', content: `Session arc: ${journey}.` });

    // R16 — Skill transfer (always, when data available)
    const st = skill_transfer_score ?? (peak_vs > 0 ? round2(final_vs / peak_vs) : null);
    if (st !== null) {
        const held = st > 0.85;
        insights.push({
            id: 'R16',
            content: `Post-session reading: ${final_vs}/100 (peak was ${peak_vs}/100). Skill transfer: ${Math.round(st * 100)}%. ${held ? 'Regulation is self-sustaining.' : 'Continued practice will improve autonomous regulation.'}`,
        });
    }

    // R15 — Mode 1 signal quality (conditional)
    if (mode === 1) {
        insights.push({
            id: 'R15',
            content: 'Session used phone sensors only (no external hardware). HRV estimates are indicative, not ECG-grade. Connect Polar H10 for research-grade accuracy.',
            warn: true,
        });
    }

    // R17 — Circadian mismatch (conditional)
    if (circadian_fit_score < 0.4) {
        const best = BEST_PHASE_FOR_SESSION[session_type] ?? 'an optimal time';
        insights.push({
            id: 'R17',
            content: `Session ran during ${circadian_phase || 'a suboptimal window'} — not ideal for ${SESSION_LABEL[session_type] ?? session_type}. Best time: ${best}. Results may underestimate your regulation capacity.`,
            warn: true,
        });
    }

    return (
        <div style={{ padding: '32px 20px', maxWidth: 480, margin: '0 auto',
                      fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
                      color: '#fff', minHeight: '100dvh', background: '#0a0a0a',
                      boxSizing: 'border-box' }}>
            <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 24 }}>
                Session complete
            </div>
            {insights.map(ins => (
                <div key={ins.id} style={{
                    padding: '14px 16px', marginBottom: 12, borderRadius: 12,
                    background: ins.warn ? '#110d00' : '#111',
                    border: `1px solid ${ins.warn ? '#3a2a00' : '#1e1e1e'}`,
                }}>
                    <div style={{ fontSize: 10, color: '#444', marginBottom: 5,
                                  letterSpacing: '0.06em' }}>{ins.id}</div>
                    <div style={{ fontSize: 14, lineHeight: 1.5, color: ins.warn ? '#c8a040' : '#ccc' }}>
                        {ins.content}
                    </div>
                </div>
            ))}
            <button onClick={onDone} style={{
                width: '100%', padding: 16, marginTop: 12, borderRadius: 12,
                background: '#534AB7', border: 'none', color: '#fff',
                cursor: 'pointer', fontSize: 16, fontWeight: 600,
            }}>
                New session
            </button>
        </div>
    );
}

function round2(n) { return Math.round(n * 100) / 100; }
