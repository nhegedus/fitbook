// One meal as plain text, for sharing it with someone who has no openGym (fork feature,
// docs/NUTRITION.md): a message app, an e-mail, a note. Same numbers and rounding as the meal
// card, so what you send is what you see.
import { t } from './i18n-core.js'
import { itemTotals, mealTotals, roundKcal, roundGrams } from './nutrition.js'

const g = v => (v == null ? '?' : String(roundGrams(v)))
const k = v => (v == null ? '?' : String(roundKcal(v)))
const macros = (r, unit = '') => `C ${g(r.carbs)}${unit} · F ${g(r.fat)}${unit} · P ${g(r.protein)}${unit}`

export function mealText(meal, foods, { dayName } = {}) {
  const head = dayName ? `${meal.name} · ${dayName}` : meal.name
  if (!meal.items.length) return `${head}\n${t('No foods yet')}`
  const lines = meal.items.map(it => {
    const f = foods.get(it.foodId)
    const r = itemTotals(f, it.grams)
    return `- ${f?.name || t('Deleted food')} · ${it.grams} g · ${k(r.kcal)} kcal (${macros(r)})`
  })
  const tot = mealTotals(meal, foods)
  const total = `${t('Total')}: ${k(tot.kcal)} kcal · ${macros(tot, ' g')}` + (tot.incomplete ? ` (${t('some values missing')})` : '')
  return [head, ...lines, '', total].join('\n')
}
