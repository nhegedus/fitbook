import { describe, it, expect } from 'vitest'
import { mealsToday } from './nutrition-today.js'
import { ensureNutrition, ensureMine, addFood, addItem, at, setTarget, setPlanStart } from './nutrition-plans.js'

const MON = 1
function withPlan() {
  const s = {}; const n = ensureNutrition(s); const planId = ensureMine(n, '2026-10-19', MON)
  const plan = n.plans[0], phase = plan.phases[0], dt = phase.dayTypes[0]
  const ref = { planId, phaseId: phase.id, dayTypeId: dt.id }
  return { n, ref, dt }
}

describe('mealsToday', () => {
  it('is null without a plan of my own', () => {
    expect(mealsToday(undefined, '2026-10-21', MON)).toBeNull()
    expect(mealsToday({ foods: [], plans: [], mine: null }, '2026-10-21', MON)).toBeNull()
  })
  it('is null while today has no food planned', () => {
    const { n } = withPlan()
    expect(mealsToday(n, '2026-10-21', MON)).toBeNull()
  })
  it('is null before the plan starts', () => {
    const { n, ref, dt } = withPlan()
    addItem(n, { ...ref, mealId: dt.meals[0].id }, addFood(n, { name: 'Oats', kcal: 389, protein: 17, carbs: 66, fat: 7 }), 80)
    setPlanStart(n, ref.planId, '2026-11-02', MON)
    expect(mealsToday(n, '2026-10-21', MON)).toBeNull()
  })
  it('gives today’s day type, totals, target and the meals that have food', () => {
    const { n, ref, dt } = withPlan()
    const oats = addFood(n, { name: 'Oats', kcal: 389, protein: 17, carbs: 66, fat: 7 })
    addItem(n, { ...ref, mealId: dt.meals[0].id }, oats, 100)
    setTarget(n, ref, { kcal: 2000 })
    const g = mealsToday(n, '2026-10-21', MON)
    expect(g.dayType.id).toBe(dt.id)
    expect(g.totals.kcal).toBeCloseTo(389, 10)
    expect(g.target).toEqual({ kcal: 2000 })
    expect(g.meals).toEqual(['Breakfast'])
    expect(at(n, ref).dayType.meals).toHaveLength(4)
  })
})
