// Today's slice of my own meal plan, for the Home card (fork feature, docs/NUTRITION.md). Read
// only: Home must never create or change a plan (see views/Meals.jsx on why a write on view is
// dangerous), so anything missing — no plan, not started, ended, nothing planned — is null and
// the card stays away.
import { dayFor } from './nutrition-calendar.js'
import { foodIndex, dayTotals } from './nutrition.js'

export function mealsToday(n, iso, ws) {
  const plan = n?.mine ? n.plans?.find(p => p.id === n.mine) : null
  if (!plan) return null
  const { dayType } = dayFor(plan, iso, ws)
  const meals = (dayType?.meals || []).filter(m => m.items.length)
  if (!meals.length) return null
  return {
    dayType,
    totals: dayTotals(dayType, foodIndex(n.foods)),
    target: dayType.target || null,
    meals: meals.map(m => m.name),
  }
}
