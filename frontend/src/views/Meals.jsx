// Plan → Meals (fork feature, docs/NUTRITION.md). Shows one week of the selected meal plan: the
// phase and day type each date falls on, each day's meals, and the day's totals against its
// day type's targets. All edits go through lib/nutrition-plans.js.
import { useMemo, useState } from 'react'
import { t } from '../lib/i18n.js'
import { DAYS, DAYN, weekOrder, weekStartOf, todayISO, fmtDate } from '../lib/format.js'
import { Button } from '../components/ui.jsx'
import Icon from '../components/Icon.jsx'
import { menuSheet, confirmSheet } from '../sheets.jsx'
import { foodPickerSheet, gramsSheet, editNutrition, editCapped } from '../components/FoodPicker.jsx'
import { tappable } from '../lib/use-sheet-keyboard.js'
import { nameSheet, targetsSheet, phasesSheet, dayTypesSheet, myFoodsSheet } from '../components/MealSheets.jsx'
import {
  ensureMine, addPlan, renamePlan, deletePlan, assignDay, makeDaySeparate,
  insertMeal, renameMeal, moveMeal, deleteMeal, addItem, setItemGrams, removeItem,
} from '../lib/nutrition-plans.js'
import { foodIndex, itemTotals, mealTotals, dayTotals, macroSplit } from '../lib/nutrition.js'
import { addDays, weekStartDate, weekdayOf, dayFor } from '../lib/nutrition-calendar.js'
import { MACRO_ORDER, SHORT, macroNames as NAME, g1, kc, Macro } from '../components/Macros.jsx'
import { mealText } from '../lib/meal-text.js'
import { shareText } from '../lib/share-text.js'
import { useUI } from '../store/useUI.js'
import '../meals.css'

