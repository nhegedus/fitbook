// frontend/src/lib/meal-share.test.js
import { describe, it, expect } from 'vitest'
import { MEAL_FMT, buildMealBundle, mealFileName, looksLikeMealFile, parseMealPlan, importMealPlan } from './meal-share.js'
import { ensureNutrition, ensureMine, addFood, addItem, addPhase, at, setTarget } from './nutrition-plans.js'

const TODAY = '2026-10-15', MON = 1

function coach() {
  const s = {}; const n = ensureNutrition(s); const planId = ensureMine(n, TODAY, MON)
  const plan = n.plans[0], phase = plan.phases[0], dt = phase.dayTypes[0]
  const ref = { planId, phaseId: phase.id, dayTypeId: dt.id }
  const rice = addFood(n, { name: 'Rice', kcal: 130, protein: 2.7, carbs: 28, fat: 0.3 })
  addFood(n, { name: 'Unused', kcal: 1, protein: 0, carbs: 0, fat: 0 })
  addItem(n, { ...ref, mealId: dt.meals[1].id }, rice, 250)
  setTarget(n, ref, { kcal: 2200, protein: 160 })
  addPhase(n, planId, { copyFrom: phase.id })
  plan.name = 'Anna – cut'
  return { n, planId, rice }
}

describe('export', () => {
  it('carries the plan and only the foods it uses, never the start', () => {
    const { n, planId } = coach()
    const b = buildMealBundle(n, planId, TODAY)
    expect(b.opengym_meals).toBe(MEAL_FMT)
    expect(b.exported).toBe(TODAY)
    expect(b.name).toBe('Anna – cut')
    expect(b.start).toBeUndefined()
    expect(b.phases).toHaveLength(2)
    expect(b.foods.map(f => f.name)).toEqual(['Rice'])
    expect(JSON.stringify(b)).not.toMatch(/workouts|bodyweight/)
  })
  it('names the file after the plan', () => {
    expect(mealFileName('Anna – cut / week 1')).toBe('meal-plan-anna-cut-week-1.json')
    expect(mealFileName('')).toBe('meal-plan.json')
  })
})

describe('detect and parse', () => {
  it('recognises a meal-plan file and nothing else', () => {
    expect(looksLikeMealFile(JSON.stringify({ opengym_meals: 2, phases: [] }))).toBe(true)
    expect(looksLikeMealFile(JSON.stringify({ opengym_plan: 1, routines: [] }))).toBe(false)
    expect(looksLikeMealFile('not json')).toBe(false)
  })
  it('round-trips an export', () => {
    const { n, planId } = coach()
    const p = parseMealPlan(JSON.stringify(buildMealBundle(n, planId, TODAY)))
    expect(p.name).toBe('Anna – cut')
    expect(p.counts).toEqual({ phases: 2, dayTypes: 2, meals: 8, foods: 1 })
    expect(p.phases[0].dayTypes[0].target).toEqual({ kcal: 2200, protein: 160 })
  })
  it('refuses broken JSON and foreign files readably', () => {
    expect(() => parseMealPlan('{oops')).toThrow(expect.objectContaining({ code: 'not-meals' }))
    expect(() => parseMealPlan(JSON.stringify({ hello: 1 }))).toThrow(expect.objectContaining({ code: 'not-meals' }))
    expect(() => parseMealPlan(JSON.stringify({ opengym_plan: 1, routines: [] }))).toThrow(expect.objectContaining({ code: 'training-plan' }))
    expect(() => parseMealPlan(JSON.stringify({ opengym_meals: 2, phases: [] }))).toThrow(expect.objectContaining({ code: 'not-meals' }))
  })
  it('repairs and clamps a hand-edited file', () => {
    const raw = {
      opengym_meals: 2, name: 'x'.repeat(200), afterLast: 'whatever',
      phases: [
        { name: 'A', weeks: null, dayTypes: [{ id: 'd1', name: 'Day', meals: [{ name: 'M', items: [{ foodId: 'f1', grams: 99999 }, { foodId: 'missing', grams: 10 }] }] }], week: { '1': 'nope' } },
        { name: 'B', weeks: 999, dayTypes: [], week: {} },
      ],
      foods: [{ id: 'f1', name: 'Rice', kcal: 5000, protein: 2, carbs: 28, fat: 0 }],
    }
    const p = parseMealPlan(JSON.stringify(raw))
    expect(p.name).toHaveLength(60)
    expect(p.afterLast).toBe('stay')
    expect(p.phases[0].weeks).toBe(4)                         // repeat only on the last
    expect(p.phases[1].weeks).toBe(104)
    expect(p.phases[1].dayTypes).toHaveLength(1)               // an empty phase gets a day type
    expect(Object.values(p.phases[0].week)).toEqual(Array(7).fill('d1'))
    expect(p.phases[0].dayTypes[0].meals[0].items).toEqual([{ id: expect.any(String), foodId: 'f1', grams: 5000 }])
    expect(p.foods[0].kcal).toBe(900)
  })
})

