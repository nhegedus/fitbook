// @vitest-environment happy-dom
// Plan → Meals (fork feature, docs/NUTRITION.md): the third view starts empty until the user
// starts a plan (opening it must never write: sync is last-writer-wins on the whole nutrition
// key, so an empty plan made on view would wipe plans synced from another device), and the
// choice of view is remembered like the other two.
// The repo has no @testing-library, so this mounts with react-dom + act like Plan.rotation.test.jsx,
// but against the real store: Meals writes through update() and must re-render from it.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useStore, DEF } from '../store/useStore.js'
import Plan, { PLAN_VIEW_KEY } from './Plan.jsx'
import { ensureNutrition, ensureMine, addFood, addItem } from '../lib/nutrition-plans.js'
import { todayISO } from '../lib/format.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

let host, root
beforeEach(() => {
  localStorage.setItem(PLAN_VIEW_KEY, 'meals')
  useStore.setState({ S: structuredClone(DEF) })
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove() })

const mount = () => act(() => root.render(<MemoryRouter><Plan /></MemoryRouter>))

describe('Plan → Meals', () => {
  it('opening Meals writes nothing', () => {
    const before = structuredClone(useStore.getState().S)
    mount()
    const after = useStore.getState().S
    expect(after.nutrition).toEqual(before.nutrition)
    expect(after.edited?.nutrition).toEqual(before.edited?.nutrition)
    expect(host.textContent).toContain('Start my meal plan')
    expect(host.textContent).toContain('Import meal plan')
  })
  it('“Start my meal plan” creates my plan and shows the default meals', () => {
    mount()
    const start = [...host.querySelectorAll('button')].find(b => b.textContent === 'Start my meal plan')
    act(() => { start.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    const n = useStore.getState().S.nutrition
    expect(n.plans).toHaveLength(1)
    expect(n.mine).toBe(n.plans[0].id)
    for (const name of ['Breakfast', 'Lunch', 'Snack', 'Dinner']) expect(host.textContent).toContain(name)
  })
  it('switching views still remembers the choice', () => {
    mount()
    const routines = [...host.querySelectorAll('.plan-views button')].find(b => b.textContent === 'Routines')
    act(() => { routines.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect(localStorage.getItem(PLAN_VIEW_KEY)).toBe('routines')
  })

  describe('with a plan and a food', () => {
    beforeEach(() => {
      const S = structuredClone(DEF)
      const n = ensureNutrition(S)
      const planId = ensureMine(n, todayISO(), 1)
      const phase = n.plans[0].phases[0], dt = phase.dayTypes[0]
      const oats = addFood(n, { name: 'Oats', kcal: 389, protein: 17, carbs: 66, fat: 7 })
      addItem(n, { planId, phaseId: phase.id, dayTypeId: dt.id, mealId: dt.meals[0].id }, oats, 80)
      useStore.setState({ S })
    })
    const click = el => act(() => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    it('meal cards start closed with a preview, and open to show each food with all its macros', () => {
      mount()
      const breakfast = [...host.querySelectorAll('.ml-meal')].find(c => c.textContent.includes('Breakfast'))
      expect(breakfast.textContent).toContain('Oats')
      expect(breakfast.textContent).toContain('311 kcal')
      expect(breakfast.querySelector('.ml-food')).toBeNull()
      click(breakfast.querySelector('.ml-meal-h'))
      const row = breakfast.querySelector('.ml-food')
      expect(row.querySelector('.ml-g').textContent).toBe('80 g')
      expect(row.textContent).toContain('C 53')
      expect(row.textContent).toContain('P 14')
      expect(row.textContent).toContain('F 5.6')
      expect(breakfast.querySelector('.ml-foot').textContent).toContain('Carbs')
    })
    it('the meal menu button does not toggle the card', () => {
      mount()
      const breakfast = [...host.querySelectorAll('.ml-meal')].find(c => c.textContent.includes('Breakfast'))
      click(breakfast.querySelector('button[aria-label="Meal options"]'))
      expect(breakfast.querySelector('.ml-food')).toBeNull()
    })
    it('the day summary comes after the meals and shows C, F and P', () => {
      mount()
      const all = [...host.querySelectorAll('.ml-meal, .ml-sum')]
      expect(all.at(-1).classList.contains('ml-sum')).toBe(true)
      const sum = host.querySelector('.ml-sum').textContent
      for (const w of ['Carbs', 'Fat', 'Protein']) expect(sum).toContain(w)
    })
  })
})

