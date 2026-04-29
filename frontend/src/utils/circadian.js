// frontend/src/utils/circadian.js
const PHASES = [
    { name: 'MORNING_RISE', start: 6, end: 9 },
    { name: 'PEAK', start: 9, end: 12 },
    { name: 'POST_LUNCH_DIP', start: 13, end: 15 },
    { name: 'AFTERNOON_PEAK', start: 15, end: 18 },
    { name: 'EVENING_WIND', start: 18, end: 21 },
    { name: 'NIGHT', start: 21, end: 6 },
];

export function getCurrentCircadianPhase() {
    const now = new Date();
    const hour = now.getHours() + now.getMinutes() / 60;
    return PHASES.find(p =>
        p.start < p.end
            ? (hour >= p.start && hour < p.end)
            : (hour >= p.start || hour < p.end)
    )?.name ?? 'NIGHT';
}
