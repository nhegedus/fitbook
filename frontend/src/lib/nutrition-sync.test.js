// @vitest-environment happy-dom
// Pins how the sync treats S.nutrition. It is a key the merge code does not know, so the copy
// edited last wins as a whole (approach A in docs/superpowers/specs/2026-10-12-nutrition-design.md).
// If upstream ever changes how unknown keys merge, this is where it shows.
import { describe, it, expect } from 'vitest'
import { DEF } from '../store/useStore.js'
import { mergeStates, stampEdits } from './sync-merge.js'
import { nutritionDefault } from './nutrition-plans.js'

describe('nutrition in state and sync', () => {
  it('is in the defaults, so older profiles get it by the overlay', () => {
    expect(DEF.nutrition).toEqual(nutritionDefault())
    const loaded = Object.assign(structuredClone(DEF), { workouts: [] })
    expect(loaded.nutrition.plans).toEqual([])
  })
  it('the later edit wins as a whole', () => {
    const base = { _ts: 1, workouts: [], routines: [], nutrition: nutritionDefault() }
    const a = structuredClone(base), b = structuredClone(base)
    a.nutrition.foods.push({ id: 'fa', name: 'A' }); a._ts = 100
    b.nutrition.foods.push({ id: 'fb', name: 'B' }); b._ts = 200
    stampEdits(base, a, 100)
    stampEdits(base, b, 200)
    expect(mergeStates(a, b).nutrition.foods.map(f => f.id)).toEqual(['fb'])
    expect(mergeStates(b, a).nutrition.foods.map(f => f.id)).toEqual(['fb'])
  })
  it('a copy that never had the key does not wipe it', () => {
    const withIt = { _ts: 200, workouts: [], routines: [], nutrition: { ...nutritionDefault(), mine: 'p1' } }
    stampEdits({ _ts: 1, workouts: [], routines: [] }, withIt, 200)
    const without = { _ts: 100, workouts: [], routines: [] }
    expect(mergeStates(withIt, without).nutrition.mine).toBe('p1')
  })
})