describe('import', () => {
  function client() { const s = {}; const n = ensureNutrition(s); ensureMine(n, TODAY, MON); return n }

  it('replaces my plan, keeps my plan id, starts on the chosen week', () => {
    const { n: c, planId } = coach()
    const parsed = parseMealPlan(JSON.stringify(buildMealBundle(c, planId, TODAY)))
    const n = client()
    const mine = n.mine
    const id = importMealPlan(n, parsed, { mode: 'replace', start: '2026-10-22', ws: MON, today: TODAY })
    expect(id).toBe(mine)
    expect(n.plans).toHaveLength(1)
    expect(n.plans[0]).toMatchObject({ id: mine, name: 'Anna – cut', start: '2026-10-19' })
    expect(n.plans[0].phases).toHaveLength(2)
  })
  it('saves as a new plan without touching mine', () => {
    const { n: c, planId } = coach()
    const parsed = parseMealPlan(JSON.stringify(buildMealBundle(c, planId, TODAY)))
    const n = client()
    const before = JSON.stringify(n.plans[0])
    const id = importMealPlan(n, parsed, { mode: 'new', start: TODAY, ws: MON, today: TODAY })
    expect(n.plans).toHaveLength(2)
    expect(id).not.toBe(n.mine)
    expect(JSON.stringify(n.plans[0])).toBe(before)
  })
  it('gives every imported thing a fresh id and remaps references', () => {
    const { n: c, planId } = coach()
    const parsed = parseMealPlan(JSON.stringify(buildMealBundle(c, planId, TODAY)))
    const n = client()
    const id = importMealPlan(n, parsed, { mode: 'new', start: TODAY, ws: MON, today: TODAY })
    const plan = n.plans.find(p => p.id === id), phase = plan.phases[0]
    expect(phase.id).not.toBe(c.plans[0].phases[0].id)
    expect(phase.dayTypes.map(d => d.id)).toContain(phase.week['1'])
    const item = phase.dayTypes[0].meals[1].items[0]
    expect(n.foods.find(f => f.id === item.foodId).name).toBe('Rice')
  })
  it('merges foods: same name and values reused, same name different values marked', () => {
    const { n: c, planId } = coach()
    const parsed = parseMealPlan(JSON.stringify(buildMealBundle(c, planId, TODAY)))
    const n = client()
    const same = addFood(n, { name: 'rice ', kcal: 130, protein: 2.7, carbs: 28, fat: 0.3 })
    importMealPlan(n, parsed, { mode: 'new', start: TODAY, ws: MON, today: TODAY })
    expect(n.foods).toHaveLength(1)
    expect(n.foods[0].id).toBe(same)

    const n2 = client()
    addFood(n2, { name: 'Rice', kcal: 120, protein: 2, carbs: 27, fat: 0.2 })
    importMealPlan(n2, parsed, { mode: 'new', start: TODAY, ws: MON, today: TODAY })
    expect(n2.foods.map(f => f.name)).toEqual(['Rice', 'Rice (imported)'])
    expect(n2.foods[1].source).toBe('import')
  })
})

describe('ids that collide with object internals', () => {
  it('keeps week and item references pointing at real ids when a file uses "__proto__"', () => {
    const raw = {
      opengym_meals: 2, name: 'Proto',
      phases: [{
        name: 'A', weeks: null,
        dayTypes: [{ id: '__proto__', name: 'Day', meals: [{ name: 'M', items: [{ foodId: '__proto__', grams: 100 }] }] }],
        week: { '0': '__proto__', '1': '__proto__', '2': '__proto__', '3': '__proto__', '4': '__proto__', '5': '__proto__', '6': '__proto__' },
      }],
      foods: [{ id: '__proto__', name: 'Rice', kcal: 130, protein: 2, carbs: 28, fat: 0 }],
    }
    const parsed = parseMealPlan(JSON.stringify(raw))
    const n = ensureNutrition({})
    ensureMine(n, TODAY, MON)
    const id = importMealPlan(n, parsed, { mode: 'new', start: TODAY, ws: MON, today: TODAY })
    const phase = n.plans.find(p => p.id === id).phases[0]
    const dtIds = phase.dayTypes.map(d => d.id)
    for (const v of Object.values(phase.week)) {
      expect(typeof v).toBe('string')
      expect(dtIds).toContain(v)
    }
    const item = phase.dayTypes[0].meals[0].items[0]
    expect(typeof item.foodId).toBe('string')
    expect(n.foods.map(f => f.id)).toContain(item.foodId)
    expect(n.foods.find(f => f.id === item.foodId).name).toBe('Rice')
  })
})
