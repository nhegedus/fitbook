// Open Food Facts search, always through this instance's API (the upstream search allows no
// browser calls, and a phone should not talk to a third party on its own). Available only to a
// signed-in user on a server that says it offers it.
import { api } from './api.js'

export const foodSearchAvailable = (config, user) => !!(config?.food_search && user?.id)

export async function searchFoods(q, lang) {
  const query = String(q || '').trim()
  const r = await api(`/api/food/search?q=${encodeURIComponent(query)}&lang=${encodeURIComponent(lang || 'en')}`)
  return Array.isArray(r?.results) ? r.results : []
}
