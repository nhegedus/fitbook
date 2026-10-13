// Every edit of S.nutrition (fork feature, docs/NUTRITION.md). Like lib/routines.js, each
// function changes the draft the store's update() hands it. Invariants kept here, never in the
// UI: `mine` names an existing plan, a plan has at least one phase and a phase at least one day
// type, every weekday of a phase points at one of its day types, and only the last phase may
// repeat without an end (weeks: null).
import { uid } from './format.js'
import { weekStartDate } from './nutrition-calendar.js'

export const DEFAULT_MEALS = ['Breakfast', 'Lunch', 'Snack', 'Dinner']
export const LIMITS = { grams: [1,5000], kcal: [0,900], macro: [0,100], weeks: [1,104], phases: 12, dayTypes: 14, meals: 12, items: 40, name: 60, foodName: 80 }
const WEEKDAYS = ['0', '1', '2', '3', '4', '5', '6']
const AFTER = new Set(['stay', 'restart', 'end'])
const NEW_PHASE_WEEKS = 4

const clone = o => JSON.parse(JSON.stringify(o))
const isArr = Array.isArray
const clampNum = (v, [lo, hi]) => {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v
  return typeof n === 'number' && Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : null
}
export const cleanName = (s, max = LIMITS.name) => String(s ?? '').trim().slice(0, max)
export function clampGrams(g) {
  const n = clampNum(g, LIMITS.grams)
  return n == null ? 100 : Math.round(n)
}

export function cleanFood(raw) {
  const name = cleanName(raw?.name, LIMITS.foodName)
  if (!name) return null
  const out = {
    id: raw.id || uid(), name,
    kcal: clampNum(raw.kcal, LIMITS.kcal),
    protein: clampNum(raw.protein, LIMITS.macro),
    carbs: clampNum(raw.carbs, LIMITS.macro),
    fat: clampNum(raw.fat, LIMITS.macro),
    source: ['off', 'manual', 'import'].includes(raw.source) ? raw.source : 'manual',
  }
  if (raw.barcode) out.barcode = String(raw.barcode).slice(0, 32)
  return out
}

export const nutritionDefault = () => ({ foods: [], defaultMeals: [...DEFAULT_MEALS], plans: [], mine: null })

export function ensureNutrition(s) {
  const n = s.nutrition
  if (!n || typeof n !== 'object' || !isArr(n.foods) || !isArr(n.plans)) { s.nutrition = nutritionDefault(); return s.nutrition }
  if (!isArr(n.defaultMeals)) n.defaultMeals = [...DEFAULT_MEALS]
  return n
}

const newMeal = name => ({ id: uid(), name: cleanName(name) || 'Meal', items: [] })
const newDayType = (n, name) => ({ id: uid(), name: cleanName(name) || 'Day 1', meals: (n.defaultMeals || DEFAULT_MEALS).slice(0, LIMITS.meals).map(newMeal) })
function newPhase(n, name) {
  const dt = newDayType(n, 'Day 1')
  return { id: uid(), name: cleanName(name) || 'Phase 1', weeks: null, dayTypes: [dt], week: Object.fromEntries(WEEKDAYS.map(d => [d, dt.id])) }
}

// Fresh ids for everything inside a phase, weekday references remapped. Food ids stay: foods are
// shared by every plan.
function rekeyPhase(p) {
  const out = clone(p)
  out.id = uid()
  const map = {}
  for (const dt of out.dayTypes) { const old = dt.id; dt.id = uid(); map[old] = dt.id; rekeyMeals(dt) }
  for (const d of WEEKDAYS) out.week[d] = map[out.week[d]] || out.dayTypes[0].id
  return out
}
function rekeyMeals(dt) { for (const m of dt.meals) { m.id = uid(); for (const it of m.items) it.id = uid() } }

export function at(n, ref = {}) {
  const plan = n.plans.find(p => p.id === ref.planId)
  const phase = plan?.phases.find(p => p.id === ref.phaseId)
  const dayType = phase?.dayTypes.find(d => d.id === ref.dayTypeId)
  const meal = dayType?.meals.find(m => m.id === ref.mealId)
  return { plan, phase, dayType, meal }
}

/* ------------------------------ plans ------------------------------ */

