// @vitest-environment happy-dom
// Home's "Meals today" card (fork feature, docs/NUTRITION.md): only when my own plan has food
// planned for today, and showing it never writes to the store.
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { useStore, DEF } from '../store/useStore.js'
import { ensureNutrition, ensureMine, addFood, addItem } from '../lib/nutrition-plans.js'
import { todayISO } from '../lib/format.js'
import Home from './Home.jsx'

vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }))
vi.mock('../sheets.jsx', () => ({
  starterPlanSheet: vi.fn(), bwSheet: vi.fn(), goalSheet: vi.fn(), dayOverrideSheet: vi.fn(),
  calendarSheet: vi.fn(), startFlow: vi.fn(), bwDeltaColor: () => '', weighInsSheet: vi.fn(),
}))

let host, root
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove() })

const mountWith = withFood => {
  const S = { ...structuredClone(DEF), routines: [], workouts: [], bodyweight: [], dayPlan: {}, week: {}, active: null }
  if (withFood) {
    const n = ensureNutrition(S)
    const planId = ensureMine(n, todayISO(), 1)
    const phase = n.plans[0].phases[0], dt = phase.dayTypes[0]
    const oats = addFood(n, { name: 'Oats', kcal: 389, protein: 17, carbs: 66, fat: 7 })
    addItem(n, { planId, phaseId: phase.id, dayTypeId: dt.id, mealId: dt.meals[0].id }, oats, 100)
  }
  useStore.setState({ S, user: null })
  const before = structuredClone(useStore.getState().S.nutrition)
  act(() => root.render(<Home />))
  return before
}

describe('Home → Meals today', () => {
  it('stays away without a plan of my own', () => {
    mountWith(false)
    expect(host.textContent).not.toContain('Meals today')
  })
  it('shows today’s planned kcal and macros, and writes nothing', () => {
    const before = mountWith(true)
    const card = host.querySelector('.ml-glance')
    expect(card.textContent).toContain('Meals today')
    expect(card.textContent).toContain('389')
    for (const w of ['C', 'F', 'P']) expect(card.textContent).toContain(w)
    expect(useStore.getState().S.nutrition).toEqual(before)
  })
})