export default function Meals({ S, onImport, onExport }) {
  const ws = weekStartOf(S)
  const today = todayISO()
  const n = S.nutrition
  const [planId, setPlanId] = useState(null)
  const [weekOff, setWeekOff] = useState(0)
  const [weekday, setWeekday] = useState(() => weekdayOf(today))
  // Which meal cards are open. Per view, never saved: a closed card is the overview, an open one
  // the detail you came for.
  const [open, setOpen] = useState(() => new Set())
  const toggle = id => setOpen(o => { const x = new Set(o); x.has(id) ? x.delete(id) : x.add(id); return x })
  const foods = useMemo(() => foodIndex(n?.foods), [n?.foods])
  const ready = !!(n?.mine && n.plans?.some(p => p.id === n.mine))
  // Never create the plan on view: any write stamps nutrition as edited, and sync keeps the newest
  // whole nutrition key, so an empty plan made by merely looking (before a pull) would replace
  // the plans and foods on every other device. Starting one is the user's choice.
  if (!ready) return <div className="meals">
    <div className="card">
      <p>{t('Plan what you eat across the week, with calorie and macro targets.')}</p>
      <Button variant="primary" onClick={() => editNutrition(x => ensureMine(x, today, ws))}>{t('Start my meal plan')}</Button>
      <Button variant="tinted" onClick={() => onImport?.()}>{t('Import meal plan')}</Button>
    </div>
  </div>

  const plan = n.plans.find(p => p.id === planId) || n.plans.find(p => p.id === n.mine)
  const order = weekOrder(ws)
  const weekStart = addDays(weekStartDate(today, ws), weekOff * 7)
  const dateOf = wd => addDays(weekStart, order.indexOf(wd))
  const day = dayFor(plan, dateOf(weekday), ws)
  const ref = day.dayType ? { planId: plan.id, phaseId: day.phase.id, dayTypeId: day.dayType.id } : null
  const usedOn = ref ? Object.values(day.phase.week).filter(id => id === ref.dayTypeId).length : 0

  const newPlan = () => menuSheet({
    title: t('New meal plan'),
    items: [{ label: t('Empty plan'), from: null }, ...n.plans.map(p => ({ label: t('Copy of {0}', p.name), from: p.id }))].map(o => ({
      label: o.label,
      onClick: () => nameSheet({ title: t('Name the plan'), value: '', onSave: v => setPlanId(editCapped(x => addPlan(x, { name: v, copyFrom: o.from, today, ws }))) }),
    })),
  })
  const planMenu = () => menuSheet({
    title: plan.name,
    sections: [
      { items: [
        { icon: 'plus', label: t('New meal plan'), onClick: newPlan },
        { icon: 'pencil', label: t('Rename'), onClick: () => nameSheet({ title: t('Rename meal plan'), value: plan.name, onSave: v => editNutrition(x => renamePlan(x, plan.id, v)) }) },
        { icon: 'copy', label: t('Duplicate'), onClick: () => nameSheet({ title: t('Name the plan'), value: t('Copy of {0}', plan.name), onSave: v => setPlanId(editCapped(x => addPlan(x, { name: v, copyFrom: plan.id, today, ws }))) }) },
        plan.id !== n.mine && { icon: 'trash', label: t('Delete'), danger: true, onClick: () => confirmSheet({ title: t('Delete “{0}”?', plan.name), danger: true, confirmText: t('Delete'), onConfirm: () => { editNutrition(x => deletePlan(x, plan.id)); setPlanId(null) } }) },
      ] },
      { items: [
        { icon: 'calendar', label: t('Phases'), sub: t('Weeks, start date, what comes after'), onClick: () => phasesSheet(plan.id) },
        ref && { icon: 'list', label: t('Day types'), onClick: () => dayTypesSheet({ planId: plan.id, phaseId: ref.phaseId }) },
        { icon: 'list', label: t('My foods'), onClick: myFoodsSheet },
      ] },
      { items: [
        { icon: 'share', label: t('Export meal plan'), onClick: () => onExport?.(plan.id) },
        { icon: 'download', label: t('Import meal plan'), onClick: () => onImport?.() },
      ] },
    ],
  })
  const dayTypeMenu = () => menuSheet({
    title: t('{0} uses', t(DAYN[weekday])),
    items: [
      ...day.phase.dayTypes.map(dt => ({ label: dt.name, on: dt.id === ref.dayTypeId, onClick: () => editNutrition(x => assignDay(x, ref, weekday, dt.id)) })),
      { icon: 'copy', label: t('Make this day separate'), sub: t('Its own copy, so changes affect only {0}', t(DAYN[weekday])), onClick: () => editCapped(x => makeDaySeparate(x, ref, weekday, t(DAYN[weekday]))) },
      { icon: 'list', label: t('Edit day types'), onClick: () => dayTypesSheet({ planId: plan.id, phaseId: ref.phaseId }) },
    ],
  })
  const addMealAt = index => nameSheet({ title: t('New meal'), value: t('Snack'), onSave: v => editCapped(x => insertMeal(x, ref, index, v)) })
  const mealMenu = (m, i, count) => {
    const mref = { ...ref, mealId: m.id }
    menuSheet({
      title: m.name,
      items: [
        { icon: 'pencil', label: t('Rename'), onClick: () => nameSheet({ title: t('Rename meal'), value: m.name, onSave: v => editNutrition(x => renameMeal(x, mref, v)) }) },
        i > 0 && { icon: 'arrowUp', label: t('Move up'), onClick: () => editNutrition(x => moveMeal(x, mref, -1)) },
        i < count - 1 && { icon: 'arrowDown', label: t('Move down'), onClick: () => editNutrition(x => moveMeal(x, mref, 1)) },
        { icon: 'trash', label: t('Delete meal'), danger: true, onClick: () => m.items.length
          ? confirmSheet({ title: t('Delete “{0}”?', m.name), message: m.items.length === 1 ? t('Its one food goes with it.') : t('Its {0} foods go with it.', m.items.length), danger: true, confirmText: t('Delete'), onConfirm: () => editNutrition(x => deleteMeal(x, mref)) })
          : editNutrition(x => deleteMeal(x, mref)) },
      ],
    })
  }

  const phaseLabel = day.phase
    ? (day.phase.weeks == null ? day.phase.name : t('{0} · week {1} of {2}', day.phase.name, day.weekOfPhase, day.weeksInPhase))
    : ''

  return <div className="meals">
    {n.plans.length > 1 && <div className="ml-plans">
      {[...n.plans].sort((a, b) => (a.id === n.mine ? -1 : b.id === n.mine ? 1 : 0)).map(p =>
        <button key={p.id} className={'chip' + (p.id === plan.id ? ' on' : '')} onClick={() => setPlanId(p.id)}>{p.name}</button>)}
    </div>}

    <div className="ml-week">
      <button className="iconbtn" aria-label={t('Previous week')} onClick={() => setWeekOff(w => w - 1)}><Icon name="chevronLeft" /></button>
      <div className="grow"><div>{weekOff === 0 ? t('This week') : fmtDate(weekStart)}</div><div className="muted small">{phaseLabel}</div></div>
      <button className="iconbtn" aria-label={t('Next week')} onClick={() => setWeekOff(w => w + 1)}><Icon name="chevronRight" /></button>
      <button className="iconbtn" aria-label={t('Meal plan options')} onClick={planMenu}><Icon name="more" /></button>
    </div>

    <div className="ml-days">
      {order.map(wd => {
        const dt = dayFor(plan, dateOf(wd), ws).dayType
        return <button key={wd} className={'ml-day' + (wd === weekday ? ' on' : '')} onClick={() => setWeekday(wd)}>
          <span>{t(DAYS[wd])}</span><span className="dt">{dt?.name || '–'}</span>
        </button>
      })}
    </div>

    {day.notStarted && <div className="card muted">{t('This plan starts on {0}.', fmtDate(day.startsOn, true))}</div>}
    {day.ended && <div className="card muted">{t('This plan ended on {0}.', fmtDate(day.endedOn, true))}</div>}

    {ref && <>
      <Button variant="plain" trailingIcon="chevronDown" onClick={dayTypeMenu}>{day.dayType.name}</Button>
      {usedOn > 1 && <div className="muted ml-note">{t('Changes here apply to every day using “{0}”.', day.dayType.name)}</div>}
      {day.dayType.meals.map((m, i) => <MealCard key={m.id} meal={m} foods={foods} open={open.has(m.id)} onToggle={() => toggle(m.id)}
        onShare={async () => {
          const r = await shareText(mealText(m, foods, { dayName: day.dayType.name }), m.name)
          if (r === 'copied') useUI.getState().toast(t('Meal copied. Paste it anywhere.'))
          else if (r === 'failed') useUI.getState().toast(t('Could not copy'))
        }}
        onInsertBefore={() => addMealAt(i)} onMenu={() => mealMenu(m, i, day.dayType.meals.length)}
        onAdd={() => foodPickerSheet({ onPicked: (foodId, g) => editCapped(x => addItem(x, { ...ref, mealId: m.id }, foodId, g)) })}
        onItem={it => gramsSheet({
          foodId: it.foodId, grams: it.grams,
          onSave: g => editNutrition(x => setItemGrams(x, { ...ref, mealId: m.id }, it.id, g)),
          onRemove: () => editNutrition(x => removeItem(x, { ...ref, mealId: m.id }, it.id)),
        })} />)}
      <Button variant="tinted" icon="plus" onClick={() => addMealAt(day.dayType.meals.length)}>{t('Add meal')}</Button>
      <DaySummary dayType={day.dayType} foods={foods} onTargets={() => targetsSheet(ref)} />
    </>}
  </div>
}

