// WHOOP API daily fetch — goes through the backend (/whoop/daily).
// The backend holds the client secret; frontend only handles the access_token.

export async function fetchDaily(accessToken) {
  try {
    const r = await fetch(`/api/whoop/daily?access_token=${encodeURIComponent(accessToken)}`)
    if (!r.ok) return null
    return await r.json()
  } catch {
    return null
  }
}

export async function getAuthUrl() {
  try {
    const r = await fetch('/api/whoop/auth_url')
    if (!r.ok) return null
    return await r.json()
  } catch {
    return null
  }
}

// Shape a WHOOP response into the 5 pills the landing screen shows.
export function toPills(daily) {
  if (!daily) return null
  const rec = daily.recovery?.records?.[0]?.score || {}
  const cycle = daily.cycle?.records?.[0]?.score || {}
  const sleep = daily.sleep?.records?.[0]?.score || {}
  return {
    hrv: rec.hrv_rmssd_milli ? `${Math.round(rec.hrv_rmssd_milli)}ms` : '--',
    recovery: rec.recovery_score != null ? `${Math.round(rec.recovery_score)}%` : '--',
    rhr: rec.resting_heart_rate != null ? `${Math.round(rec.resting_heart_rate)}` : '--',
    sleep: sleep.sleep_performance_percentage != null ? `${Math.round(sleep.sleep_performance_percentage)}%` : '--',
    resp: rec.respiratory_rate != null ? rec.respiratory_rate.toFixed(1) : '--',
  }
}
