// @vitest-environment happy-dom
// Plan → Meals (fork feature, docs/NUTRITION.md): the third view opens on the user's own plan,
// created on first look, and the choice of view is remembered like the other two.
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
  it('opens on Meals, creates my plan and shows the default meals', () => {
    mount()
    for (const name of ['Breakfast', 'Lunch', 'Snack', 'Dinner']) expect(host.textContent).toContain(name)
    const n = useStore.getState().S.nutrition
    expect(n.mine).toBeTruthy()
    expect(n.plans).toHaveLength(1)
  })
  it('switching views still remembers the choice', () => {
    mount()
    const routines = [...host.querySelectorAll('.plan-views button')].find(b => b.textContent === 'Routines')
    act(() => { routines.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect(localStorage.getItem(PLAN_VIEW_KEY)).toBe('routines')
  })
})
