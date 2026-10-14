// The meal-plan file a coach sends a client (fork feature, docs/NUTRITION.md). One plan per file
// with all its phases and only the foods it uses; never a start date (the client picks one),
// workouts, weigh-ins or settings. Import trusts nothing in the file: every number is clamped,
// every weekday that points nowhere is repaired, and every id is replaced.
import { uid } from './format.js'
import { t } from './i18n-core.js'
import { cleanFood, cleanName, clampGrams, LIMITS, ensureMine } from './nutrition-plans.js'
import { weekStartDate } from './nutrition-calendar.js'

export const MEAL_FMT = 2
const WEEKDAYS = ['0', '1', '2', '3', '4', '5', '6']
const AFTER = new Set(['stay', 'restart', 'end'])
const fail = (code, message) => Object.assign(new Error(message), { code })
const clone = o => JSON.parse(JSON.stringify(o))
// The parsed plan and its foods must stay far below the server's 5 MB state limit, or every later
// push is refused and workouts stop syncing too.
const MAX_IMPORT_CHARS = 500000

export function buildMealBundle(n, planId, today) {
  const plan = n.plans.find(p => p.id === planId)
  const used = new Set()
  for (const ph of plan.phases) for (const dt of ph.dayTypes) for (const m of dt.meals) for (const i of m.items) used.add(i.foodId)
  return {
    opengym_meals: MEAL_FMT, exported: today, name: plan.name, afterLast: plan.afterLast,
    phases: clone(plan.phases),
    foods: n.foods.filter(f => used.has(f.id)).map(({ id, name, kcal, protein, carbs, fat, barcode }) =>
      ({ id, name, kcal, protein, carbs, fat, ...(barcode ? { barcode } : {}) })),
  }
}

