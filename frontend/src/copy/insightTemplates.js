// Template selection keyed on dominant_ans + ans_trajectory.
// trajectory: 'improved' | 'declined' | 'stable'

export const INSIGHT_TEMPLATES = {
  ventral_vagal: {
    improved:  'You moved into ventral vagal — safety and connection mode. Your nervous system found its anchor.',
    stable:    'You held ventral vagal throughout. This is the state your body wants to remember.',
    declined:  'You started in ventral vagal but drifted. That’s information — your body needs the input it had at the start.',
  },
  healthy_sympathetic: {
    improved:  'Your activation softened into healthy engagement — alert without strain.',
    stable:    'Steady healthy activation. Your sympathetic system is working with you, not against you.',
    declined:  'Activation climbed during the session. Note what triggered it; that’s where the work is.',
  },
  anxious_sympathetic: {
    improved:  'Anxious activation eased as you breathed. That softening is the skill.',
    stable:    'Anxious activation held throughout. Try a shorter session next, or pair this with movement.',
    declined:  'Activation grew during the session. Not failure — signal. Tomorrow, start gentler.',
  },
  dorsal_vagal: {
    improved:  'You lifted out of dorsal shutdown. Gentle re-engagement — well-paced.',
    stable:    'You stayed in dorsal vagal. Sometimes rest is the work. Try light movement before the next session.',
    declined:  'You dropped deeper into dorsal during the session. Your body needs recovery before this practice.',
  },
  burnout_rigidity: {
    improved:  'Some flexibility returned. Rigidity loosens slowly — this is real progress.',
    stable:    'Rigidity held. Rest is priority. Skip tomorrow if you can.',
    declined:  'Rigidity deepened. This is a stop signal, not a try-harder signal.',
  },
};

export function pickInsightCopy(dominant_ans, ans_trajectory = 'stable') {
  const states = INSIGHT_TEMPLATES[dominant_ans];
  if (!states) return null;
  return states[ans_trajectory] ?? states.stable;
}