export function addPlan(n, { name, copyFrom, today, ws }) {
  const src = n.plans.find(p => p.id === copyFrom)
  const plan = src
    ? { ...clone(src), id: uid(), phases: src.phases.map(rekeyPhase) }
    : { id: uid(), start: weekStartDate(today, ws), afterLast: 'stay', phases: [newPhase(n, 'Phase 1')] }
  plan.name = cleanName(name) || (src ? src.name : 'New plan')
  n.plans.push(plan)
  return plan.id
}

export function ensureMine(n, today, ws) {
  if (n.mine && n.plans.some(p => p.id === n.mine)) return n.mine
  n.mine = addPlan(n, { name: 'My plan', today, ws })
  return n.mine
}

export function renamePlan(n, planId, name) { const p = at(n, { planId }).plan; const v = cleanName(name); if (p && v) p.name = v }
export function deletePlan(n, planId) {
  if (planId === n.mine) return false
  const i = n.plans.findIndex(p => p.id === planId)
  if (i < 0) return false
  n.plans.splice(i, 1)
  return true
}
export function setPlanStart(n, planId, iso, ws) { const p = at(n, { planId }).plan; if (p && /^\d{4}-\d{2}-\d{2}$/.test(iso)) p.start = weekStartDate(iso, ws) }
export function setAfterLast(n, planId, v) { const p = at(n, { planId }).plan; if (p && AFTER.has(v)) p.afterLast = v }

/* ------------------------------ phases ------------------------------ */

// Only the last phase may run without an end; anything else that has none gets the default length.
function fixRepeat(plan) { plan.phases.forEach((p, i) => { if (p.weeks == null && i < plan.phases.length - 1) p.weeks = NEW_PHASE_WEEKS }) }

export function addPhase(n, planId, { copyFrom } = {}) {
  const plan = at(n, { planId }).plan
  if (!plan || plan.phases.length >= LIMITS.phases) return null
  const src = plan.phases.find(p => p.id === copyFrom)
  const lastRepeats = plan.phases[plan.phases.length - 1]?.weeks == null
  const phase = src ? rekeyPhase(src) : newPhase(n, 'Phase ' + (plan.phases.length + 1))
  if (src) phase.name = cleanName(src.name + ' (copy)')
  phase.weeks = lastRepeats ? null : NEW_PHASE_WEEKS
  plan.phases.push(phase)
  fixRepeat(plan)
  return phase.id
}
export function renamePhase(n, ref, name) { const p = at(n, ref).phase; const v = cleanName(name); if (p && v) p.name = v }
export function setPhaseWeeks(n, ref, weeks) {
  const { plan, phase } = at(n, ref)
  if (!phase) return false
  if (weeks == null) {
    if (plan.phases[plan.phases.length - 1] !== phase) return false
    phase.weeks = null
    return true
  }
  const w = clampNum(weeks, LIMITS.weeks)
  if (w == null) return false
  phase.weeks = Math.round(w)
  return true
}
export function movePhase(n, ref, dir) {
  const { plan, phase } = at(n, ref)
  if (!phase) return
  const i = plan.phases.indexOf(phase), j = i + dir
  if (j < 0 || j >= plan.phases.length) return
  plan.phases.splice(i, 1)
  plan.phases.splice(j, 0, phase)
  fixRepeat(plan)
}
export function deletePhase(n, ref) {
  const { plan, phase } = at(n, ref)
  if (!phase || plan.phases.length <= 1) return false
  plan.phases.splice(plan.phases.indexOf(phase), 1)
  fixRepeat(plan)
  return true
}

/* ----------------------------- day types ----------------------------- */

export const dayTypeUsage = (phase, dayTypeId) =>
  WEEKDAYS.filter(d => phase.week[d] === dayTypeId).map(Number).sort((a, b) => a - b)

