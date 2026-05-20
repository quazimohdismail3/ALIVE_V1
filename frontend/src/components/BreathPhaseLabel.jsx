import { useEffect, useRef, useState } from 'react';

const PHASES = [
  { from: 0.00, to: 0.40, word: 'INHALE' },
  { from: 0.40, to: 0.50, word: 'HOLD' },
  { from: 0.50, to: 0.90, word: 'EXHALE' },
  { from: 0.90, to: 1.00, word: 'PAUSE' },
];

function pickPhase(fraction) {
  for (const p of PHASES) {
    if (fraction >= p.from && fraction < p.to) return p.word;
  }
  return 'BREATHE';
}

function readPeriodSeconds() {
  try {
    const root = document.documentElement;
    const measured = getComputedStyle(root).getPropertyValue('--rf-measured-period').trim();
    const calibrated = getComputedStyle(root).getPropertyValue('--rf-calibrated-period').trim();
    const raw = measured || calibrated || '10s';
    const n = parseFloat(raw);
    if (!Number.isFinite(n) || n <= 0) return 10;
    return raw.endsWith('ms') ? n / 1000 : n;
  } catch {
    return 10;
  }
}

export function BreathPhaseLabel({ color = 'rgba(255,255,255,0.55)' }) {
  const [phase, setPhase] = useState('BREATHE');
  const startRef = useRef(performance.now());
  const periodRef = useRef(readPeriodSeconds());
  const rafRef = useRef(null);

  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) {
      setPhase('BREATHE');
      return;
    }

    let mounted = true;

    const tick = () => {
      if (!mounted) return;
      const now = performance.now();
      const nextPeriod = readPeriodSeconds();
      if (Math.abs(nextPeriod - periodRef.current) > 0.05) {
        periodRef.current = nextPeriod;
        startRef.current = now;
      }
      const t = ((now - startRef.current) / 1000) % periodRef.current;
      const fraction = t / periodRef.current;
      const next = pickPhase(fraction);
      setPhase((prev) => (prev === next ? prev : next));
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      mounted = false;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  return (
    <div
      aria-live="polite"
      style={{
        fontSize: 10,
        fontWeight: 600,
        letterSpacing: '0.18em',
        lineHeight: 1,
        minHeight: 14,
        color,
        textAlign: 'center',
        textTransform: 'uppercase',
        transition: 'color 800ms ease, opacity 600ms ease',
      }}
    >
      {phase}
    </div>
  );
}

export default BreathPhaseLabel;
