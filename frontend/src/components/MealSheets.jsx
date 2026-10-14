// The sheets behind the Meals view (fork feature, docs/NUTRITION.md). Each reads the live store
// itself, so an edit inside a sheet shows at once, and writes only through lib/nutrition-plans.js.
import { useState } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
import { DAYS, fmtDate, weekStartOf, todayISO } from '../lib/format.js'
import { Button, TextField, NumberField, Switch, Segmented } from './ui.jsx'
import { menuSheet, confirmSheet } from '../sheets.jsx'
import { FoodForm, editNutrition } from './FoodPicker.jsx'
import {
  at, setTarget, applyTargetToAll, addPhase, renamePhase, setPhaseWeeks, movePhase, deletePhase,
  setPlanStart, setAfterLast, addDayType, renameDayType, deleteDayType, dayTypeUsage, useAsDefaultMeals,
  updateFood, deleteFood, foodUsage,
} from '../lib/nutrition-plans.js'
import { macroKcal, roundKcal } from '../lib/nutrition.js'
import { phaseDates, phaseFor, startOptions } from '../lib/nutrition-calendar.js'
import { MOBILE, shareExport } from '../lib/mobile.js'
import { buildMealBundle, mealFileName, parseMealPlan, importMealPlan } from '../lib/meal-share.js'

const open = (render, opts) => useUI.getState().openSheet(render, opts)
const useN = () => useStore(s => s.S.nutrition)

/* ------------------------------ a name ------------------------------ */