export function addDayType(n, ref, { copyFrom, name } = {}) {
  const { phase } = at(n, ref)
  if (!phase || phase.dayTypes.length >= LIMITS.dayTypes) return null
  const src = phase.dayTypes.find(d => d.id === copyFrom)
  const dt = src ? { ...clone(src), id: uid() } : newDayType(n, name)
  if (src) { rekeyMeals(dt); dt.name = cleanName(name) || cleanName(src.name + ' (copy)') }
  phase.dayTypes.push(dt)
  return dt.id
}
export function renameDayType(n, ref, name) { const d = at(n, ref).dayType; const v = cleanName(name); if (d && v) d.name = v }
export function deleteDayType(n, ref, replacementId) {
  const { phase, dayType } = at(n, ref)
  if (!dayType || phase.dayTypes.length <= 1) return false
  phase.dayTypes.splice(phase.dayTypes.indexOf(dayType), 1)
  const to = phase.dayTypes.find(d => d.id === replacementId) || phase.dayTypes[0]
  for (const d of WEEKDAYS) if (phase.week[d] === dayType.id) phase.week[d] = to.id
  return true
}
export function assignDay(n, ref, weekday, dayTypeId) {
  const { phase } = at(n, ref)
  if (phase && phase.dayTypes.some(d => d.id === dayTypeId)) phase.week[String(weekday)] = dayTypeId
}
export function makeDaySeparate(n, ref, weekday, name) {
  const { phase } = at(n, ref)
  if (!phase) return null
  const id = addDayType(n, ref, { copyFrom: phase.week[String(weekday)], name })
  if (id) phase.week[String(weekday)] = id
  return id
}
export function setTarget(n, ref, target) {
  const { dayType } = at(n, ref)
  if (!dayType) return
  const out = {}
  for (const k of ['kcal', 'protein', 'carbs', 'fat']) {
    const v = clampNum(target?.[k], k === 'kcal' ? [0, 20000] : [0, 2000])
    if (v) out[k] = Math.round(v)
  }
  if (Object.keys(out).length) dayType.target = out
  else delete dayType.target
}
export function applyTargetToAll(n, ref) {
  const { phase, dayType } = at(n, ref)
  if (!dayType) return
  for (const d of phase.dayTypes) {
    if (d === dayType) continue
    if (dayType.target) d.target = clone(dayType.target)
    else delete d.target
  }
}

/* ------------------------------- meals ------------------------------- */

export function insertMeal(n, ref, index, name) {
  const { dayType } = at(n, ref)
  if (!dayType || dayType.meals.length >= LIMITS.meals) return null
  const meal = newMeal(name)
  dayType.meals.splice(Math.max(0, Math.min(index, dayType.meals.length)), 0, meal)
  return meal.id
}
export function renameMeal(n, ref, name) { const m = at(n, ref).meal; const v = cleanName(name); if (m && v) m.name = v }
export function moveMeal(n, ref, dir) {
  const { dayType, meal } = at(n, ref)
  if (!meal) return
  const i = dayType.meals.indexOf(meal), j = i + dir
  if (j < 0 || j >= dayType.meals.length) return
  dayType.meals.splice(i, 1)
  dayType.meals.splice(j, 0, meal)
}
export function deleteMeal(n, ref) { const { dayType, meal } = at(n, ref); if (meal) dayType.meals.splice(dayType.meals.indexOf(meal), 1) }
export function useAsDefaultMeals(n, ref) { const { dayType } = at(n, ref); if (dayType) n.defaultMeals = dayType.meals.map(m => m.name) }

/* ------------------------------- items ------------------------------- */

export function addItem(n, ref, foodId, grams) {
  const { meal } = at(n, ref)
  if (!meal || meal.items.length >= LIMITS.items || !n.foods.some(f => f.id === foodId)) return null
  const item = { id: uid(), foodId, grams: clampGrams(grams) }
  meal.items.push(item)
  return item.id
}
export function setItemGrams(n, ref, itemId, grams) { const it = at(n, ref).meal?.items.find(i => i.id === itemId); if (it) it.grams = clampGrams(grams) }
export function removeItem(n, ref, itemId) { const m = at(n, ref).meal; if (m) m.items = m.items.filter(i => i.id !== itemId) }

/* ------------------------------- foods ------------------------------- */

export function addFood(n, raw) {
  const f = cleanFood({ ...raw, id: undefined })
  if (!f) return null
  n.foods.push(f)
  return f.id
}
export function updateFood(n, foodId, patch) {
  const i = n.foods.findIndex(f => f.id === foodId)
  if (i < 0) return
  const f = cleanFood({ ...n.foods[i], ...patch, id: foodId })
  if (f) n.foods[i] = f
}
function eachItemList(n, fn) {
  for (const p of n.plans) for (const ph of p.phases) for (const dt of ph.dayTypes) for (const m of dt.meals) fn(m)
}
export function foodUsage(n, foodId) { let c = 0; eachItemList(n, m => { c += m.items.filter(i => i.foodId === foodId).length }); return c }
export function deleteFood(n, foodId) {
  n.foods = n.foods.filter(f => f.id !== foodId)
  eachItemList(n, m => { m.items = m.items.filter(i => i.foodId !== foodId) })
}
