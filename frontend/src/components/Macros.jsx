// Carbs, fat and protein (fork feature, docs/NUTRITION.md): always in this order and in these
// colours (meals.css .mc-*), on the meal cards, the day summary and the Home card alike, so a
// colour reads as its macro wherever it appears.
import { t } from '../lib/i18n.js'
import { roundGrams, roundKcal } from '../lib/nutrition.js'

export const MACRO_ORDER = ['carbs', 'fat', 'protein']
export const SHORT = { carbs: 'C', fat: 'F', protein: 'P' }
export const macroNames = () => ({ carbs: t('Carbs'), fat: t('Fat'), protein: t('Protein') })
export const g1 = v => (v == null ? '?' : roundGrams(v))
export const kc = v => (v == null ? '?' : roundKcal(v).toLocaleString())
export const Macro = ({ k, children }) => <span className={'mc-' + k}>{children}</span>
