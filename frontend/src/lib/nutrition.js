// frontend/src/lib/nutrition.js
// Meal-plan numbers (fork feature, docs/NUTRITION.md). Everything here is per-100 g food values
// times grams, summed. A value a food does not state stays null on the item and counts as 0 in a
// sum, with `incomplete` set, so a day never claims a total it cannot know.

export const MACROS = ['kcal', 'protein', 'carbs', 'fat']
const BAND = 0.05            // ±5 % of a target counts as on target
const MISMATCH_PCT = 0.15    // stated kcal vs 4/4/9 from macros…
const MISMATCH_KCAL = 20     // …and at least this far apart in absolute terms

const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const zero = () => ({ kcal: 0, protein: 0, carbs: 0, fat: 0, incomplete: false })

export const foodIndex = foods => new Map((foods || []).map(f => [f.id, f]))

export function itemTotals(food, grams) {
  const g = Math.max(0, num(Number(grams)) ?? 0)
  const out = { incomplete: !food }
  for (const k of MACROS) {
    const v = food ? num(food[k]) : null
    out[k] = v == null ? null : v * g / 100
    if (v == null) out.incomplete = true
  }
  return { kcal: out.kcal, protein: out.protein, carbs: out.carbs, fat: out.fat, incomplete: out.incomplete }
}

export function sumTotals(list) {
  const out = zero()
  for (const t of list || []) {
    for (const k of MACROS) {
      if (t[k] == null) out.incomplete = true
      else out[k] += t[k]
    }
    if (t.incomplete) out.incomplete = true
  }
  return out
}

export const mealTotals = (meal, foodsById) =>
  sumTotals((meal?.items || []).map(it => itemTotals(foodsById.get(it.foodId), it.grams)))

export const dayTotals = (dayType, foodsById) =>
  sumTotals((dayType?.meals || []).map(m => mealTotals(m, foodsById)))

export function dayStatus(totals, target) {
  const out = {}
  for (const k of MACROS) {
    const goal = num(target?.[k])
    const have = num(totals?.[k]) ?? 0
    if (!goal) out[k] = 'none'
    else if (have < goal * (1 - BAND)) out[k] = 'under'
    else if (have > goal * (1 + BAND)) out[k] = 'over'
    else out[k] = 'ok'
  }
  return out
}

export function macroKcal({ protein, carbs, fat } = {}) {
  const p = num(protein), c = num(carbs), f = num(fat)
  return p == null || c == null || f == null ? null : 4 * p + 4 * c + 9 * f
}

export function kcalMismatch(food) {
  const stated = num(food?.kcal), fromMacros = macroKcal(food || {})
  if (stated == null || fromMacros == null) return false
  const diff = Math.abs(stated - fromMacros)
  return diff > MISMATCH_KCAL && diff > MISMATCH_PCT * Math.max(stated, fromMacros)
}

export const roundKcal = n => (num(n) == null ? null : Math.round(n))
export const roundGrams = n => (num(n) == null ? null : n < 10 ? Math.round(n * 10) / 10 : Math.round(n))
