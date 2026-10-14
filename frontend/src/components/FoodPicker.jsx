// frontend/src/components/FoodPicker.jsx
// Picking a food for a meal (fork feature, docs/NUTRITION.md): your own foods first, filtered as
// you type and available offline; Open Food Facts below, only on a server that offers it. A
// search result is never used as is: it opens the food form so its numbers are checked once and
// saved into your foods, which is what every plan then refers to.
import { useMemo, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t, getLang } from '../lib/i18n.js'
import { Button, TextField, NumberField } from './ui.jsx'
import { ensureNutrition, addFood, clampGrams } from '../lib/nutrition-plans.js'
import { macroKcal, kcalMismatch, roundKcal, itemTotals } from '../lib/nutrition.js'
import { foodSearchAvailable, searchFoods } from '../lib/food-search.js'
import { tappable } from '../lib/use-sheet-keyboard.js'

export function editNutrition(fn) {
  let out
  useStore.getState().update(s => { out = fn(ensureNutrition(s)) })
  return out
}

// Edits that add something return null at a cap (lib/nutrition-plans.js LIMITS); say so instead
// of doing nothing.
export function editCapped(fn) {
  const out = editNutrition(fn)
  if (out == null) useUI.getState().toast(t('That’s the limit for this plan.'))
  return out
}

const FIELDS = () => [['kcal', t('Calories (kcal)')], ['protein', t('Protein (g)')], ['carbs', t('Carbs (g)')], ['fat', t('Fat (g)')]]

export function FoodForm({ initial, onSave, onCancel, saveText }) {
  const [f, setF] = useState(() => ({ name: '', kcal: null, protein: null, carbs: null, fat: null, ...initial }))
  const set = (k, v) => setF(x => ({ ...x, [k]: v }))
  const fromMacros = macroKcal(f)
  const off = kcalMismatch(f)
  return <div className="food-form">
    <label className="ff-row"><span>{t('Name')}</span>
      <TextField value={f.name} maxLength={80} onChange={e => set('name', e.target.value)} /></label>
    <div className="muted small">{t('Values per 100 g')}</div>
    {FIELDS().map(([k, label]) => <label key={k} className="ff-row"><span>{label}</span>
      <NumberField nullable value={f[k]} onChange={v => set(k, v)} /></label>)}
    {fromMacros != null && <div className={'small ' + (off ? 'ff-warn' : 'muted')}>
      {off ? t('These values don’t add up: the macros make {0} kcal.', roundKcal(fromMacros)) : t('The macros make {0} kcal.', roundKcal(fromMacros))}
    </div>}
    <Button variant="primary" disabled={!String(f.name).trim()} onClick={() => onSave(f)}>{saveText || t('Save food')}</Button>
    <Button variant="ghost" className="dim" onClick={onCancel}>{t('Cancel')}</Button>
  </div>
}

function GramsStep({ foodId, grams: start = 100, onSave, onBack, onRemove, saveText }) {
  const food = useStore(s => s.S.nutrition?.foods?.find(f => f.id === foodId))
  const [g, setG] = useState(start)
  const tot = itemTotals(food, clampGrams(g))
  return <div className="food-form">
    <h3>{food?.name || t('Food')}</h3>
    <label className="ff-row"><span>{t('Amount (g)')}</span><NumberField decimal={false} value={g} onChange={setG} autoFocus /></label>
    <div className="muted small">{t('{0} kcal · {1} g protein', roundKcal(tot.kcal) ?? '?', tot.protein == null ? '?' : Math.round(tot.protein))}</div>
    {/* A cleared field reads 0; saving that would quietly clamp it to 1 g. */}
    <Button variant="primary" disabled={!(g >= 1)} onClick={() => onSave(clampGrams(g))}>{saveText || t('Add')}</Button>
    {onRemove && <Button variant="ghost" className="danger" onClick={onRemove}>{t('Remove from meal')}</Button>}
    <Button variant="ghost" className="dim" onClick={onBack}>{t('Cancel')}</Button>
  </div>
}

