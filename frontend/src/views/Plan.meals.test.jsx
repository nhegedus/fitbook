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
})
