// frontend/src/config/sessions.js
// Single source of truth: session types, phase arcs (ISO principle), durations, circadian fit

export const SESSIONS = {
  find_your_calm: {
    id: 'find_your_calm',
    label: 'Find Your Calm',
    icon: '◎',
    colorKey: 'teal',
    description: 'Shift from activation to balance. Science-backed RF breathing + alpha entrainment.',
    durations: [
      { label: '15 min', value: 900, description: 'Quick reset' },
      { label: '25 min', value: 1500, description: 'Full protocol' },
      { label: '40 min', value: 2400, description: 'Deep practice' },
    ],
    circadian: { best: [20, 22], decent: [12, 20] },
    phases: {
      ACKNOWLEDGE: {
        durationFraction: 0.15,
        binaural: 10, carrier: 174, breathVol: 0.0, breathRate: null,
        isoTarget: { arousal: 0.65, valence: 0.4, stability: 0.35, coherence: 0.25 },
        copy: 'Your heart is slightly activated. The music is meeting you here.',
      },
      SLOW: {
        durationFraction: 0.30,
        binaural: 8.5, carrier: 174, breathVol: 0.2, breathRate: 5.5,
        isoTarget: { arousal: 0.45, valence: 0.55, stability: 0.55, coherence: 0.45 },
      },
      ANCHOR: {
        durationFraction: 0.35,
        binaural: 7.5, carrier: 256, breathVol: 0.4, breathRate: 5.5,
        isoTarget: { arousal: 0.3, valence: 0.7, stability: 0.7, coherence: 0.65 },
      },
      RELEASE: {
        durationFraction: 0.20,
        binaural: 6, carrier: 256, breathVol: 0.2, breathRate: 5.5,
        isoTarget: { arousal: 0.2, valence: 0.8, stability: 0.8, coherence: 0.8 },
      },
    },
  },

  wind_down: {
    id: 'wind_down',
    label: 'Wind Down',
    icon: '◑',
    colorKey: 'indigo',
    description: 'Prepare body and mind for deep, restorative sleep.',
    durations: [
      { label: '20 min', value: 1200, description: 'Light wind-down' },
      { label: '30 min', value: 1800, description: 'Full protocol' },
      { label: '45 min', value: 2700, description: 'Deep sleep prep' },
    ],
    circadian: { best: [21, 24], decent: [18, 24] },
    phases: {
      MEET: {
        durationFraction: 0.15,
        binaural: 10, carrier: 174, breathVol: 0.1,
        isoTarget: { arousal: 0.5, valence: 0.5, stability: 0.4, coherence: 0.3 },
      },
      DECELERATE: {
        durationFraction: 0.25,
        binaural: 6, carrier: 174, breathVol: 0.1,
        isoTarget: { arousal: 0.35, valence: 0.6, stability: 0.55, coherence: 0.5 },
      },
      DEEPEN: {
        durationFraction: 0.30,
        binaural: 4, carrier: 128, breathVol: 0.1,
        isoTarget: { arousal: 0.2, valence: 0.65, stability: 0.7, coherence: 0.65 },
      },
      DISSOLVE: {
        durationFraction: 0.20,
        binaural: 2, carrier: 128, breathVol: 0.0,
        isoTarget: { arousal: 0.1, valence: 0.7, stability: 0.85, coherence: 0.8 },
      },
      MONITOR: {
        durationFraction: 0.10,
        binaural: 1.5, carrier: 128, breathVol: 0.0,
        isoTarget: { arousal: 0.05, valence: 0.7, stability: 0.9, coherence: 0.9 },
      },
    },
  },

  morning_emergence: {
    id: 'morning_emergence',
    label: 'Morning Emergence',
    icon: '◐',
    colorKey: 'gold',
    description: 'Activate healthy sympathetic tone for focused, energised presence.',
    durations: [
      { label: '10 min', value: 600, description: 'Quick activation' },
      { label: '18 min', value: 1080, description: 'Full protocol' },
      { label: '25 min', value: 1500, description: 'Deep activation' },
    ],
    circadian: { best: [5, 9], decent: [9, 11] },
    phases: {
      ORIENT: {
        durationFraction: 0.20,
        binaural: 6, carrier: 256, breathVol: 0.0,
        isoTarget: { arousal: 0.3, valence: 0.5, stability: 0.6, coherence: 0.5 },
      },
      ACTIVATE: {
        durationFraction: 0.35,
        binaural: 10, carrier: 396, breathVol: 0.2,
        isoTarget: { arousal: 0.55, valence: 0.65, stability: 0.65, coherence: 0.6 },
      },
      ENERGIZE: {
        durationFraction: 0.30,
        binaural: 12, carrier: 432, breathVol: 0.3,
        isoTarget: { arousal: 0.7, valence: 0.75, stability: 0.7, coherence: 0.7 },
      },
      PRIME: {
        durationFraction: 0.15,
        binaural: 12, carrier: 432, breathVol: 0.3,
        isoTarget: { arousal: 0.75, valence: 0.8, stability: 0.75, coherence: 0.75 },
      },
    },
  },
};

export function getPhaseOrder(sessionId) {
  return Object.keys(SESSIONS[sessionId]?.phases ?? {});
}

export function getPhaseTarget(sessionId, phaseName) {
  return SESSIONS[sessionId]?.phases[phaseName]?.isoTarget ?? null;
}

export function getDurations(sessionId) {
  return SESSIONS[sessionId]?.durations ?? [];
}

export function getSessionList() {
  return Object.values(SESSIONS);
}
