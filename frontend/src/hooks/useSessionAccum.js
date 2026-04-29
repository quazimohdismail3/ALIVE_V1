import { useRef, useCallback } from 'react';

/**
 * useSessionAccum — accumulates per-frame WS data for end-of-session summary.
 *
 * Call push(frame) on each live WS frame.
 * Call summarize() at session end → returns InsightData shape.
 */
export function useSessionAccum() {
  const frames  = useRef([]);
  const peakVS  = useRef(0);

  const push = useCallback((frame) => {
    frames.current.push(frame);
    const vs = frame.vs?.vs ?? 0;
    if (vs > peakVS.current) peakVS.current = vs;
  }, []);

  const summarize = useCallback(() => {
    const all = frames.current;
    if (all.length === 0) return null;

    const last    = all[all.length - 1];
    const finalVS = last.vs?.vs ?? 0;
    const peak    = peakVS.current;

    const rmssdValues = all.map(f => f.metrics?.rmssd).filter(Boolean);
    const avgRmssd    = rmssdValues.length
      ? rmssdValues.reduce((a, b) => a + b, 0) / rmssdValues.length
      : null;

    const ansCounts = {};
    all.forEach(f => {
      const s = f.ans?.state;
      if (s) ansCounts[s] = (ansCounts[s] || 0) + 1;
    });
    const dominantAns = Object.entries(ansCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

    return {
      peak_vs:            Math.round(peak),
      final_vs:           Math.round(finalVS),
      skill_transfer:     peak > 0 ? Math.round((finalVS / peak) * 100) : null,
      avg_rmssd:          avgRmssd ? Math.round(avgRmssd) : null,
      dominant_ans:       dominantAns,
      rf_locked:          last.rf_locked ?? false,
      rf_bpm:             last.rf_bpm ?? null,
      session_phase:      last.session_phase ?? null,
      session_type:       last.session_type ?? null,
      duration_s:         Math.round(last.t ?? 0),
      circadian_phase:    null,   // filled by Setup screen before session
      circadian_fit:      null,
      frames_total:       all.length,
    };
  }, []);

  const reset = useCallback(() => {
    frames.current = [];
    peakVS.current = 0;
  }, []);

  return { push, summarize, reset };
}