/* The day at a glance, after the meals: calories planned against the target, then carbs, fat and
   protein in their colours. Small on purpose: the meals are what you plan, this is the check. */
export function DaySummary({ dayType, foods, totals, onTargets, compact }) {
  const tot = totals || dayTotals(dayType, foods)
  const goal = dayType.target || {}
  const N = NAME()
  const left = goal.kcal ? goal.kcal - (tot.kcal || 0) : null
  return <div className={'card ml-sum' + (compact ? ' compact' : '')}>
    <div className="ml-sum-kcal">
      <div><span className="ml-sum-big">{kc(tot.kcal)}</span><span className="muted"> {goal.kcal ? '/ ' + goal.kcal.toLocaleString() + ' ' : ''}kcal</span></div>
      {left != null && <span className={'small ' + (left < -goal.kcal * 0.05 ? 'ml-over' : 'muted')}>
        {left >= 0 ? t('{0} left', Math.round(left).toLocaleString()) : t('{0} over', Math.round(-left).toLocaleString())}
      </span>}
    </div>
    {goal.kcal > 0 && <div className="ml-bar kcal"><i style={{ width: Math.min(100, (tot.kcal / goal.kcal) * 100) + '%' }} /></div>}
    <div className="ml-sum-macros">
      {MACRO_ORDER.map(k => <div key={k}>
        <div className={'small mc-' + k}>{N[k]}</div>
        <div className="ml-sum-g"><b>{g1(tot[k])} g</b>{goal[k] ? <span className="muted"> / {goal[k]}</span> : null}</div>
        <div className={'ml-bar mb-' + k}><i style={{ width: goal[k] ? Math.min(100, (tot[k] / goal[k]) * 100) + '%' : 0 }} /></div>
      </div>)}
    </div>
    {tot.incomplete && <div className="small ff-warn">{t('Some foods have missing values, so these totals are too low.')}</div>}
    {onTargets && <Button size="sm" variant="ghost" onClick={onTargets}>{goal.kcal || goal.protein || goal.carbs || goal.fat ? t('Edit targets') : t('Set targets')}</Button>}
  </div>
}

