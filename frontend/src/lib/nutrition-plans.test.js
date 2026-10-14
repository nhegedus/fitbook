// frontend/src/lib/nutrition-plans.test.js
import { describe, it, expect } from 'vitest'
import {
  DEFAULT_MEALS, nutritionDefault, ensureNutrition, cleanFood, clampGrams, at,
  ensureMine, addPlan, renamePlan, deletePlan, setPlanStart, setAfterLast,
  addPhase, renamePhase, setPhaseWeeks, movePhase, deletePhase,
  addDayType, deleteDayType, assignDay, makeDaySeparate, setTarget, applyTargetToAll, dayTypeUsage,
  insertMeal, renameMeal, moveMeal, deleteMeal, useAsDefaultMeals,
  addItem, setItemGrams, removeItem, addFood, updateFood, foodUsage, deleteFood, LIMITS,
} from './nutrition-plans.js'

const TODAY = '2026-10-15', MON = 1
const fresh = () => { const s = {}; const n = ensureNutrition(s); const planId = ensureMine(n, TODAY, MON); return { s, n, planId } }
const firstRef = (n, planId) => {
  const plan = n.plans.find(p => p.id === planId), phase = plan.phases[0], dayType = phase.dayTypes[0]
  return { planId, phaseId: phase.id, dayTypeId: dayType.id }
}

describe('defaults', () => {
  it('creates nutrition and my plan on first use', () => {
    const { n, planId } = fresh()
    expect(n.mine).toBe(planId)
    const plan = n.plans[0]
    expect(plan.name).toBe('My plan')
    expect(plan.start).toBe('2026-10-12')
    expect(plan.afterLast).toBe('stay')
    expect(plan.phases).toHaveLength(1)
    expect(plan.phases[0].weeks).toBeNull()
    const dt = plan.phases[0].dayTypes[0]
    expect(dt.meals.map(m => m.name)).toEqual(DEFAULT_MEALS)
    expect(Object.values(plan.phases[0].week)).toEqual(Array(7).fill(dt.id))
  })
  it('ensureMine is idempotent', () => {
    const { n, planId } = fresh()
    expect(ensureMine(n, TODAY, MON)).toBe(planId)
    expect(n.plans).toHaveLength(1)
  })
  it('repairs a broken nutrition key', () => {
    const s = { nutrition: { foods: 'x', plans: null } }
    const n = ensureNutrition(s)
    expect(n).toEqual(nutritionDefault())
    expect(s.nutrition).toBe(n)
  })
})

describe('foods', () => {
  it('cleans and clamps values', () => {
    expect(cleanFood({ name: '  Oats ', kcal: 389, protein: 16.9, carbs: 66.3, fat: 6.9 })).toMatchObject({ name: 'Oats', kcal: 389, source: 'manual' })
    expect(cleanFood({ name: 'X', kcal: 5000, protein: -3, carbs: 'a', fat: 120 })).toMatchObject({ kcal: 900, protein: 0, carbs: null, fat: 100 })
    expect(cleanFood({ name: '   ' })).toBeNull()
  })
  it('clamps grams to a whole number 1–5000', () => {
    expect(clampGrams(0)).toBe(1)
    expect(clampGrams(99999)).toBe(5000)
    expect(clampGrams(12.6)).toBe(13)
    expect(clampGrams('abc')).toBe(100)
  })
  it('deleting a used food removes its items everywhere', () => {
    const { n, planId } = fresh()
    const ref = firstRef(n, planId)
    const f = addFood(n, { name: 'Rice', kcal: 130, protein: 2.7, carbs: 28, fat: 0.3 })
    const meal = at(n, ref).dayType.meals[1]
    addItem(n, { ...ref, mealId: meal.id }, f, 250)
    const other = addPlan(n, { name: 'Anna', copyFrom: planId, today: TODAY, ws: MON })
    expect(foodUsage(n, f)).toBe(2)
    deleteFood(n, f)
    expect(n.foods).toHaveLength(0)
    expect(foodUsage(n, f)).toBe(0)
    expect(n.plans.find(p => p.id === other).phases[0].dayTypes[0].meals[1].items).toEqual([])
  })
  it('updates a food in place', () => {
    const { n } = fresh()
    const f = addFood(n, { name: 'Rice', kcal: 130 })
    updateFood(n, f, { kcal: 129, name: 'White rice' })
    expect(n.foods[0]).toMatchObject({ id: f, name: 'White rice', kcal: 129 })
  })
})

