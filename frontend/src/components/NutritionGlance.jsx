// Home's "Meals today" card (fork feature, docs/NUTRITION.md): today's planned calories against
// the target and carbs, fat and protein, from my own meal plan. Only there when today has food
// planned; read only — Home must never create or change a plan (views/Meals.jsx says why).
import { t } from '../lib/i18n.js'
import { todayISO, weekStartOf } from '../lib/format.js'
import { mealsToday } from '../lib/nutrition-today.js'
import { tappable } from '../lib/use-sheet-keyboard.js'
import Icon from './Icon.jsx'
import { MACRO_ORDER, SHORT, g1, kc, Macro } from './Macros.jsx'
import '../meals.css'

export default function NutritionGlance({ S, onOpen }) {
  const g = mealsToday(S.nutrition, todayISO(), weekStartOf(S))
  if (!g) return null
  const { totals: tot, target } = g
  const goal = target || {}
  return <div className="card tappable ml-glance" style={{ cursor: 'pointer' }} {...tappable(onOpen)}>
    <div className="row between">
      <div className="row" style={{ gap: 9, minWidth: 0 }}>
        <span className="lrow-i" style={{ background: 'var(--green)' }}><Icon name="utensils" /></span>
        <div style={{ minWidth: 0 }}>
          <div className="lbl2">{t('Meals today')}</div>
          <div className="ttl">{g.dayType.name} · {g.meals.length === 1 ? t('1 meal') : t('{0} meals', g.meals.length)}</div>
        </div>
      </div>
      <Icon name="chevronRight" className="chev" />
    </div>
    <div className="ml-glance-kcal">
      <span className="ml-sum-big">{kc(tot.kcal)}</span>
      <span className="muted small"> {goal.kcal ? '/ ' + goal.kcal.toLocaleString() + ' ' : ''}kcal</span>
      <span className="ml-glance-macros small">
        {MACRO_ORDER.map(k => <Macro key={k} k={k}>{SHORT[k]} {g1(tot[k])}{goal[k] ? '/' + goal[k] : ''} g </Macro>)}
      </span>
    </div>
    {goal.kcal > 0 && <div className="ml-bar kcal"><i style={{ width: Math.min(100, (tot.kcal / goal.kcal) * 100) + '%' }} /></div>}
  </div>
}
