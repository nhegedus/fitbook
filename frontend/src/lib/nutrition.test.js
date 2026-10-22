// frontend/src/lib/nutrition.test.js
import { describe, it, expect } from 'vitest'
import {
  MACROS, foodIndex, itemTotals, sumTotals, mealTotals, dayTotals,
  dayStatus, macroKcal, kcalMismatch, roundKcal, roundGrams, macroSplit,
} from './nutrition.js'

const chicken = { id: 'f1', name: 'Chicken breast', kcal: 165, protein: 31, carbs: 0, fat: 3.6 }
const rice = { id: 'f2', name: 'Rice', kcal: 130, protein: 2.7, carbs: 28, fat: 0.3 }
const banana = { id: 'f3', name: 'Banana', kcal: 89, protein: null, carbs: 23, fat: 0.3 }

describe('itemTotals', () => {
  it('scales per-100 g values by grams', () => {
    expect(itemTotals(chicken, 200)).toEqual({ kcal: 330, protein: 62, carbs: 0, fat: 7.2, incomplete: false })
  })
  it('keeps full precision', () => {
    expect(itemTotals(rice, 37).carbs).toBeCloseTo(10.36, 10)
  })
  it('keeps an unknown value unknown and marks the item incomplete', () => {
    const r = itemTotals(banana, 120)
    expect(r.protein).toBeNull()
    expect(r.kcal).toBeCloseTo(106.8, 10)
    expect(r.incomplete).toBe(true)
  })
  it('treats a missing food as all unknown', () => {
    expect(itemTotals(undefined, 100)).toEqual({ kcal: null, protein: null, carbs: null, fat: null, incomplete: true })
  })
  it('treats bad grams as zero', () => {
    expect(itemTotals(chicken, -5).kcal).toBe(0)
    expect(itemTotals(chicken, 'x').kcal).toBe(0)
  })
})

describe('sums', () => {
  const foods = foodIndex([chicken, rice, banana])
  const lunch = { id: 'm1', name: 'Lunch', items: [{ id: 'i1', foodId: 'f1', grams: 200 }, { id: 'i2', foodId: 'f2', grams: 250 }] }
  const snack = { id: 'm2', name: 'Snack', items: [{ id: 'i3', foodId: 'f3', grams: 120 }] }
  it('adds items into a meal', () => {
    const t = mealTotals(lunch, foods)
    expect(t.kcal).toBeCloseTo(655, 10)
    expect(t.protein).toBeCloseTo(68.75, 10)
    expect(t.incomplete).toBe(false)
  })
  it('adds meals into a day and carries incompleteness', () => {
    const t = dayTotals({ id: 'd', name: 'Day 1', meals: [lunch, snack] }, foods)
    expect(t.kcal).toBeCloseTo(761.8, 10)
    expect(t.protein).toBeCloseTo(68.75, 10)
    expect(t.incomplete).toBe(true)
  })
  it('an empty day is all zero and complete', () => {
    expect(dayTotals({ meals: [] }, foods)).toEqual({ kcal: 0, protein: 0, carbs: 0, fat: 0, incomplete: false })
    expect(sumTotals([])).toEqual({ kcal: 0, protein: 0, carbs: 0, fat: 0, incomplete: false })
  })
  it('an item pointing at a deleted food makes the meal incomplete', () => {
    const t = mealTotals({ items: [{ id: 'x', foodId: 'gone', grams: 100 }] }, foods)
    expect(t.incomplete).toBe(true)
    expect(t.kcal).toBe(0)
  })
})

describe('dayStatus', () => {
  const totals = { kcal: 2000, protein: 150, carbs: 300, fat: 50 }
  it('is ok within ±5 %, under and over outside it, none without a target', () => {
    expect(dayStatus(totals, { kcal: 2100, protein: 180, carbs: 280 })).toEqual({ kcal: 'ok', protein: 'under', carbs: 'over', fat: 'none' })
  })
  it('the band edges count as ok', () => {
    expect(dayStatus({ kcal: 1900 }, { kcal: 2000 }).kcal).toBe('ok')
    expect(dayStatus({ kcal: 2100 }, { kcal: 2000 }).kcal).toBe('ok')
    expect(dayStatus({ kcal: 1899 }, { kcal: 2000 }).kcal).toBe('under')
  })
  it('no target object at all is none everywhere', () => {
    expect(dayStatus(totals, null)).toEqual({ kcal: 'none', protein: 'none', carbs: 'none', fat: 'none' })
  })
  it('a zero target means none, not over', () => {
    expect(dayStatus(totals, { fat: 0 }).fat).toBe('none')
  })
})

describe('macro kcal and mismatch', () => {
  it('computes 4/4/9', () => {
    expect(macroKcal({ protein: 31, carbs: 0, fat: 3.6 })).toBeCloseTo(156.4, 10)
  })
  it('is null when a macro is unknown', () => {
    expect(macroKcal({ protein: null, carbs: 23, fat: 0.3 })).toBeNull()
  })
  it('flags only differences over 15 % and over 20 kcal', () => {
    expect(kcalMismatch(chicken)).toBe(false)                                        // 165 vs 156.4
    expect(kcalMismatch({ kcal: 400, protein: 10, carbs: 10, fat: 10 })).toBe(true)   // vs 170
    expect(kcalMismatch({ kcal: 30, protein: 1, carbs: 1, fat: 0 })).toBe(true)      // 30 vs 8: 22 kcal and 275 %
    expect(kcalMismatch({ kcal: 25, protein: 1, carbs: 1, fat: 0 })).toBe(false)     // 25 vs 8: only 17 kcal
  })
  it('never flags a food with unknown values', () => {
    expect(kcalMismatch(banana)).toBe(false)
    expect(kcalMismatch({ kcal: null, protein: 1, carbs: 1, fat: 1 })).toBe(false)
  })
})

describe('rounding for display', () => {
  it('rounds kcal to whole numbers', () => {
    expect(roundKcal(761.8)).toBe(762)
    expect(roundKcal(null)).toBeNull()
  })
  it('keeps one decimal below 10 g, whole numbers from 10 g', () => {
    expect(roundGrams(3.64)).toBe(3.6)
    expect(roundGrams(68.75)).toBe(69)
    expect(roundGrams(null)).toBeNull()
  })
})

it('lists the four values in display order', () => {
  expect(MACROS).toEqual(['kcal', 'protein', 'carbs', 'fat'])
})

describe('macroSplit', () => {
  it('splits the energy 4/4/9 into whole percents', () => {
    expect(macroSplit({ carbs: 50, protein: 25, fat: 100 / 9 })).toEqual({ carbs: 50, fat: 25, protein: 25 })
  })
  it('counts an unknown macro as nothing', () => {
    expect(macroSplit({ carbs: 25, protein: null, fat: null })).toEqual({ carbs: 100, fat: 0, protein: 0 })
  })
  it('is null when there is no energy at all', () => {
    expect(macroSplit({ carbs: 0, protein: 0, fat: 0 })).toBeNull()
    expect(macroSplit(null)).toBeNull()
  })
})