function NameSheet({ title, value, onSave, close }) {
  const [v, setV] = useState(value || '')
  const done = () => { if (v.trim()) { close(); onSave(v.trim()) } }
  return <div className="food-form">
    <h3>{title}</h3>
    <TextField value={v} maxLength={60} autoFocus onChange={e => setV(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') done() }} />
    <Button variant="primary" disabled={!v.trim()} onClick={done}>{t('Save')}</Button>
    <Button variant="ghost" className="dim" onClick={close}>{t('Cancel')}</Button>
  </div>
}
export const nameSheet = props => open(close => <NameSheet {...props} close={close} />)

/* ------------------------------ targets ------------------------------ */

function TargetsSheet({ refs, close }) {
  const n = useN()
  const { dayType } = at(n, refs)
  const [v, setV] = useState(() => ({ kcal: null, protein: null, carbs: null, fat: null, ...dayType?.target }))
  if (!dayType) return null
  const fromMacros = macroKcal(v)
  const save = all => { editNutrition(x => { setTarget(x, refs, v); if (all) applyTargetToAll(x, refs) }); close() }
  return <div className="food-form">
    <h3>{t('Targets for {0}', dayType.name)}</h3>
    {[['kcal', t('Calories (kcal)')], ['protein', t('Protein (g)')], ['carbs', t('Carbs (g)')], ['fat', t('Fat (g)')]].map(([k, label]) =>
      <label key={k} className="ff-row"><span>{label}</span><NumberField nullable decimal={false} value={v[k]} onChange={x => setV(o => ({ ...o, [k]: x }))} /></label>)}
    {fromMacros != null && <div className="muted small">{t('The macros make {0} kcal.', roundKcal(fromMacros))}</div>}
    <Button variant="primary" onClick={() => save(false)}>{t('Save')}</Button>
    <Button variant="tinted" onClick={() => save(true)}>{t('Save and apply to all day types')}</Button>
    <Button variant="ghost" className="danger" onClick={() => { editNutrition(x => setTarget(x, refs, null)); close() }}>{t('Clear targets')}</Button>
  </div>
}
export const targetsSheet = refs => open(close => <TargetsSheet refs={refs} close={close} />)

/* ------------------------------- phases ------------------------------- */

function PhasesSheet({ planId }) {
  const n = useN()
  const ws = useStore(s => weekStartOf(s.S))
  const plan = n.plans.find(p => p.id === planId)
  if (!plan) return null
  const dates = phaseDates(plan, ws)
  const currentId = phaseFor(plan, todayISO(), ws).phase?.id
  const last = plan.phases.length - 1
  return <div className="food-form">
    <h3>{t('Phases')}</h3>
    <label className="ff-row"><span>{t('Plan starts')}</span>
      <input type="date" className="field" value={plan.start} onChange={e => editNutrition(x => setPlanStart(x, planId, e.target.value, ws))} /></label>
    {plan.phases.map((p, i) => {
      const ref = { planId, phaseId: p.id }
      return <div key={p.id} className="card">
        <div className="ml-meal-h">
          <span className="grow" onClick={() => nameSheet({ title: t('Rename phase'), value: p.name, onSave: v => editNutrition(x => renamePhase(x, ref, v)) })}>{p.name}</span>
          {p.id === currentId && <span className="muted small">{t('Current')}</span>}
          <span className="muted small">{fmtDate(dates[i].from)} – {dates[i].to ? fmtDate(dates[i].to) : t('no end')}</span>
        </div>
        {i === last && <label className="ff-row"><span>{t('Repeat every week')}</span>
          <Switch checked={p.weeks == null} onChange={on => editNutrition(x => setPhaseWeeks(x, ref, on ? null : 4))} /></label>}
        {p.weeks != null && <label className="ff-row"><span>{t('Weeks')}</span>
          <NumberField decimal={false} value={p.weeks} onChange={v => editNutrition(x => setPhaseWeeks(x, ref, v || 1))} /></label>}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <Button size="sm" variant="plain" disabled={i === 0} onClick={() => editNutrition(x => movePhase(x, ref, -1))}>{t('Up')}</Button>
          <Button size="sm" variant="plain" disabled={i === last} onClick={() => editNutrition(x => movePhase(x, ref, 1))}>{t('Down')}</Button>
          <Button size="sm" variant="plain" onClick={() => editNutrition(x => addPhase(x, planId, { copyFrom: p.id }))}>{t('Duplicate')}</Button>
          <Button size="sm" variant="plain" className="danger" disabled={plan.phases.length < 2}
            onClick={() => confirmSheet({ title: t('Delete “{0}”?', p.name), danger: true, confirmText: t('Delete'), onConfirm: () => editNutrition(x => deletePhase(x, ref)) })}>{t('Delete')}</Button>
        </div>
      </div>
    })}
    <Button variant="tinted" onClick={() => editNutrition(x => addPhase(x, planId, {}))}>{t('Add phase')}</Button>
    {plan.phases[last].weeks != null && <>
      <div className="muted small">{t('After the last phase')}</div>
      <Segmented value={plan.afterLast} onChange={v => editNutrition(x => setAfterLast(x, planId, v))}
        options={[{ value: 'stay', label: t('Stay on it') }, { value: 'restart', label: t('Start again') }, { value: 'end', label: t('End') }]} />
    </>}
  </div>
}
export const phasesSheet = planId => open(() => <PhasesSheet planId={planId} />)

/* ------------------------------ day types ------------------------------ */

function DayTypesSheet({ refs }) {
  const n = useN()
  const { phase } = at(n, refs)
  if (!phase) return null
  return <div className="food-form">
    <h3>{t('Day types in {0}', phase.name)}</h3>
    {phase.dayTypes.map(dt => {
      const ref = { ...refs, dayTypeId: dt.id }
      const days = dayTypeUsage(phase, dt.id)
      return <div key={dt.id} className="card">
        <div className="ml-meal-h">
          <span className="grow" onClick={() => nameSheet({ title: t('Rename day type'), value: dt.name, onSave: v => editNutrition(x => renameDayType(x, ref, v)) })}>{dt.name}</span>
          <span className="muted small">{days.length ? days.map(d => t(DAYS[d])).join(' ') : t('not used')}</span>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <Button size="sm" variant="plain" onClick={() => editNutrition(x => addDayType(x, refs, { copyFrom: dt.id }))}>{t('Duplicate')}</Button>
          <Button size="sm" variant="plain" onClick={() => { editNutrition(x => useAsDefaultMeals(x, ref)); useUI.getState().toast(t('New day types will start with these meals.')) }}>{t('Use as my default meals')}</Button>
          <Button size="sm" variant="plain" className="danger" disabled={phase.dayTypes.length < 2} onClick={() => {
            const others = phase.dayTypes.filter(d => d.id !== dt.id)
            if (!days.length) return editNutrition(x => deleteDayType(x, ref, others[0].id))
            menuSheet({
              title: t('Delete “{0}”?', dt.name), subtitle: t('Which day type should its days use instead?'),
              items: others.map(o => ({ label: o.name, onClick: () => editNutrition(x => deleteDayType(x, ref, o.id)) })),
            })
          }}>{t('Delete')}</Button>
        </div>
      </div>
    })}
    <Button variant="tinted" onClick={() => nameSheet({ title: t('New day type'), value: t('Rest day'), onSave: v => editNutrition(x => addDayType(x, refs, { name: v })) })}>{t('Add day type')}</Button>
  </div>
}
export const dayTypesSheet = refs => open(() => <DayTypesSheet refs={refs} />)

/* ------------------------------ my foods ------------------------------ */

function MyFoodsSheet() {
  const n = useN()
  const [editing, setEditing] = useState(null)
  if (editing) {
    const food = n.foods.find(f => f.id === editing)
    return <><h3>{t('Edit food')}</h3>
      <FoodForm initial={food} onCancel={() => setEditing(null)}
        onSave={f => { editNutrition(x => updateFood(x, editing, f)); setEditing(null) }} /></>
  }
  const foods = [...n.foods].sort((a, b) => a.name.localeCompare(b.name))
  return <div className="food-form">
    <h3>{t('My foods')}</h3>
    {!foods.length && <div className="muted small">{t('No foods yet. Add them from a meal.')}</div>}
    {foods.map(f => {
      const used = foodUsage(n, f.id)
      return <div key={f.id} className="fp-res">
        <div className="grow" onClick={() => setEditing(f.id)}>{f.name}
          <div className="muted small">{f.kcal ?? '?'} kcal · {f.protein ?? '?'} P · {f.carbs ?? '?'} C · {f.fat ?? '?'} F {t('per 100 g')}</div></div>
        <Button size="sm" variant="plain" className="danger" onClick={() => used
          ? confirmSheet({ title: t('Delete “{0}”?', f.name), message: t('It is used {0} times and will be removed from those meals.', used), danger: true, confirmText: t('Delete'), onConfirm: () => editNutrition(x => deleteFood(x, f.id)) })
          : editNutrition(x => deleteFood(x, f.id))}>{t('Delete')}</Button>
      </div>
    })}
  </div>
}
export const myFoodsSheet = () => open(() => <MyFoodsSheet />)

/* --------------------------- export / import --------------------------- */

export async function exportMealPlanFile(planId) {
  const n = useStore.getState().S.nutrition
  const plan = n.plans.find(p => p.id === planId)
  if (!plan) return
  const json = JSON.stringify(buildMealBundle(n, planId, todayISO()), null, 2)
  const name = mealFileName(plan.name)
  if (MOBILE) { try { await shareExport(json, name) } catch { /* dismissed */ } return }
  const blob = new Blob([json], { type: 'application/json' })
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); URL.revokeObjectURL(a.href)
  useUI.getState().toast(t('Meal plan saved. Send it to your client!'))
}

function ImportSheet({ parsed, close }) {
  const S = useStore(s => s.S)
  const ws = weekStartOf(S)
  const today = todayISO()
  const opts = startOptions(today, ws)
  const [start, setStart] = useState(opts.thisWeek)
  const mine = S.nutrition?.plans?.find(p => p.id === S.nutrition.mine)
  const mineHasFood = !!mine?.phases.some(ph => ph.dayTypes.some(dt => dt.meals.some(m => m.items.length)))
  const run = mode => {
    editNutrition(x => importMealPlan(x, parsed, { mode, start, ws, today }))
    close()
    useUI.getState().toast(mode === 'replace' ? t('Meal plan imported.') : t('Saved as a new meal plan.'))
  }
  const c = parsed.counts
  const when = start === opts.thisWeek ? 'this' : start === opts.nextWeek ? 'next' : 'date'
  return <div className="food-form">
    <h3>{parsed.name}</h3>
    <div className="muted small">{t('{0} phases · {1} day types · {2} meals · {3} foods', c.phases, c.dayTypes, c.meals, c.foods)}</div>
    {parsed.phases.map(p => <div key={p.id} className="small">
      <b>{p.name}</b> · {p.weeks == null ? t('every week') : t('{0} weeks', p.weeks)}
      {p.dayTypes.map(dt => <div key={dt.id} className="muted">{dt.name}{dt.target?.kcal ? ` · ${dt.target.kcal} kcal` : ''}</div>)}
    </div>)}
    <div className="muted small">{t('Starts')}</div>
    <Segmented value={when} onChange={v => { if (v === 'this') setStart(opts.thisWeek); else if (v === 'next') setStart(opts.nextWeek) }}
      options={[{ value: 'this', label: t('This week') }, { value: 'next', label: t('Next week') }, { value: 'date', label: t('Other date') }]} />
    <input type="date" className="field" value={start} onChange={e => e.target.value && setStart(e.target.value)} />
    <Button variant="primary" onClick={() => mineHasFood
      ? confirmSheet({ title: t('Replace your meal plan?'), message: t('Your current meal plan is replaced by this one. Your foods stay.'), danger: true, confirmText: t('Replace'), onConfirm: () => run('replace') })
      : run('replace')}>{t('Replace my meal plan')}</Button>
    <Button variant="tinted" onClick={() => run('new')}>{t('Save as a new plan')}</Button>
    <Button variant="ghost" className="dim" onClick={close}>{t('Cancel')}</Button>
  </div>
}

export function importMealText(text) {
  let parsed
  try { parsed = parseMealPlan(text) }
  catch (e) { useUI.getState().toast(e?.code ? e.message : t('Couldn’t read that file.')); return }
  open(close => <ImportSheet parsed={parsed} close={close} />)
}

export function importMealFile(f) {
  if (!f) return
  const rd = new FileReader()
  rd.onload = () => importMealText(rd.result)
  rd.readAsText(f)
}