describe('plans', () => {
  it('duplicates with fresh ids and keeps food references', () => {
    const { n, planId } = fresh()
    const copy = addPlan(n, { name: 'Anna – cut', copyFrom: planId, today: TODAY, ws: MON })
    const a = n.plans[0], b = n.plans.find(p => p.id === copy)
    expect(b.name).toBe('Anna – cut')
    expect(b.phases[0].id).not.toBe(a.phases[0].id)
    expect(b.phases[0].dayTypes[0].id).not.toBe(a.phases[0].dayTypes[0].id)
    expect(Object.values(b.phases[0].week)[0]).toBe(b.phases[0].dayTypes[0].id)
  })
  it('never deletes my plan', () => {
    const { n, planId } = fresh()
    expect(deletePlan(n, planId)).toBe(false)
    const other = addPlan(n, { name: 'Ben', today: TODAY, ws: MON })
    expect(deletePlan(n, other)).toBe(true)
    expect(n.plans).toHaveLength(1)
  })
  it('renames, sets the start to its week start, and sets after-last', () => {
    const { n, planId } = fresh()
    renamePlan(n, planId, '  Me  ')
    setPlanStart(n, planId, '2026-11-05', MON)
    setAfterLast(n, planId, 'restart')
    setAfterLast(n, planId, 'nonsense')
    expect(n.plans[0]).toMatchObject({ name: 'Me', start: '2026-11-02', afterLast: 'restart' })
  })
})

describe('phases', () => {
  it('adding a phase gives the previous repeating phase a length', () => {
    const { n, planId } = fresh()
    const id = addPhase(n, planId, {})
    const [p1, p2] = n.plans[0].phases
    expect(p1.weeks).toBe(4)
    expect(p2.id).toBe(id)
    expect(p2.weeks).toBeNull()
  })
  it('duplicates a phase with its day types and week', () => {
    const { n, planId } = fresh()
    const ref = firstRef(n, planId)
    setTarget(n, ref, { kcal: 2200 })
    const id = addPhase(n, planId, { copyFrom: ref.phaseId })
    const p2 = n.plans[0].phases.find(p => p.id === id)
    expect(p2.dayTypes[0].target).toEqual({ kcal: 2200 })
    expect(p2.week['1']).toBe(p2.dayTypes[0].id)
  })
  it('only the last phase may repeat', () => {
    const { n, planId } = fresh()
    addPhase(n, planId, {})
    const [p1, p2] = n.plans[0].phases
    expect(setPhaseWeeks(n, { planId, phaseId: p1.id }, null)).toBe(false)
    expect(setPhaseWeeks(n, { planId, phaseId: p1.id }, 500)).toBe(true)
    expect(p1.weeks).toBe(104)
    expect(setPhaseWeeks(n, { planId, phaseId: p2.id }, 6)).toBe(true)
    expect(setPhaseWeeks(n, { planId, phaseId: p2.id }, null)).toBe(true)
  })
  it('moving a repeating phase away from the end gives it a length', () => {
    const { n, planId } = fresh()
    addPhase(n, planId, {})
    const last = n.plans[0].phases[1]
    movePhase(n, { planId, phaseId: last.id }, -1)
    expect(n.plans[0].phases[0].id).toBe(last.id)
    expect(n.plans[0].phases[0].weeks).toBe(4)
  })
  it('keeps at least one phase, and repeat only on the last after a delete', () => {
    const { n, planId } = fresh()
    const only = n.plans[0].phases[0].id
    expect(deletePhase(n, { planId, phaseId: only })).toBe(false)
    addPhase(n, planId, {})
    renamePhase(n, { planId, phaseId: only }, 'Cut')
    expect(n.plans[0].phases[0].name).toBe('Cut')
    expect(deletePhase(n, { planId, phaseId: n.plans[0].phases[1].id })).toBe(true)
    expect(n.plans[0].phases).toHaveLength(1)
  })
  it('stops at 12 phases', () => {
    const { n, planId } = fresh()
    for (let i = 0; i < 20; i++) addPhase(n, planId, {})
    expect(n.plans[0].phases).toHaveLength(12)
    expect(addPhase(n, planId, {})).toBeNull()
  })
})

describe('day types', () => {
  it('new day types start from my default meals', () => {
    const { n, planId } = fresh()
    const ref = firstRef(n, planId)
    n.defaultMeals = ['Meal 1', 'Meal 2']
    const id = addDayType(n, ref, { name: 'Rest day' })
    expect(at(n, { ...ref, dayTypeId: id }).dayType.meals.map(m => m.name)).toEqual(['Meal 1', 'Meal 2'])
  })
  it('assigns weekdays and reports usage', () => {
    const { n, planId } = fresh()
    const ref = firstRef(n, planId)
    const rest = addDayType(n, ref, { name: 'Rest day' })
    assignDay(n, ref, 2, rest)
    assignDay(n, ref, 5, rest)
    const phase = at(n, ref).phase
    expect(dayTypeUsage(phase, rest)).toEqual([2, 5])
    expect(dayTypeUsage(phase, ref.dayTypeId)).toEqual([0, 1, 3, 4, 6])
  })
  it('deleting a used day type moves its weekdays to the replacement', () => {
    const { n, planId } = fresh()
    const ref = firstRef(n, planId)
    const rest = addDayType(n, ref, { name: 'Rest day' })
    assignDay(n, ref, 2, rest)
    expect(deleteDayType(n, { ...ref, dayTypeId: rest }, ref.dayTypeId)).toBe(true)
    expect(at(n, ref).phase.week['2']).toBe(ref.dayTypeId)
  })
  it('never deletes the last day type', () => {
    const { n, planId } = fresh()
    expect(deleteDayType(n, firstRef(n, planId), null)).toBe(false)
  })
  it('makes one weekday separate without touching the others', () => {
    const { n, planId } = fresh()
    const ref = firstRef(n, planId)
    const f = addFood(n, { name: 'Oats', kcal: 389, protein: 17, carbs: 66, fat: 7 })
    addItem(n, { ...ref, mealId: at(n, ref).dayType.meals[0].id }, f, 80)
    const id = makeDaySeparate(n, ref, 4, 'Thursday')
    const phase = at(n, ref).phase
    expect(phase.week['4']).toBe(id)
    expect(phase.week['1']).toBe(ref.dayTypeId)
    const sep = phase.dayTypes.find(d => d.id === id)
    expect(sep.name).toBe('Thursday')
    expect(sep.meals[0].items[0].foodId).toBe(f)
  })
  it('sets, clears and copies targets', () => {
    const { n, planId } = fresh()
    const ref = firstRef(n, planId)
    const rest = addDayType(n, ref, { name: 'Rest day' })
    setTarget(n, ref, { kcal: 2400.4, protein: 180, carbs: -1, fat: null })
    expect(at(n, ref).dayType.target).toEqual({ kcal: 2400, protein: 180 })
    applyTargetToAll(n, ref)
    expect(at(n, { ...ref, dayTypeId: rest }).dayType.target).toEqual({ kcal: 2400, protein: 180 })
    setTarget(n, ref, null)
    expect(at(n, ref).dayType.target).toBeUndefined()
  })
})