export function mealFileName(name) {
  const slug = String(name || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return slug ? `meal-plan-${slug}.json` : 'meal-plan.json'
}

export function looksLikeMealFile(text) {
  try { const d = JSON.parse(text); return !!d && typeof d === 'object' && d.opengym_meals != null } catch { return false }
}

// `ctx` carries what the whole plan has used so far: the item count against LIMITS.planItems and
// the foods kept (in order of first use, at most LIMITS.foods). Items are taken in file order —
// phases, day types, meals, items — so the same file always keeps the same items.
function takeItems(list, ctx) {
  const out = []
  for (const i of Array.isArray(list) ? list : []) {
    if (out.length >= LIMITS.items || ctx.items >= LIMITS.planItems) break
    const food = ctx.fileFoods.get(i?.foodId)
    if (!food) continue
    if (!ctx.kept.has(i.foodId)) {
      if (ctx.kept.size >= LIMITS.foods) continue
      ctx.kept.set(i.foodId, food)
    }
    out.push({ id: uid(), foodId: i.foodId, grams: clampGrams(i.grams) })
    ctx.items++
  }
  return out
}

function parseDayType(raw, ctx) {
  const meals = (Array.isArray(raw?.meals) ? raw.meals : []).slice(0, LIMITS.meals).map(m => ({
    id: uid(), name: cleanName(m?.name) || 'Meal', items: takeItems(m?.items, ctx),
  }))
  const out = { id: raw?.id != null ? String(raw.id) : uid(), name: cleanName(raw?.name) || 'Day', meals }
  const target = {}
  for (const k of ['kcal', 'protein', 'carbs', 'fat']) {
    const v = Number(raw?.target?.[k])
    if (Number.isFinite(v) && v > 0) target[k] = Math.round(Math.min(v, k === 'kcal' ? 20000 : 2000))
  }
  if (Object.keys(target).length) out.target = target
  return out
}

export function parseMealPlan(raw) {
  let d
  try { d = typeof raw === 'string' ? JSON.parse(raw) : raw } catch { throw fail('not-meals', t('This isn’t an openGym meal-plan file.')) }
  if (d?.opengym_plan != null && d?.opengym_meals == null) throw fail('training-plan', t('This is a training plan. Import it from the Plan menu instead.'))
  if (!d || typeof d !== 'object' || d.opengym_meals == null || !Array.isArray(d.phases) || !d.phases.length) {
    throw fail('not-meals', t('This isn’t an openGym meal-plan file.'))
  }
  if (Number(d.opengym_meals) > MEAL_FMT) throw fail('not-meals', t('This meal plan was made by a newer version of openGym.'))
  // Only foods some kept item uses come along: a file can carry any number of unused ones.
  const fileFoods = new Map()
  for (const f of Array.isArray(d.foods) ? d.foods : []) {
    const c = cleanFood({ ...f, source: 'import' })
    if (c && !fileFoods.has(c.id)) fileFoods.set(c.id, c)
  }
  const ctx = { fileFoods, kept: new Map(), items: 0 }
  const phases = d.phases.slice(0, LIMITS.phases).map((p, idx) => {
    let dayTypes = (Array.isArray(p?.dayTypes) ? p.dayTypes : []).slice(0, LIMITS.dayTypes).map(dt => parseDayType(dt, ctx))
    if (!dayTypes.length) dayTypes = [parseDayType({ name: 'Day 1' }, ctx)]
    const ids = new Set(dayTypes.map(x => x.id))
    const week = Object.fromEntries(WEEKDAYS.map(k => [k, ids.has(String(p?.week?.[k])) ? String(p.week[k]) : dayTypes[0].id]))
    const w = Number(p?.weeks)
    const weeks = p?.weeks == null ? null : Number.isFinite(w) ? Math.round(Math.min(LIMITS.weeks[1], Math.max(LIMITS.weeks[0], w))) : 4
    return { id: uid(), name: cleanName(p?.name) || `Phase ${idx + 1}`, weeks, dayTypes, week }
  })
  phases.forEach((p, i) => { if (p.weeks == null && i < phases.length - 1) p.weeks = 4 })
  const foods = [...ctx.kept.values()]
  if (JSON.stringify({ phases, foods }).length > MAX_IMPORT_CHARS) throw fail('not-meals', t('This meal plan is too large to import.'))
  const counts = {
    phases: phases.length,
    dayTypes: phases.reduce((a, p) => a + p.dayTypes.length, 0),
    meals: phases.reduce((a, p) => a + p.dayTypes.reduce((b, dt) => b + dt.meals.length, 0), 0),
    foods: foods.length,
  }
  return {
    name: cleanName(d.name) || t('Imported meal plan'),
    afterLast: AFTER.has(d.afterLast) ? d.afterLast : 'stay',
    phases, foods, counts,
  }
}

const sameValues = (a, b) => ['kcal', 'protein', 'carbs', 'fat'].every(k => (a[k] ?? null) === (b[k] ?? null))
const key = s => String(s).trim().toLowerCase()

// Same name and same values → the existing food; same name, other values → "<name> (imported)";
// otherwise added. Foods are looked up by name through an index so a big file stays linear.
function mergeFoods(n, foods) {
  const map = new Map()
  const byName = new Map()
  const index = f => { const k = key(f.name); if (!byName.has(k)) byName.set(k, []); byName.get(k).push(f) }
  n.foods.forEach(index)
  for (const f of foods) {
    const same = byName.get(key(f.name)) || []
    const twin = same.find(x => sameValues(x, f))
    if (twin) { map.set(f.id, twin.id); continue }
    const added = cleanFood({ ...f, id: undefined, name: same.length ? `${f.name} (imported)` : f.name, source: 'import' })
    added.id = uid()
    n.foods.push(added)
    index(added)
    map.set(f.id, added.id)
  }
  return map
}

export function importMealPlan(n, parsed, { mode, start, ws, today }) {
  const foodMap = mergeFoods(n, parsed.foods)
  const phases = parsed.phases.map(p => {
    const dtMap = new Map()
    const dayTypes = p.dayTypes.map(dt => {
      const id = uid(); dtMap.set(dt.id, id)
      return { ...clone(dt), id, meals: dt.meals.map(m => ({ id: uid(), name: m.name, items: m.items.map(i => ({ id: uid(), foodId: foodMap.get(i.foodId), grams: i.grams })) })) }
    })
    return { id: uid(), name: p.name, weeks: p.weeks, dayTypes, week: Object.fromEntries(WEEKDAYS.map(k => [k, dtMap.get(p.week[k])])) }
  })
  const plan = { name: parsed.name, start: weekStartDate(start || today, ws), afterLast: parsed.afterLast, phases }
  if (mode === 'replace') {
    const mine = ensureMine(n, today, ws)
    const i = n.plans.findIndex(p => p.id === mine)
    n.plans[i] = { id: mine, ...plan }
    return mine
  }
  const id = uid()
  n.plans.push({ id, ...plan })
  return id
}
