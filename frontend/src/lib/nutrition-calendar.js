// frontend/src/lib/nutrition-calendar.js
// Which phase and day type of a meal plan applies on a date (fork feature, docs/NUTRITION.md).
// Weeks count from the first day of the week the plan starts in, in the user's week start, so a
// plan started on a Thursday still has Monday as day 1 of its first week. Arithmetic is in UTC
// days: a local Date across a daylight-saving change is 23 or 25 hours and would slip a day.

const DAY = 86400000
const toUTC = iso => { const [y, m, d] = iso.split('-').map(Number); return Date.UTC(y, m - 1, d) }
const fromUTC = ms => new Date(ms).toISOString().slice(0, 10)

export const addDays = (iso, n) => fromUTC(toUTC(iso) + n * DAY)
export const weekdayOf = iso => new Date(toUTC(iso)).getUTCDay()
export const weekStartDate = (iso, ws) => addDays(iso, -((weekdayOf(iso) - ws + 7) % 7))
const daysBetween = (a, b) => Math.round((toUTC(b) - toUTC(a)) / DAY)

export function phaseFor(plan, iso, ws) {
  const phases = plan?.phases || []
  if (!phases.length) return { empty: true }
  const start = weekStartDate(plan.start, ws)
  const w = Math.floor(daysBetween(start, weekStartDate(iso, ws)) / 7)
  if (w < 0) return { notStarted: true, startsOn: start }
  const open = phases[phases.length - 1].weeks == null
  const cycle = phases.reduce((a, p) => a + (p.weeks || 0), 0)
  let wk = w
  if (!open && w >= cycle) {
    if (plan.afterLast === 'end') return { ended: true, endedOn: addDays(start, cycle * 7 - 1) }
    if (plan.afterLast === 'restart') wk = w % cycle
    else {
      const index = phases.length - 1, phase = phases[index]
      return { phase, index, weekOfPhase: phase.weeks, weeksInPhase: phase.weeks, beyond: true }
    }
  }
  let acc = 0
  for (let index = 0; index < phases.length; index++) {
    const phase = phases[index]
    if (phase.weeks == null || wk < acc + phase.weeks) {
      return { phase, index, weekOfPhase: wk - acc + 1, weeksInPhase: phase.weeks ?? null }
    }
    acc += phase.weeks
  }
  return { empty: true }
}

export function dayFor(plan, iso, ws) {
  const r = phaseFor(plan, iso, ws)
  if (!r.phase) return r
  const weekday = weekdayOf(iso)
  const types = r.phase.dayTypes || []
  const dayType = types.find(d => d.id === r.phase.week?.[String(weekday)]) || types[0] || null
  return { ...r, weekday, dayType }
}

export function phaseDates(plan, ws) {
  const start = weekStartDate(plan.start, ws)
  let acc = 0
  return (plan.phases || []).map(p => {
    const from = addDays(start, acc * 7)
    const to = p.weeks == null ? null : addDays(start, (acc + p.weeks) * 7 - 1)
    acc += p.weeks || 0
    return { id: p.id, from, to }
  })
}

export function startOptions(today, ws) {
  const thisWeek = weekStartDate(today, ws)
  return { thisWeek, nextWeek: addDays(thisWeek, 7) }
}