describe('meals and items', () => {
  it('inserts a meal at any position, also with none left', () => {
    const { n, planId } = fresh()
    const ref = firstRef(n, planId)
    insertMeal(n, ref, 1, 'Snack')
    expect(at(n, ref).dayType.meals.map(m => m.name)).toEqual(['Breakfast', 'Snack', 'Lunch', 'Snack', 'Dinner'])
    for (const m of [...at(n, ref).dayType.meals]) deleteMeal(n, { ...ref, mealId: m.id })
    expect(at(n, ref).dayType.meals).toEqual([])
    insertMeal(n, ref, 0, 'Meal 1')
    expect(at(n, ref).dayType.meals.map(m => m.name)).toEqual(['Meal 1'])
  })
  it('renames, moves and keeps a move inside the list', () => {
    const { n, planId } = fresh()
    const ref = firstRef(n, planId)
    const [b] = at(n, ref).dayType.meals
    renameMeal(n, { ...ref, mealId: b.id }, 'Early breakfast')
    moveMeal(n, { ...ref, mealId: b.id }, -1)
    moveMeal(n, { ...ref, mealId: b.id }, 1)
    expect(at(n, ref).dayType.meals.map(m => m.name)).toEqual(['Lunch', 'Early breakfast', 'Snack', 'Dinner'])
  })
  it('uses a day type’s meals as the default layout', () => {
    const { n, planId } = fresh()
    const ref = firstRef(n, planId)
    insertMeal(n, ref, 1, 'Second breakfast')
    useAsDefaultMeals(n, ref)
    expect(n.defaultMeals).toEqual(['Breakfast', 'Second breakfast', 'Lunch', 'Snack', 'Dinner'])
  })
  it('adds, changes and removes items with clamped grams', () => {
    const { n, planId } = fresh()
    const ref = firstRef(n, planId)
    const f = addFood(n, { name: 'Rice', kcal: 130 })
    const mealRef = { ...ref, mealId: at(n, ref).dayType.meals[1].id }
    const item = addItem(n, mealRef, f, 99999)
    expect(at(n, mealRef).meal.items[0]).toMatchObject({ id: item, foodId: f, grams: 5000 })
    setItemGrams(n, mealRef, item, 180)
    expect(at(n, mealRef).meal.items[0].grams).toBe(180)
    removeItem(n, mealRef, item)
    expect(at(n, mealRef).meal.items).toEqual([])
  })
  it('refuses an item once the plan holds LIMITS.planItems', () => {
    const { n, planId } = fresh()
    const ref = firstRef(n, planId)
    const f = addFood(n, { name: 'Rice', kcal: 130 })
    // 14 day types × 4 meals × 40 items = 2,240 slots, so the plan cap is hit before any other.
    while (at(n, ref).phase.dayTypes.length < LIMITS.dayTypes) addDayType(n, ref, { name: 'D' })
    const meals = at(n, ref).phase.dayTypes.flatMap(dt => dt.meals.map(m => ({ ...ref, dayTypeId: dt.id, mealId: m.id })))
    let added = 0
    for (const m of meals) for (let k = 0; k < LIMITS.items; k++) if (addItem(n, m, f, 100)) added++
    expect(added).toBe(LIMITS.planItems)
    expect(foodUsage(n, f)).toBe(LIMITS.planItems)
    expect(addItem(n, meals.at(-1), f, 100)).toBeNull()
  })
  it('refuses an item for an unknown food', () => {
    const { n, planId } = fresh()
    const ref = firstRef(n, planId)
    expect(addItem(n, { ...ref, mealId: at(n, ref).dayType.meals[0].id }, 'nope', 100)).toBeNull()
  })
})