/* One meal. Closed it is a line in the overview — name, what is in it, kcal and where the energy
   comes from; tapping it opens the foods, each with its grams and all its macros, and the meal's
   totals underneath. */
function MealCard({ meal, foods, open, onToggle, onAdd, onItem, onMenu, onShare, onInsertBefore }) {
  const tot = mealTotals(meal, foods)
  const split = macroSplit(tot)
  const names = meal.items.map(it => foods.get(it.foodId)?.name || t('Deleted food'))
  const preview = !names.length ? t('No foods yet') : names.length === 1 ? names[0] : t('{0} and {1} more', names[0], names.length - 1)
  const N = NAME()
  return <>
    <button className="ml-insert" aria-label={t('Add a meal here')} onClick={onInsertBefore}>+</button>
    <div className={'card ml-meal' + (open ? ' open' : '')}>
      {/* The name is the stretched primary (.tap-main) and Share / options sit above it as siblings
          (card dismiss pass, design-review.test.js), so neither tap can land on the other. */}
      <div className="ml-meal-h tap-host">
        <button type="button" className="grow tap-main" aria-expanded={open} onClick={onToggle}>
          <span className="ml-meal-name">{meal.name}</span>
          <span className="muted small ml-ellip">{preview}</span>
          {!!names.length && <span className="small ml-meal-stats">
            <b>{kc(tot.kcal)} kcal</b>
            {split && MACRO_ORDER.map(k => <Macro key={k} k={k}> {SHORT[k]} {split[k]}%</Macro>)}
          </span>}
        </button>
        {!!names.length && <button className="iconbtn" aria-label={t('Share meal')} onClick={onShare}><Icon name="share" /></button>}
        <button className="iconbtn" aria-label={t('Meal options')} onClick={onMenu}><Icon name="more" /></button>
        <Icon name="chevronDown" className="ml-chev" />
      </div>
      {open && <div className="ml-body">
        {meal.items.map(it => {
          const r = itemTotals(foods.get(it.foodId), it.grams)
          return <div key={it.id} className="ml-food" {...tappable(() => onItem(it))}>
            <div className="grow">
              <div>{foods.get(it.foodId)?.name || t('Deleted food')}</div>
              <span className="ml-g">{it.grams} g</span>
            </div>
            <div className="ml-food-r">
              <div className="ml-kcal">{kc(r.kcal)} <span className="muted small">kcal</span></div>
              <div className="small">{MACRO_ORDER.map(k => <Macro key={k} k={k}> {SHORT[k]} {g1(r[k])}</Macro>)}</div>
            </div>
          </div>
        })}
        {!!meal.items.length && <div className="ml-foot">
          {MACRO_ORDER.map(k => <div key={k}><b className={'mc-' + k}>{g1(tot[k])}</b><span className={'small mc-' + k}>{N[k]}</span></div>)}
          <div><b>{kc(tot.kcal)}</b><span className="small muted">{t('kcal')}</span></div>
        </div>}
        <Button size="sm" variant="ghost" icon="plus" onClick={onAdd}>{t('Add food')}</Button>
      </div>}
    </div>
  </>
}
