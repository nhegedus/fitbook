import { describe, it, expect, vi } from 'vitest'
vi.mock('./api.js', () => ({ api: vi.fn(async path => ({ results: [{ name: 'Rice', path }] })) }))
import { api } from './api.js'
import { foodSearchAvailable, searchFoods } from './food-search.js'

describe('food search client', () => {
  it('is available only with a signed-in user on a server that offers it', () => {
    expect(foodSearchAvailable({ food_search: true }, { id: 'u' })).toBe(true)
    expect(foodSearchAvailable({ food_search: true }, null)).toBe(false)
    expect(foodSearchAvailable({}, { id: 'u' })).toBe(false)
    expect(foodSearchAvailable(null, { id: 'u' })).toBe(false)
  })
  it('encodes the query and the language', async () => {
    const r = await searchFoods('  crème fraîche ', 'fr')
    expect(api).toHaveBeenCalledWith('/api/food/search?q=cr%C3%A8me%20fra%C3%AEche&lang=fr')
    expect(r[0].name).toBe('Rice')
  })
})