function FoodPicker({ close, onPicked }) {
  const foods = useStore(s => s.S.nutrition?.foods) || []
  const config = useStore(s => s.config)
  const user = useStore(s => s.user)
  const [q, setQ] = useState('')
  const [step, setStep] = useState({ kind: 'list' })
  const [remote, setRemote] = useState({ state: 'idle', results: [] })
  const mine = useMemo(() => {
    const k = q.trim().toLowerCase()
    return foods.filter(f => !k || f.name.toLowerCase().includes(k)).sort((a, b) => a.name.localeCompare(b.name))
  }, [foods, q])
  const canSearch = foodSearchAvailable(config, user)

  const search = async () => {
    if (q.trim().length < 2) return
    setRemote({ state: 'loading', results: [] })
    try { setRemote({ state: 'done', results: await searchFoods(q, getLang()) }) }
    catch (e) { setRemote({ state: e?.status === 429 ? 'busy' : 'error', results: [] }) }
  }

  // A product already saved from Open Food Facts is reused, not saved a second time.
  const pickResult = r => {
    const twin = r.barcode && foods.find(f => f.barcode && f.barcode === String(r.barcode).slice(0, 32))
    if (twin) return setStep({ kind: 'grams', foodId: twin.id })
    setStep({ kind: 'form', initial: { name: r.brand ? `${r.name} (${r.brand})` : r.name, ...r.per100, source: 'off', barcode: r.barcode } })
  }

  if (step.kind === 'form') return <>
    <h3>{step.initial?.name ? t('Check the values') : t('Add a food')}</h3>
    <FoodForm initial={step.initial} onCancel={() => setStep({ kind: 'list' })}
      onSave={f => { const id = editNutrition(n => addFood(n, { ...step.initial, ...f })); if (id) setStep({ kind: 'grams', foodId: id }) }} />
  </>
  if (step.kind === 'grams') return <GramsStep foodId={step.foodId} onBack={() => setStep({ kind: 'list' })}
    onSave={g => { close(); onPicked(step.foodId, g) }} />

  return <>
    <h3>{t('Add food')}</h3>
    <TextField value={q} placeholder={t('Search your foods')} onChange={e => setQ(e.target.value)} />
    <div className="fp-list">
      {mine.map(f => <div key={f.id} className="fp-res" {...tappable(() => setStep({ kind: 'grams', foodId: f.id }))}>
        <div className="grow">{f.name}</div>
        <div className="muted small">{f.kcal == null ? '?' : roundKcal(f.kcal)} kcal</div>
      </div>)}
      {!mine.length && <div className="muted small" style={{ padding: '8px 0' }}>{q ? t('None of your foods match.') : t('No foods yet.')}</div>}
    </div>
    {canSearch && <>
      <Button variant="tinted" disabled={q.trim().length < 2 || remote.state === 'loading'} onClick={search}>
        {remote.state === 'loading' ? t('Searching…') : t('Search Open Food Facts')}
      </Button>
      {remote.state === 'error' && <div className="small ff-warn">{t('Open Food Facts isn’t answering right now. Add the food manually.')}</div>}
      {remote.state === 'busy' && <div className="small ff-warn">{t('Too many searches. Try again in a minute.')}</div>}
      {remote.state === 'done' && !remote.results.length && <div className="muted small">{t('Nothing found.')}</div>}
      <div className="fp-list">
        {remote.results.map((r, i) => <div key={i} className="fp-res" {...tappable(() => pickResult(r))}>
          <div className="grow">{r.name}{r.brand && <div className="muted small">{r.brand}</div>}</div>
          <div className="muted small">{r.per100.kcal == null ? '?' : roundKcal(r.per100.kcal)} kcal · {r.per100.protein ?? '?'} P{!r.complete && ' · ' + t('incomplete')}</div>
        </div>)}
      </div>
    </>}
    <Button variant="ghost" onClick={() => setStep({ kind: 'form', initial: { name: q.trim() } })}>{t('Add manually')}</Button>
  </>
}

export function foodPickerSheet({ onPicked }) {
  useUI.getState().openSheet(close => <FoodPicker close={close} onPicked={onPicked} />)
}

export function gramsSheet({ foodId, grams, onSave, onRemove }) {
  useUI.getState().openSheet(close => <GramsStep foodId={foodId} grams={grams} saveText={t('Save')}
    onSave={g => { close(); onSave(g) }} onBack={close} onRemove={onRemove ? () => { close(); onRemove() } : null} />)
}
