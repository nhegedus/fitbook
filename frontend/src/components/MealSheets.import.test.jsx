// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useStore, DEF } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { importMealText } from './MealSheets.jsx'

describe('importMealText', () => {
  let toast, openSheet
  beforeEach(() => {
    vi.restoreAllMocks()
    useStore.setState({ S: structuredClone(DEF) })
    toast = vi.spyOn(useUI.getState(), 'toast').mockImplementation(() => {})
    openSheet = vi.spyOn(useUI.getState(), 'openSheet').mockImplementation(() => {})
  })
  it('opens the preview for a meal-plan file', () => {
    importMealText(JSON.stringify({ opengym_meals: 2, name: 'Anna', phases: [{ name: 'Cut', weeks: 6, dayTypes: [{ id: 'd', name: 'Day', meals: [] }], week: {} }], foods: [] }))
    expect(openSheet).toHaveBeenCalledTimes(1)
  })
  it('says where a training plan belongs', () => {
    importMealText(JSON.stringify({ opengym_plan: 1, routines: [] }))
    expect(toast).toHaveBeenCalledWith(expect.stringContaining('training plan'))
    expect(openSheet).not.toHaveBeenCalled()
  })
  it('refuses anything else readably', () => {
    importMealText('{nope')
    expect(toast).toHaveBeenCalledWith(expect.stringContaining('meal-plan file'))
  })
})
