import { describe, it, expect } from 'vitest'
import { mealText } from './meal-text.js'
import { foodIndex } from './nutrition.js'

const foods = foodIndex([
  { id: 'egg', name: 'Ou de găină', kcal: 143, protein: 12.6, carbs: 0.7, fat: 9.5 },
  { id: 'oil', name: 'Ulei de măsline', kcal: 884, protein: 0, carbs: 0, fat: 100 },
  { id: 'bar', name: 'Baton', kcal: 380, protein: null, carbs: 40, fat: 13 },
])
const meal = items => ({ id: 'm', name: 'Mic dejun', items })

describe('mealText', () => {
  it('writes the meal, one line per food with grams, kcal and C/F/P, then the total', () => {
    expect(mealText(meal([{ id: '1', foodId: 'egg', grams: 60 }, { id: '2', foodId: 'oil', grams: 5 }]), foods, { dayName: 'Joi' })).toBe([
      'Mic dejun · Joi',
      '- Ou de găină · 60 g · 86 kcal (C 0.4 · F 5.7 · P 7.6)',
      '- Ulei de măsline · 5 g · 44 kcal (C 0 · F 5 · P 0)',
      '',
      'Total: 130 kcal · C 0.4 g · F 11 g · P 7.6 g',
    ].join('\n'))
  })
  it('leaves the day out when there is none', () => {
    expect(mealText(meal([{ id: '1', foodId: 'egg', grams: 100 }]), foods).split('\n')[0]).toBe('Mic dejun')
  })
  it('shows an unknown value as ? and says the total is incomplete', () => {
    const txt = mealText(meal([{ id: '1', foodId: 'bar', grams: 50 }]), foods)
    expect(txt).toContain('- Baton · 50 g · 190 kcal (C 20 · F 6.5 · P ?)')
    expect(txt).toContain('Total: 190 kcal · C 20 g · F 6.5 g · P 0 g (some values missing)')
  })
  it('names a deleted food and says when a meal is empty', () => {
    expect(mealText(meal([{ id: '1', foodId: 'gone', grams: 10 }]), foods)).toContain('- Deleted food · 10 g · ? kcal (C ? · F ? · P ?)')
    expect(mealText(meal([]), foods)).toBe('Mic dejun\nNo foods yet')
  })
})
