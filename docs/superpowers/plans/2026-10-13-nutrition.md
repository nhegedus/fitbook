# Meal Plans & Nutrition Targets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add weekly meal plans (phases → day types → meals → foods in grams) with per-day-type kcal/macro targets, a personal foods list filled from Open Food Facts through the API, several named plans for coach drafts, and a meal-plan file for handing a plan to a client.

**Architecture:** All data lives in one new top-level state key `S.nutrition`, synced as a whole by the existing sync (no sync code changes). Logic sits in four pure helpers under `frontend/src/lib/` with unit tests; the UI is a third "Meals" view in Plan plus sheets; the API gains one module (`api/food-search.js`) and one route proxying Open Food Facts.

**Tech Stack:** React 19 + Zustand + react-router (frontend), vitest; Node 22 `node:http` API with `node:test`; Open Food Facts search-a-licious API.

**Spec:** `docs/superpowers/specs/2026-10-12-nutrition-design.md`

## Global Constraints

- No new dependencies in `frontend/` or `api/` (CONTRIBUTING: dependency-light is a hard rule). The API uses Node's global `fetch`.
- Branch `feature/nutrition`; never commit to `main`; never `git push` (the user pushes).
- Match existing style by hand: no semicolons in `frontend/src`, semicolons in `api/`; 2-space indent; comments explain *why*.
- Units: grams, kcal, grams of macros always — never converted to lb.
- Value ranges: grams per item integer 1–5000; per 100 g: kcal 0–900, protein/carbs/fat 0–100, `null` = unknown; phase length 1–104 weeks; at most 12 phases per plan, 14 day types per phase, 12 meals per day type, 40 items per meal; names trimmed, 1–60 characters (foods 1–80).
- `weeks: null` ("repeat every week") only on the last phase.
- Status band: `ok` within ±5 % of target. Mismatch flag: stated kcal differs from 4·P+4·C+9·F by more than 15 % **and** more than 20 kcal.
- Display rounding only in display helpers: kcal whole; grams 1 decimal under 10, else whole.
- Default meals: `['Breakfast', 'Lunch', 'Snack', 'Dinner']`.
- Meal-plan file: `{ "opengym_meals": 2, ... }`, never carries `start`, workouts, weigh-ins or settings.
- API: `GET /api/food/search?q=&lang=`; session required (401); `q` 2–80 chars (400); 30 searches/min/user (429 + `Retry-After`); 8 s timeout; upstream failure → `502 { error: 'food-search-unavailable' }`; cache 24 h / 500 entries; `FOOD_SEARCH=0` → 404 and no `food_search` in `/api/config`; `User-Agent: openGym (<ORIGIN>)`; upstream overridable by `FOOD_SEARCH_URL`.
- `/api/config` exposes `food_search: true` (snake_case like its other keys) when the route is on.
- Strings: English only, through `t('…')` so they can be translated later; do **not** add keys to `frontend/src/locales/*` (a key in some packs but not all fails `check-locales`).
- State edit helpers mutate the draft they are given (the store's `update(mut)` clones first), like `lib/routines.js`.
- Weekday keys are strings of `Date#getDay()`: `'1'` Monday … `'0'` Sunday. Week start `ws` is `0` (Sunday) or `1` (Monday) from `weekStartOf(S)`.

## Review Focus

1. **A plan whose start is in the future or whose phases ended** — the Meals screen must show "Starts on …" / "Plan ended on …" instead of crashing on a missing day type. Pinned in Task 2 tests (`notStarted`, `ended`) and handled in Task 8 render.
2. **Deleting a food, day type or phase that is in use** — no item, weekday or phase may be left pointing at nothing. Pinned in Task 3 tests (`deleteFood` removes items, `deleteDayType` reassigns weekdays, `deletePhase` keeps "repeat" only on the last).
3. **A hand-edited or truncated meal-plan file** — import must clamp, repair and refuse with a readable message, never write a broken plan. Pinned in Task 4 tests (bad JSON, training-plan file, weekday pointing at a missing day type, out-of-range grams).
4. **Open Food Facts results with missing or kJ-only energy, string numbers, or no name** — results must be normalized or dropped. Pinned in Task 6 tests (`normalizeHit`).
5. **A profile synced from an older app version that never had `nutrition`** — the key must default and survive the server's merge. Pinned in Task 5 tests (DEF overlay, `mergeStates`, `keepUnknown`).

---

## File Structure

| File | Responsibility |
|---|---|
| `frontend/src/lib/nutrition.js` (new) | Numbers: item / meal / day totals, target status, macro kcal, rounding |
| `frontend/src/lib/nutrition-calendar.js` (new) | Dates: week start, phase and day type for a date, phase dates, start options |
| `frontend/src/lib/nutrition-plans.js` (new) | Defaults and every edit of `S.nutrition` (plans, phases, day types, meals, items, foods) |
| `frontend/src/lib/meal-share.js` (new) | Meal-plan file: build, detect, parse/repair, import with food merge |
| `frontend/src/lib/food-search.js` (new) | Client call to `/api/food/search` and availability check |
| `frontend/src/components/FoodPicker.jsx` (new) | Food picker sheet + food form |
| `frontend/src/components/MealSheets.jsx` (new) | Targets, phases, day types, my foods, plan menu, grams, import/export sheets |
| `frontend/src/views/Meals.jsx` (new) | The Meals view inside Plan |
| `frontend/src/meals.css` (new) | Styles for the above |
| `api/food-search.js` (new) | Open Food Facts proxy: normalize, cache, timeout |
| `docs/NUTRITION.md` (new) | User/coach guide, privacy, `FOOD_SEARCH` |
| `frontend/src/store/useStore.js` | `nutrition` default in `DEF` |
| `frontend/src/views/Plan.jsx` | Third segment "Meals" |
| `frontend/src/sheets.jsx` | Hand a meal-plan file from the training import to the meal import |
| `api/server.js` | Route, rate window, `food_search` in config |
| `api/openapi.yaml` | Route documentation |
| `api/Dockerfile`, `api/Dockerfile.railway` | COPY `food-search.js` |

---

### Task 1: Nutrition numbers (`lib/nutrition.js`)

**Files:**
- Create: `frontend/src/lib/nutrition.js`
- Test: `frontend/src/lib/nutrition.test.js`

**Interfaces:**
- Produces:
  - `MACROS = ['kcal','protein','carbs','fat']`
  - `foodIndex(foods) → Map<id, food>`
  - `itemTotals(food | undefined, grams) → { kcal, protein, carbs, fat, incomplete }` (numbers; `null` when the food lacks that value)
  - `sumTotals(list) → { kcal, protein, carbs, fat, incomplete }` (nulls count as 0 and set `incomplete`)
  - `mealTotals(meal, foodsById)`, `dayTotals(dayType, foodsById)` → same shape
  - `dayStatus(totals, target) → { kcal, protein, carbs, fat }` each `'ok'|'under'|'over'|'none'`
  - `macroKcal({ protein, carbs, fat }) → number | null`
  - `kcalMismatch(food) → boolean`
  - `roundKcal(n) → number`, `roundGrams(n) → number`

- [ ] **Step 1: Write the failing test**

```js
// frontend/src/lib/nutrition.test.js
import { describe, it, expect } from 'vitest'
import {
  MACROS, foodIndex, itemTotals, sumTotals, mealTotals, dayTotals,
  dayStatus, macroKcal, kcalMismatch, roundKcal, roundGrams,
} from './nutrition.js'

const chicken = { id: 'f1', name: 'Chicken breast', kcal: 165, protein: 31, carbs: 0, fat: 3.6 }
const rice = { id: 'f2', name: 'Rice', kcal: 130, protein: 2.7, carbs: 28, fat: 0.3 }
const banana = { id: 'f3', name: 'Banana', kcal: 89, protein: null, carbs: 23, fat: 0.3 }

describe('itemTotals', () => {
  it('scales per-100 g values by grams', () => {
    expect(itemTotals(chicken, 200)).toEqual({ kcal: 330, protein: 62, carbs: 0, fat: 7.2, incomplete: false })
  })
  it('keeps full precision', () => {
    expect(itemTotals(rice, 37).carbs).toBeCloseTo(10.36, 10)
  })
  it('keeps an unknown value unknown and marks the item incomplete', () => {
    const r = itemTotals(banana, 120)
    expect(r.protein).toBeNull()
    expect(r.kcal).toBeCloseTo(106.8, 10)
    expect(r.incomplete).toBe(true)
  })
  it('treats a missing food as all unknown', () => {
    expect(itemTotals(undefined, 100)).toEqual({ kcal: null, protein: null, carbs: null, fat: null, incomplete: true })
  })
  it('treats bad grams as zero', () => {
    expect(itemTotals(chicken, -5).kcal).toBe(0)
    expect(itemTotals(chicken, 'x').kcal).toBe(0)
  })
})

describe('sums', () => {
  const foods = foodIndex([chicken, rice, banana])
  const lunch = { id: 'm1', name: 'Lunch', items: [{ id: 'i1', foodId: 'f1', grams: 200 }, { id: 'i2', foodId: 'f2', grams: 250 }] }
  const snack = { id: 'm2', name: 'Snack', items: [{ id: 'i3', foodId: 'f3', grams: 120 }] }
  it('adds items into a meal', () => {
    const t = mealTotals(lunch, foods)
    expect(t.kcal).toBeCloseTo(655, 10)
    expect(t.protein).toBeCloseTo(68.75, 10)
    expect(t.incomplete).toBe(false)
  })
  it('adds meals into a day and carries incompleteness', () => {
    const t = dayTotals({ id: 'd', name: 'Day 1', meals: [lunch, snack] }, foods)
    expect(t.kcal).toBeCloseTo(761.8, 10)
    expect(t.protein).toBeCloseTo(68.75, 10)
    expect(t.incomplete).toBe(true)
  })
  it('an empty day is all zero and complete', () => {
    expect(dayTotals({ meals: [] }, foods)).toEqual({ kcal: 0, protein: 0, carbs: 0, fat: 0, incomplete: false })
    expect(sumTotals([])).toEqual({ kcal: 0, protein: 0, carbs: 0, fat: 0, incomplete: false })
  })
  it('an item pointing at a deleted food makes the meal incomplete', () => {
    const t = mealTotals({ items: [{ id: 'x', foodId: 'gone', grams: 100 }] }, foods)
    expect(t.incomplete).toBe(true)
    expect(t.kcal).toBe(0)
  })
})

describe('dayStatus', () => {
  const totals = { kcal: 2000, protein: 150, carbs: 300, fat: 50 }
  it('is ok within ±5 %, under and over outside it, none without a target', () => {
    expect(dayStatus(totals, { kcal: 2100, protein: 180, carbs: 280 })).toEqual({ kcal: 'ok', protein: 'under', carbs: 'over', fat: 'none' })
  })
  it('the band edges count as ok', () => {
    expect(dayStatus({ kcal: 1900 }, { kcal: 2000 }).kcal).toBe('ok')
    expect(dayStatus({ kcal: 2100 }, { kcal: 2000 }).kcal).toBe('ok')
    expect(dayStatus({ kcal: 1899 }, { kcal: 2000 }).kcal).toBe('under')
  })
  it('no target object at all is none everywhere', () => {
    expect(dayStatus(totals, null)).toEqual({ kcal: 'none', protein: 'none', carbs: 'none', fat: 'none' })
  })
  it('a zero target means none, not over', () => {
    expect(dayStatus(totals, { fat: 0 }).fat).toBe('none')
  })
})

describe('macro kcal and mismatch', () => {
  it('computes 4/4/9', () => {
    expect(macroKcal({ protein: 31, carbs: 0, fat: 3.6 })).toBeCloseTo(156.4, 10)
  })
  it('is null when a macro is unknown', () => {
    expect(macroKcal({ protein: null, carbs: 23, fat: 0.3 })).toBeNull()
  })
  it('flags only differences over 15 % and over 20 kcal', () => {
    expect(kcalMismatch(chicken)).toBe(false)                                        // 165 vs 156.4
    expect(kcalMismatch({ kcal: 400, protein: 10, carbs: 10, fat: 10 })).toBe(true)   // vs 170
    expect(kcalMismatch({ kcal: 30, protein: 1, carbs: 1, fat: 0 })).toBe(true)      // 30 vs 8: 22 kcal and 275 %
    expect(kcalMismatch({ kcal: 25, protein: 1, carbs: 1, fat: 0 })).toBe(false)     // 25 vs 8: only 17 kcal
  })
  it('never flags a food with unknown values', () => {
    expect(kcalMismatch(banana)).toBe(false)
    expect(kcalMismatch({ kcal: null, protein: 1, carbs: 1, fat: 1 })).toBe(false)
  })
})

describe('rounding for display', () => {
  it('rounds kcal to whole numbers', () => {
    expect(roundKcal(761.8)).toBe(762)
    expect(roundKcal(null)).toBeNull()
  })
  it('keeps one decimal below 10 g, whole numbers from 10 g', () => {
    expect(roundGrams(3.64)).toBe(3.6)
    expect(roundGrams(68.75)).toBe(69)
    expect(roundGrams(null)).toBeNull()
  })
})

it('lists the four values in display order', () => {
  expect(MACROS).toEqual(['kcal', 'protein', 'carbs', 'fat'])
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/lib/nutrition.test.js`
Expected: FAIL — `Failed to resolve import "./nutrition.js"`.

- [ ] **Step 3: Write the implementation**

```js
// frontend/src/lib/nutrition.js
// Meal-plan numbers (fork feature, docs/NUTRITION.md). Everything here is per-100 g food values
// times grams, summed. A value a food does not state stays null on the item and counts as 0 in a
// sum, with `incomplete` set, so a day never claims a total it cannot know.

export const MACROS = ['kcal', 'protein', 'carbs', 'fat']
const BAND = 0.05            // ±5 % of a target counts as on target
const MISMATCH_PCT = 0.15    // stated kcal vs 4/4/9 from macros…
const MISMATCH_KCAL = 20     // …and at least this far apart in absolute terms

const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const zero = () => ({ kcal: 0, protein: 0, carbs: 0, fat: 0, incomplete: false })

export const foodIndex = foods => new Map((foods || []).map(f => [f.id, f]))

export function itemTotals(food, grams) {
  const g = Math.max(0, num(Number(grams)) ?? 0)
  const out = { incomplete: !food }
  for (const k of MACROS) {
    const v = food ? num(food[k]) : null
    out[k] = v == null ? null : v * g / 100
    if (v == null) out.incomplete = true
  }
  return { kcal: out.kcal, protein: out.protein, carbs: out.carbs, fat: out.fat, incomplete: out.incomplete }
}

export function sumTotals(list) {
  const out = zero()
  for (const t of list || []) {
    for (const k of MACROS) {
      if (t[k] == null) out.incomplete = true
      else out[k] += t[k]
    }
    if (t.incomplete) out.incomplete = true
  }
  return out
}

export const mealTotals = (meal, foodsById) =>
  sumTotals((meal?.items || []).map(it => itemTotals(foodsById.get(it.foodId), it.grams)))

export const dayTotals = (dayType, foodsById) =>
  sumTotals((dayType?.meals || []).map(m => mealTotals(m, foodsById)))

export function dayStatus(totals, target) {
  const out = {}
  for (const k of MACROS) {
    const goal = num(target?.[k])
    const have = num(totals?.[k]) ?? 0
    if (!goal) out[k] = 'none'
    else if (have < goal * (1 - BAND)) out[k] = 'under'
    else if (have > goal * (1 + BAND)) out[k] = 'over'
    else out[k] = 'ok'
  }
  return out
}

export function macroKcal({ protein, carbs, fat } = {}) {
  const p = num(protein), c = num(carbs), f = num(fat)
  return p == null || c == null || f == null ? null : 4 * p + 4 * c + 9 * f
}

export function kcalMismatch(food) {
  const stated = num(food?.kcal), fromMacros = macroKcal(food || {})
  if (stated == null || fromMacros == null) return false
  const diff = Math.abs(stated - fromMacros)
  return diff > MISMATCH_KCAL && diff > MISMATCH_PCT * Math.max(stated, fromMacros)
}

export const roundKcal = n => (num(n) == null ? null : Math.round(n))
export const roundGrams = n => (num(n) == null ? null : n < 10 ? Math.round(n * 10) / 10 : Math.round(n))
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/lib/nutrition.test.js`
Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/nutrition.js frontend/src/lib/nutrition.test.js
git commit -m "Nutrition: per-100 g totals, target status and the kcal check"
```

---

### Task 2: Nutrition calendar (`lib/nutrition-calendar.js`)

**Files:**
- Create: `frontend/src/lib/nutrition-calendar.js`
- Test: `frontend/src/lib/nutrition-calendar.test.js`

**Interfaces:**
- Produces:
  - `addDays(iso, n) → iso`, `weekdayOf(iso) → 0..6`, `weekStartDate(iso, ws) → iso`
  - `phaseFor(plan, iso, ws) → { phase, index, weekOfPhase, weeksInPhase, beyond? } | { notStarted: true, startsOn } | { ended: true, endedOn } | { empty: true }`
  - `dayFor(plan, iso, ws) → phaseFor result plus { weekday, dayType }` (when a phase applies)
  - `phaseDates(plan, ws) → [{ id, from, to | null }]`
  - `startOptions(today, ws) → { thisWeek: iso, nextWeek: iso }`

Dates are `YYYY-MM-DD` strings; arithmetic is done in UTC so daylight-saving changes never shift a day.

- [ ] **Step 1: Write the failing test**

```js
// frontend/src/lib/nutrition-calendar.test.js
import { describe, it, expect } from 'vitest'
import { addDays, weekdayOf, weekStartDate, phaseFor, dayFor, phaseDates, startOptions } from './nutrition-calendar.js'

const MON = 1, SUN = 0
const week = (a, b) => ({ '1': a, '2': b, '3': a, '4': a, '5': b, '6': b, '0': b })
const plan = (over = {}) => ({
  id: 'p', name: 'Anna', start: '2026-10-12', afterLast: 'stay',
  phases: [
    { id: 'cut', name: 'Cut', weeks: 6, dayTypes: [{ id: 'tc', name: 'Training' }, { id: 'rc', name: 'Rest' }], week: week('tc', 'rc') },
    { id: 'main', name: 'Maintenance', weeks: 4, dayTypes: [{ id: 'tm', name: 'Training' }, { id: 'rm', name: 'Rest' }], week: week('tm', 'rm') },
  ],
  ...over,
})

describe('date helpers', () => {
  it('adds days across months and a DST change', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01')
    expect(addDays('2026-03-28', 2)).toBe('2026-03-30')
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31')
  })
  it('knows the weekday', () => {
    expect(weekdayOf('2026-10-12')).toBe(1)
    expect(weekdayOf('2026-10-18')).toBe(0)
  })
  it('finds the first day of the week for both week starts', () => {
    expect(weekStartDate('2026-10-15', MON)).toBe('2026-10-12')
    expect(weekStartDate('2026-10-18', MON)).toBe('2026-10-12')
    expect(weekStartDate('2026-10-15', SUN)).toBe('2026-10-11')
    expect(weekStartDate('2026-10-11', SUN)).toBe('2026-10-11')
  })
})

describe('phaseFor', () => {
  it('is not started before the start week', () => {
    expect(phaseFor(plan(), '2026-10-11', MON)).toEqual({ notStarted: true, startsOn: '2026-10-12' })
  })
  it('counts weeks inside the first phase', () => {
    const r = phaseFor(plan(), '2026-10-28', MON)
    expect(r.phase.id).toBe('cut')
    expect(r.weekOfPhase).toBe(3)
    expect(r.weeksInPhase).toBe(6)
  })
  it('switches phase exactly on the boundary', () => {
    expect(phaseFor(plan(), '2026-11-22', MON).phase.id).toBe('cut')    // Sunday of week 6
    expect(phaseFor(plan(), '2026-11-23', MON).phase.id).toBe('main')   // Monday of week 7
    expect(phaseFor(plan(), '2026-11-23', MON).weekOfPhase).toBe(1)
  })
  it('stays on the last phase after the end by default', () => {
    const r = phaseFor(plan(), '2027-06-01', MON)
    expect(r.phase.id).toBe('main')
    expect(r.beyond).toBe(true)
  })
  it('restarts the cycle when asked', () => {
    // week 10 (0-based) of a 10-week cycle is week 0 again
    const r = phaseFor(plan({ afterLast: 'restart' }), '2026-12-21', MON)
    expect(r.phase.id).toBe('cut')
    expect(r.weekOfPhase).toBe(1)
  })
  it('ends when asked, on the last day of the last phase', () => {
    expect(phaseFor(plan({ afterLast: 'end' }), '2026-12-21', MON)).toEqual({ ended: true, endedOn: '2026-12-20' })
    expect(phaseFor(plan({ afterLast: 'end' }), '2026-12-20', MON).phase.id).toBe('main')
  })
  it('a repeating last phase never ends', () => {
    const p = plan({ afterLast: 'end' })
    p.phases[1].weeks = null
    const r = phaseFor(p, '2030-01-01', MON)
    expect(r.phase.id).toBe('main')
    expect(r.weeksInPhase).toBeNull()
  })
  it('a start date in mid-week counts from the start of its week', () => {
    expect(phaseFor(plan({ start: '2026-10-15' }), '2026-10-12', MON).phase.id).toBe('cut')
  })
  it('follows a Sunday week start', () => {
    // Sunday 2026-10-11 starts the week containing 2026-10-12
    expect(phaseFor(plan(), '2026-10-11', SUN).phase.id).toBe('cut')
    expect(phaseFor(plan(), '2026-10-10', SUN).notStarted).toBe(true)
  })
  it('a plan without phases is empty', () => {
    expect(phaseFor(plan({ phases: [] }), '2026-10-12', MON)).toEqual({ empty: true })
  })
})

describe('dayFor', () => {
  it('picks the weekday’s day type in the right phase', () => {
    expect(dayFor(plan(), '2026-10-13', MON).dayType.id).toBe('rc')          // Tuesday, cut
    expect(dayFor(plan(), '2026-11-26', MON).dayType.id).toBe('tm')          // Thursday, maintenance
    expect(dayFor(plan(), '2026-11-26', MON).weekday).toBe(4)
  })
  it('falls back to the first day type when a weekday points at nothing', () => {
    const p = plan()
    p.phases[0].week['2'] = 'gone'
    expect(dayFor(p, '2026-10-13', MON).dayType.id).toBe('tc')
  })
  it('passes notStarted and ended through without a day type', () => {
    expect(dayFor(plan(), '2026-10-01', MON).notStarted).toBe(true)
    expect(dayFor(plan({ afterLast: 'end' }), '2027-01-04', MON).ended).toBe(true)
  })
})

describe('phaseDates and startOptions', () => {
  it('lists each phase with its first and last day', () => {
    expect(phaseDates(plan(), MON)).toEqual([
      { id: 'cut', from: '2026-10-12', to: '2026-11-22' },
      { id: 'main', from: '2026-11-23', to: '2026-12-20' },
    ])
  })
  it('a repeating phase has no last day', () => {
    const p = plan(); p.phases[1].weeks = null
    expect(phaseDates(p, MON)[1]).toEqual({ id: 'main', from: '2026-11-23', to: null })
  })
  it('offers this week and next week', () => {
    expect(startOptions('2026-10-15', MON)).toEqual({ thisWeek: '2026-10-12', nextWeek: '2026-10-19' })
    expect(startOptions('2026-10-15', SUN)).toEqual({ thisWeek: '2026-10-11', nextWeek: '2026-10-18' })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/lib/nutrition-calendar.test.js`
Expected: FAIL — cannot resolve `./nutrition-calendar.js`.

- [ ] **Step 3: Write the implementation**

```js
// frontend/src/lib/nutrition-calendar.js
// Which phase and day type of a meal plan applies on a date (fork feature, docs/NUTRITION.md).
// Weeks count from the first day of the week the plan starts in, in the user's week start, so a
// plan started on a Thursday still has Monday as day 1 of its first week. Arithmetic is in UTC
// days: a local Date across a daylight-saving change is 23 or 25 hours and would slip a day.

const DAY = 86400000
const toUTC = iso => { const [y, m, d] = iso.split('-').map(Number); return Date.UTC(y, m - 1, d) }
const fromUTC = ms => new Date(ms).toISOString().slice(0, 10)

export const addDays = (iso, n) => fromUTC(toUTC(iso) + n * DAY)
export const weekdayOf = iso => new Date(toUTC(iso)).getUTCDay()
export const weekStartDate = (iso, ws) => addDays(iso, -((weekdayOf(iso) - ws + 7) % 7))
const daysBetween = (a, b) => Math.round((toUTC(b) - toUTC(a)) / DAY)

export function phaseFor(plan, iso, ws) {
  const phases = plan?.phases || []
  if (!phases.length) return { empty: true }
  const start = weekStartDate(plan.start, ws)
  const w = Math.floor(daysBetween(start, weekStartDate(iso, ws)) / 7)
  if (w < 0) return { notStarted: true, startsOn: start }
  const open = phases[phases.length - 1].weeks == null
  const cycle = phases.reduce((a, p) => a + (p.weeks || 0), 0)
  let wk = w
  if (!open && w >= cycle) {
    if (plan.afterLast === 'end') return { ended: true, endedOn: addDays(start, cycle * 7 - 1) }
    if (plan.afterLast === 'restart') wk = w % cycle
    else {
      const index = phases.length - 1, phase = phases[index]
      return { phase, index, weekOfPhase: phase.weeks, weeksInPhase: phase.weeks, beyond: true }
    }
  }
  let acc = 0
  for (let index = 0; index < phases.length; index++) {
    const phase = phases[index]
    if (phase.weeks == null || wk < acc + phase.weeks) {
      return { phase, index, weekOfPhase: wk - acc + 1, weeksInPhase: phase.weeks ?? null }
    }
    acc += phase.weeks
  }
  return { empty: true }
}

export function dayFor(plan, iso, ws) {
  const r = phaseFor(plan, iso, ws)
  if (!r.phase) return r
  const weekday = weekdayOf(iso)
  const types = r.phase.dayTypes || []
  const dayType = types.find(d => d.id === r.phase.week?.[String(weekday)]) || types[0] || null
  return { ...r, weekday, dayType }
}

export function phaseDates(plan, ws) {
  const start = weekStartDate(plan.start, ws)
  let acc = 0
  return (plan.phases || []).map(p => {
    const from = addDays(start, acc * 7)
    const to = p.weeks == null ? null : addDays(start, (acc + p.weeks) * 7 - 1)
    acc += p.weeks || 0
    return { id: p.id, from, to }
  })
}

export function startOptions(today, ws) {
  const thisWeek = weekStartDate(today, ws)
  return { thisWeek, nextWeek: addDays(thisWeek, 7) }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/lib/nutrition-calendar.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/nutrition-calendar.js frontend/src/lib/nutrition-calendar.test.js
git commit -m "Nutrition: which phase and day type a date falls on"
```

---

### Task 3: Plan edits (`lib/nutrition-plans.js`)

**Files:**
- Create: `frontend/src/lib/nutrition-plans.js`
- Test: `frontend/src/lib/nutrition-plans.test.js`

**Interfaces:**
- Consumes: `uid` from `lib/format.js`; `weekStartDate` from Task 2.
- Produces (every function mutates the `n` = `S.nutrition` object it is given; `ref = { planId, phaseId, dayTypeId, mealId }`):
  - Constants: `DEFAULT_MEALS`, `LIMITS = { grams: [1,5000], kcal: [0,900], macro: [0,100], weeks: [1,104], phases: 12, dayTypes: 14, meals: 12, items: 40, name: 60, foodName: 80 }`
  - `nutritionDefault() → { foods: [], defaultMeals: [...DEFAULT_MEALS], plans: [], mine: null }`
  - `ensureNutrition(s) → n` (creates or repairs `s.nutrition`)
  - `cleanFood(raw) → food | null`, `clampGrams(g) → int`, `cleanName(s, max) → string`
  - `at(n, ref) → { plan, phase, dayType, meal }` (any may be `undefined`)
  - Plans: `ensureMine(n, today, ws) → planId`, `addPlan(n, { name, copyFrom, today, ws }) → planId`, `renamePlan(n, planId, name)`, `deletePlan(n, planId) → boolean`, `setPlanStart(n, planId, iso, ws)`, `setAfterLast(n, planId, v)`
  - Phases: `addPhase(n, planId, { copyFrom }) → phaseId | null`, `renamePhase(n, ref, name)`, `setPhaseWeeks(n, ref, weeks | null) → boolean`, `movePhase(n, ref, dir)`, `deletePhase(n, ref) → boolean`
  - Day types: `addDayType(n, ref, { copyFrom, name }) → dayTypeId | null`, `renameDayType(n, ref, name)`, `deleteDayType(n, ref, replacementId) → boolean`, `assignDay(n, ref, weekday, dayTypeId)`, `makeDaySeparate(n, ref, weekday, name) → dayTypeId`, `setTarget(n, ref, target | null)`, `applyTargetToAll(n, ref)`, `dayTypeUsage(phase, dayTypeId) → weekday[]`
  - Meals: `insertMeal(n, ref, index, name) → mealId | null`, `renameMeal(n, ref, name)`, `moveMeal(n, ref, dir)`, `deleteMeal(n, ref)`, `useAsDefaultMeals(n, ref)`
  - Items: `addItem(n, ref, foodId, grams) → itemId | null`, `setItemGrams(n, ref, itemId, grams)`, `removeItem(n, ref, itemId)`
  - Foods: `addFood(n, raw) → foodId | null`, `updateFood(n, foodId, patch)`, `foodUsage(n, foodId) → number`, `deleteFood(n, foodId)`

- [ ] **Step 1: Write the failing test**

```js
// frontend/src/lib/nutrition-plans.test.js
import { describe, it, expect } from 'vitest'
import {
  DEFAULT_MEALS, nutritionDefault, ensureNutrition, cleanFood, clampGrams, at,
  ensureMine, addPlan, renamePlan, deletePlan, setPlanStart, setAfterLast,
  addPhase, renamePhase, setPhaseWeeks, movePhase, deletePhase,
  addDayType, deleteDayType, assignDay, makeDaySeparate, setTarget, applyTargetToAll, dayTypeUsage,
  insertMeal, renameMeal, moveMeal, deleteMeal, useAsDefaultMeals,
  addItem, setItemGrams, removeItem, addFood, updateFood, foodUsage, deleteFood,
} from './nutrition-plans.js'

const TODAY = '2026-10-15', MON = 1
const fresh = () => { const s = {}; const n = ensureNutrition(s); const planId = ensureMine(n, TODAY, MON); return { s, n, planId } }
const firstRef = (n, planId) => {
  const plan = n.plans.find(p => p.id === planId), phase = plan.phases[0], dayType = phase.dayTypes[0]
  return { planId, phaseId: phase.id, dayTypeId: dayType.id }
}

describe('defaults', () => {
  it('creates nutrition and my plan on first use', () => {
    const { n, planId } = fresh()
    expect(n.mine).toBe(planId)
    const plan = n.plans[0]
    expect(plan.name).toBe('My plan')
    expect(plan.start).toBe('2026-10-12')
    expect(plan.afterLast).toBe('stay')
    expect(plan.phases).toHaveLength(1)
    expect(plan.phases[0].weeks).toBeNull()
    const dt = plan.phases[0].dayTypes[0]
    expect(dt.meals.map(m => m.name)).toEqual(DEFAULT_MEALS)
    expect(Object.values(plan.phases[0].week)).toEqual(Array(7).fill(dt.id))
  })
  it('ensureMine is idempotent', () => {
    const { n, planId } = fresh()
    expect(ensureMine(n, TODAY, MON)).toBe(planId)
    expect(n.plans).toHaveLength(1)
  })
  it('repairs a broken nutrition key', () => {
    const s = { nutrition: { foods: 'x', plans: null } }
    const n = ensureNutrition(s)
    expect(n).toEqual(nutritionDefault())
    expect(s.nutrition).toBe(n)
  })
})

describe('foods', () => {
  it('cleans and clamps values', () => {
    expect(cleanFood({ name: '  Oats ', kcal: 389, protein: 16.9, carbs: 66.3, fat: 6.9 })).toMatchObject({ name: 'Oats', kcal: 389, source: 'manual' })
    expect(cleanFood({ name: 'X', kcal: 5000, protein: -3, carbs: 'a', fat: 120 })).toMatchObject({ kcal: 900, protein: 0, carbs: null, fat: 100 })
    expect(cleanFood({ name: '   ' })).toBeNull()
  })
  it('clamps grams to a whole number 1–5000', () => {
    expect(clampGrams(0)).toBe(1)
    expect(clampGrams(99999)).toBe(5000)
    expect(clampGrams(12.6)).toBe(13)
    expect(clampGrams('abc')).toBe(100)
  })
  it('deleting a used food removes its items everywhere', () => {
    const { n, planId } = fresh()
    const ref = firstRef(n, planId)
    const f = addFood(n, { name: 'Rice', kcal: 130, protein: 2.7, carbs: 28, fat: 0.3 })
    const meal = at(n, ref).dayType.meals[1]
    addItem(n, { ...ref, mealId: meal.id }, f, 250)
    const other = addPlan(n, { name: 'Anna', copyFrom: planId, today: TODAY, ws: MON })
    expect(foodUsage(n, f)).toBe(2)
    deleteFood(n, f)
    expect(n.foods).toHaveLength(0)
    expect(foodUsage(n, f)).toBe(0)
    expect(n.plans.find(p => p.id === other).phases[0].dayTypes[0].meals[1].items).toEqual([])
  })
  it('updates a food in place', () => {
    const { n } = fresh()
    const f = addFood(n, { name: 'Rice', kcal: 130 })
    updateFood(n, f, { kcal: 129, name: 'White rice' })
    expect(n.foods[0]).toMatchObject({ id: f, name: 'White rice', kcal: 129 })
  })
})

describe('plans', () => {
  it('duplicates with fresh ids and keeps food references', () => {
    const { n, planId } = fresh()
    const copy = addPlan(n, { name: 'Anna – cut', copyFrom: planId, today: TODAY, ws: MON })
    const a = n.plans[0], b = n.plans.find(p => p.id === copy)
    expect(b.name).toBe('Anna – cut')
    expect(b.phases[0].id).not.toBe(a.phases[0].id)
    expect(b.phases[0].dayTypes[0].id).not.toBe(a.phases[0].dayTypes[0].id)
    expect(Object.values(b.phases[0].week)[0]).toBe(b.phases[0].dayTypes[0].id)
  })
  it('never deletes my plan', () => {
    const { n, planId } = fresh()
    expect(deletePlan(n, planId)).toBe(false)
    const other = addPlan(n, { name: 'Ben', today: TODAY, ws: MON })
    expect(deletePlan(n, other)).toBe(true)
    expect(n.plans).toHaveLength(1)
  })
  it('renames, sets the start to its week start, and sets after-last', () => {
    const { n, planId } = fresh()
    renamePlan(n, planId, '  Me  ')
    setPlanStart(n, planId, '2026-11-05', MON)
    setAfterLast(n, planId, 'restart')
    setAfterLast(n, planId, 'nonsense')
    expect(n.plans[0]).toMatchObject({ name: 'Me', start: '2026-11-02', afterLast: 'restart' })
  })
})

describe('phases', () => {
  it('adding a phase gives the previous repeating phase a length', () => {
    const { n, planId } = fresh()
    const id = addPhase(n, planId, {})
    const [p1, p2] = n.plans[0].phases
    expect(p1.weeks).toBe(4)
    expect(p2.id).toBe(id)
    expect(p2.weeks).toBeNull()
  })
  it('duplicates a phase with its day types and week', () => {
    const { n, planId } = fresh()
    const ref = firstRef(n, planId)
    setTarget(n, ref, { kcal: 2200 })
    const id = addPhase(n, planId, { copyFrom: ref.phaseId })
    const p2 = n.plans[0].phases.find(p => p.id === id)
    expect(p2.dayTypes[0].target).toEqual({ kcal: 2200 })
    expect(p2.week['1']).toBe(p2.dayTypes[0].id)
  })
  it('only the last phase may repeat', () => {
    const { n, planId } = fresh()
    addPhase(n, planId, {})
    const [p1, p2] = n.plans[0].phases
    expect(setPhaseWeeks(n, { planId, phaseId: p1.id }, null)).toBe(false)
    expect(setPhaseWeeks(n, { planId, phaseId: p1.id }, 500)).toBe(true)
    expect(p1.weeks).toBe(104)
    expect(setPhaseWeeks(n, { planId, phaseId: p2.id }, 6)).toBe(true)
    expect(setPhaseWeeks(n, { planId, phaseId: p2.id }, null)).toBe(true)
  })
  it('moving a repeating phase away from the end gives it a length', () => {
    const { n, planId } = fresh()
    addPhase(n, planId, {})
    const last = n.plans[0].phases[1]
    movePhase(n, { planId, phaseId: last.id }, -1)
    expect(n.plans[0].phases[0].id).toBe(last.id)
    expect(n.plans[0].phases[0].weeks).toBe(4)
  })
  it('keeps at least one phase, and repeat only on the last after a delete', () => {
    const { n, planId } = fresh()
    const only = n.plans[0].phases[0].id
    expect(deletePhase(n, { planId, phaseId: only })).toBe(false)
    addPhase(n, planId, {})
    renamePhase(n, { planId, phaseId: only }, 'Cut')
    expect(n.plans[0].phases[0].name).toBe('Cut')
    expect(deletePhase(n, { planId, phaseId: n.plans[0].phases[1].id })).toBe(true)
    expect(n.plans[0].phases).toHaveLength(1)
  })
  it('stops at 12 phases', () => {
    const { n, planId } = fresh()
    for (let i = 0; i < 20; i++) addPhase(n, planId, {})
    expect(n.plans[0].phases).toHaveLength(12)
    expect(addPhase(n, planId, {})).toBeNull()
  })
})

describe('day types', () => {
  it('new day types start from my default meals', () => {
    const { n, planId } = fresh()
    const ref = firstRef(n, planId)
    n.defaultMeals = ['Meal 1', 'Meal 2']
    const id = addDayType(n, ref, { name: 'Rest day' })
    expect(at(n, { ...ref, dayTypeId: id }).dayType.meals.map(m => m.name)).toEqual(['Meal 1', 'Meal 2'])
  })
  it('assigns weekdays and reports usage', () => {
    const { n, planId } = fresh()
    const ref = firstRef(n, planId)
    const rest = addDayType(n, ref, { name: 'Rest day' })
    assignDay(n, ref, 2, rest)
    assignDay(n, ref, 5, rest)
    const phase = at(n, ref).phase
    expect(dayTypeUsage(phase, rest)).toEqual([2, 5])
    expect(dayTypeUsage(phase, ref.dayTypeId)).toEqual([0, 1, 3, 4, 6])
  })
  it('deleting a used day type moves its weekdays to the replacement', () => {
    const { n, planId } = fresh()
    const ref = firstRef(n, planId)
    const rest = addDayType(n, ref, { name: 'Rest day' })
    assignDay(n, ref, 2, rest)
    expect(deleteDayType(n, { ...ref, dayTypeId: rest }, ref.dayTypeId)).toBe(true)
    expect(at(n, ref).phase.week['2']).toBe(ref.dayTypeId)
  })
  it('never deletes the last day type', () => {
    const { n, planId } = fresh()
    expect(deleteDayType(n, firstRef(n, planId), null)).toBe(false)
  })
  it('makes one weekday separate without touching the others', () => {
    const { n, planId } = fresh()
    const ref = firstRef(n, planId)
    const f = addFood(n, { name: 'Oats', kcal: 389, protein: 17, carbs: 66, fat: 7 })
    addItem(n, { ...ref, mealId: at(n, ref).dayType.meals[0].id }, f, 80)
    const id = makeDaySeparate(n, ref, 4, 'Thursday')
    const phase = at(n, ref).phase
    expect(phase.week['4']).toBe(id)
    expect(phase.week['1']).toBe(ref.dayTypeId)
    const sep = phase.dayTypes.find(d => d.id === id)
    expect(sep.name).toBe('Thursday')
    expect(sep.meals[0].items[0].foodId).toBe(f)
  })
  it('sets, clears and copies targets', () => {
    const { n, planId } = fresh()
    const ref = firstRef(n, planId)
    const rest = addDayType(n, ref, { name: 'Rest day' })
    setTarget(n, ref, { kcal: 2400.4, protein: 180, carbs: -1, fat: null })
    expect(at(n, ref).dayType.target).toEqual({ kcal: 2400, protein: 180 })
    applyTargetToAll(n, ref)
    expect(at(n, { ...ref, dayTypeId: rest }).dayType.target).toEqual({ kcal: 2400, protein: 180 })
    setTarget(n, ref, null)
    expect(at(n, ref).dayType.target).toBeUndefined()
  })
})

describe('meals and items', () => {
  it('inserts a meal at any position, also with none left', () => {
    const { n, planId } = fresh()
    const ref = firstRef(n, planId)
    insertMeal(n, ref, 1, 'Snack')
    expect(at(n, ref).dayType.meals.map(m => m.name)).toEqual(['Breakfast', 'Snack', 'Lunch', 'Snack', 'Dinner'])
    for (const m of [...at(n, ref).dayType.meals]) deleteMeal(n, { ...ref, mealId: m.id })
    expect(at(n, ref).dayType.meals).toEqual([])
    insertMeal(n, ref, 0, 'Meal 1')
    expect(at(n, ref).dayType.meals.map(m => m.name)).toEqual(['Meal 1'])
  })
  it('renames, moves and keeps a move inside the list', () => {
    const { n, planId } = fresh()
    const ref = firstRef(n, planId)
    const [b] = at(n, ref).dayType.meals
    renameMeal(n, { ...ref, mealId: b.id }, 'Early breakfast')
    moveMeal(n, { ...ref, mealId: b.id }, -1)
    moveMeal(n, { ...ref, mealId: b.id }, 1)
    expect(at(n, ref).dayType.meals.map(m => m.name)).toEqual(['Lunch', 'Early breakfast', 'Snack', 'Dinner'])
  })
  it('uses a day type’s meals as the default layout', () => {
    const { n, planId } = fresh()
    const ref = firstRef(n, planId)
    insertMeal(n, ref, 1, 'Second breakfast')
    useAsDefaultMeals(n, ref)
    expect(n.defaultMeals).toEqual(['Breakfast', 'Second breakfast', 'Lunch', 'Snack', 'Dinner'])
  })
  it('adds, changes and removes items with clamped grams', () => {
    const { n, planId } = fresh()
    const ref = firstRef(n, planId)
    const f = addFood(n, { name: 'Rice', kcal: 130 })
    const mealRef = { ...ref, mealId: at(n, ref).dayType.meals[1].id }
    const item = addItem(n, mealRef, f, 99999)
    expect(at(n, mealRef).meal.items[0]).toMatchObject({ id: item, foodId: f, grams: 5000 })
    setItemGrams(n, mealRef, item, 180)
    expect(at(n, mealRef).meal.items[0].grams).toBe(180)
    removeItem(n, mealRef, item)
    expect(at(n, mealRef).meal.items).toEqual([])
  })
  it('refuses an item for an unknown food', () => {
    const { n, planId } = fresh()
    const ref = firstRef(n, planId)
    expect(addItem(n, { ...ref, mealId: at(n, ref).dayType.meals[0].id }, 'nope', 100)).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/lib/nutrition-plans.test.js`
Expected: FAIL — cannot resolve `./nutrition-plans.js`.

- [ ] **Step 3: Write the implementation**

```js
// frontend/src/lib/nutrition-plans.js
// Every edit of S.nutrition (fork feature, docs/NUTRITION.md). Like lib/routines.js, each
// function changes the draft the store's update() hands it. Invariants kept here, never in the
// UI: `mine` names an existing plan, a plan has at least one phase and a phase at least one day
// type, every weekday of a phase points at one of its day types, and only the last phase may
// repeat without an end (weeks: null).
import { uid } from './format.js'
import { weekStartDate } from './nutrition-calendar.js'

export const DEFAULT_MEALS = ['Breakfast', 'Lunch', 'Snack', 'Dinner']
export const LIMITS = { grams: [1, 5000], kcal: [0, 900], macro: [0, 100], weeks: [1, 104], phases: 12, dayTypes: 14, meals: 12, items: 40, name: 60, foodName: 80 }
const WEEKDAYS = ['0', '1', '2', '3', '4', '5', '6']
const AFTER = new Set(['stay', 'restart', 'end'])
const NEW_PHASE_WEEKS = 4

const clone = o => JSON.parse(JSON.stringify(o))
const isArr = Array.isArray
const clampNum = (v, [lo, hi]) => {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v
  return typeof n === 'number' && Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : null
}
export const cleanName = (s, max = LIMITS.name) => String(s ?? '').trim().slice(0, max)
export function clampGrams(g) {
  const n = clampNum(g, LIMITS.grams)
  return n == null ? 100 : Math.round(n)
}

export function cleanFood(raw) {
  const name = cleanName(raw?.name, LIMITS.foodName)
  if (!name) return null
  const out = {
    id: raw.id || uid(), name,
    kcal: clampNum(raw.kcal, LIMITS.kcal),
    protein: clampNum(raw.protein, LIMITS.macro),
    carbs: clampNum(raw.carbs, LIMITS.macro),
    fat: clampNum(raw.fat, LIMITS.macro),
    source: ['off', 'manual', 'import'].includes(raw.source) ? raw.source : 'manual',
  }
  if (raw.barcode) out.barcode = String(raw.barcode).slice(0, 32)
  return out
}

export const nutritionDefault = () => ({ foods: [], defaultMeals: [...DEFAULT_MEALS], plans: [], mine: null })

export function ensureNutrition(s) {
  const n = s.nutrition
  if (!n || typeof n !== 'object' || !isArr(n.foods) || !isArr(n.plans)) { s.nutrition = nutritionDefault(); return s.nutrition }
  if (!isArr(n.defaultMeals)) n.defaultMeals = [...DEFAULT_MEALS]
  return n
}

const newMeal = name => ({ id: uid(), name: cleanName(name) || 'Meal', items: [] })
const newDayType = (n, name) => ({ id: uid(), name: cleanName(name) || 'Day 1', meals: (n.defaultMeals || DEFAULT_MEALS).slice(0, LIMITS.meals).map(newMeal) })
function newPhase(n, name) {
  const dt = newDayType(n, 'Day 1')
  return { id: uid(), name: cleanName(name) || 'Phase 1', weeks: null, dayTypes: [dt], week: Object.fromEntries(WEEKDAYS.map(d => [d, dt.id])) }
}

// Fresh ids for everything inside a phase, weekday references remapped. Food ids stay: foods are
// shared by every plan.
function rekeyPhase(p) {
  const out = clone(p)
  out.id = uid()
  const map = {}
  for (const dt of out.dayTypes) { const old = dt.id; dt.id = uid(); map[old] = dt.id; rekeyMeals(dt) }
  for (const d of WEEKDAYS) out.week[d] = map[out.week[d]] || out.dayTypes[0].id
  return out
}
function rekeyMeals(dt) { for (const m of dt.meals) { m.id = uid(); for (const it of m.items) it.id = uid() } }

export function at(n, ref = {}) {
  const plan = n.plans.find(p => p.id === ref.planId)
  const phase = plan?.phases.find(p => p.id === ref.phaseId)
  const dayType = phase?.dayTypes.find(d => d.id === ref.dayTypeId)
  const meal = dayType?.meals.find(m => m.id === ref.mealId)
  return { plan, phase, dayType, meal }
}

/* ------------------------------ plans ------------------------------ */

export function addPlan(n, { name, copyFrom, today, ws }) {
  const src = n.plans.find(p => p.id === copyFrom)
  const plan = src
    ? { ...clone(src), id: uid(), phases: src.phases.map(rekeyPhase) }
    : { id: uid(), start: weekStartDate(today, ws), afterLast: 'stay', phases: [newPhase(n, 'Phase 1')] }
  plan.name = cleanName(name) || (src ? src.name : 'New plan')
  n.plans.push(plan)
  return plan.id
}

export function ensureMine(n, today, ws) {
  if (n.mine && n.plans.some(p => p.id === n.mine)) return n.mine
  n.mine = addPlan(n, { name: 'My plan', today, ws })
  return n.mine
}

export function renamePlan(n, planId, name) { const p = at(n, { planId }).plan; const v = cleanName(name); if (p && v) p.name = v }
export function deletePlan(n, planId) {
  if (planId === n.mine) return false
  const i = n.plans.findIndex(p => p.id === planId)
  if (i < 0) return false
  n.plans.splice(i, 1)
  return true
}
export function setPlanStart(n, planId, iso, ws) { const p = at(n, { planId }).plan; if (p && /^\d{4}-\d{2}-\d{2}$/.test(iso)) p.start = weekStartDate(iso, ws) }
export function setAfterLast(n, planId, v) { const p = at(n, { planId }).plan; if (p && AFTER.has(v)) p.afterLast = v }

/* ------------------------------ phases ------------------------------ */

// Only the last phase may run without an end; anything else that has none gets the default length.
function fixRepeat(plan) { plan.phases.forEach((p, i) => { if (p.weeks == null && i < plan.phases.length - 1) p.weeks = NEW_PHASE_WEEKS }) }

export function addPhase(n, planId, { copyFrom } = {}) {
  const plan = at(n, { planId }).plan
  if (!plan || plan.phases.length >= LIMITS.phases) return null
  const src = plan.phases.find(p => p.id === copyFrom)
  const lastRepeats = plan.phases[plan.phases.length - 1]?.weeks == null
  const phase = src ? rekeyPhase(src) : newPhase(n, 'Phase ' + (plan.phases.length + 1))
  if (src) phase.name = cleanName(src.name + ' (copy)')
  phase.weeks = lastRepeats ? null : NEW_PHASE_WEEKS
  plan.phases.push(phase)
  fixRepeat(plan)
  return phase.id
}
export function renamePhase(n, ref, name) { const p = at(n, ref).phase; const v = cleanName(name); if (p && v) p.name = v }
export function setPhaseWeeks(n, ref, weeks) {
  const { plan, phase } = at(n, ref)
  if (!phase) return false
  if (weeks == null) {
    if (plan.phases[plan.phases.length - 1] !== phase) return false
    phase.weeks = null
    return true
  }
  const w = clampNum(weeks, LIMITS.weeks)
  if (w == null) return false
  phase.weeks = Math.round(w)
  return true
}
export function movePhase(n, ref, dir) {
  const { plan, phase } = at(n, ref)
  if (!phase) return
  const i = plan.phases.indexOf(phase), j = i + dir
  if (j < 0 || j >= plan.phases.length) return
  plan.phases.splice(i, 1)
  plan.phases.splice(j, 0, phase)
  fixRepeat(plan)
}
export function deletePhase(n, ref) {
  const { plan, phase } = at(n, ref)
  if (!phase || plan.phases.length <= 1) return false
  plan.phases.splice(plan.phases.indexOf(phase), 1)
  fixRepeat(plan)
  return true
}

/* ----------------------------- day types ----------------------------- */

export const dayTypeUsage = (phase, dayTypeId) =>
  WEEKDAYS.filter(d => phase.week[d] === dayTypeId).map(Number).sort((a, b) => a - b)

export function addDayType(n, ref, { copyFrom, name } = {}) {
  const { phase } = at(n, ref)
  if (!phase || phase.dayTypes.length >= LIMITS.dayTypes) return null
  const src = phase.dayTypes.find(d => d.id === copyFrom)
  const dt = src ? { ...clone(src), id: uid() } : newDayType(n, name)
  if (src) { rekeyMeals(dt); dt.name = cleanName(name) || cleanName(src.name + ' (copy)') }
  phase.dayTypes.push(dt)
  return dt.id
}
export function renameDayType(n, ref, name) { const d = at(n, ref).dayType; const v = cleanName(name); if (d && v) d.name = v }
export function deleteDayType(n, ref, replacementId) {
  const { phase, dayType } = at(n, ref)
  if (!dayType || phase.dayTypes.length <= 1) return false
  phase.dayTypes.splice(phase.dayTypes.indexOf(dayType), 1)
  const to = phase.dayTypes.find(d => d.id === replacementId) || phase.dayTypes[0]
  for (const d of WEEKDAYS) if (phase.week[d] === dayType.id) phase.week[d] = to.id
  return true
}
export function assignDay(n, ref, weekday, dayTypeId) {
  const { phase } = at(n, ref)
  if (phase && phase.dayTypes.some(d => d.id === dayTypeId)) phase.week[String(weekday)] = dayTypeId
}
export function makeDaySeparate(n, ref, weekday, name) {
  const { phase } = at(n, ref)
  if (!phase) return null
  const id = addDayType(n, ref, { copyFrom: phase.week[String(weekday)], name })
  if (id) phase.week[String(weekday)] = id
  return id
}
export function setTarget(n, ref, target) {
  const { dayType } = at(n, ref)
  if (!dayType) return
  const out = {}
  for (const k of ['kcal', 'protein', 'carbs', 'fat']) {
    const v = clampNum(target?.[k], k === 'kcal' ? [0, 20000] : [0, 2000])
    if (v) out[k] = Math.round(v)
  }
  if (Object.keys(out).length) dayType.target = out
  else delete dayType.target
}
export function applyTargetToAll(n, ref) {
  const { phase, dayType } = at(n, ref)
  if (!dayType) return
  for (const d of phase.dayTypes) {
    if (d === dayType) continue
    if (dayType.target) d.target = clone(dayType.target)
    else delete d.target
  }
}

/* ------------------------------- meals ------------------------------- */

export function insertMeal(n, ref, index, name) {
  const { dayType } = at(n, ref)
  if (!dayType || dayType.meals.length >= LIMITS.meals) return null
  const meal = newMeal(name)
  dayType.meals.splice(Math.max(0, Math.min(index, dayType.meals.length)), 0, meal)
  return meal.id
}
export function renameMeal(n, ref, name) { const m = at(n, ref).meal; const v = cleanName(name); if (m && v) m.name = v }
export function moveMeal(n, ref, dir) {
  const { dayType, meal } = at(n, ref)
  if (!meal) return
  const i = dayType.meals.indexOf(meal), j = i + dir
  if (j < 0 || j >= dayType.meals.length) return
  dayType.meals.splice(i, 1)
  dayType.meals.splice(j, 0, meal)
}
export function deleteMeal(n, ref) { const { dayType, meal } = at(n, ref); if (meal) dayType.meals.splice(dayType.meals.indexOf(meal), 1) }
export function useAsDefaultMeals(n, ref) { const { dayType } = at(n, ref); if (dayType) n.defaultMeals = dayType.meals.map(m => m.name) }

/* ------------------------------- items ------------------------------- */

export function addItem(n, ref, foodId, grams) {
  const { meal } = at(n, ref)
  if (!meal || meal.items.length >= LIMITS.items || !n.foods.some(f => f.id === foodId)) return null
  const item = { id: uid(), foodId, grams: clampGrams(grams) }
  meal.items.push(item)
  return item.id
}
export function setItemGrams(n, ref, itemId, grams) { const it = at(n, ref).meal?.items.find(i => i.id === itemId); if (it) it.grams = clampGrams(grams) }
export function removeItem(n, ref, itemId) { const m = at(n, ref).meal; if (m) m.items = m.items.filter(i => i.id !== itemId) }

/* ------------------------------- foods ------------------------------- */

export function addFood(n, raw) {
  const f = cleanFood({ ...raw, id: undefined })
  if (!f) return null
  n.foods.push(f)
  return f.id
}
export function updateFood(n, foodId, patch) {
  const i = n.foods.findIndex(f => f.id === foodId)
  if (i < 0) return
  const f = cleanFood({ ...n.foods[i], ...patch, id: foodId })
  if (f) n.foods[i] = f
}
function eachItemList(n, fn) {
  for (const p of n.plans) for (const ph of p.phases) for (const dt of ph.dayTypes) for (const m of dt.meals) fn(m)
}
export function foodUsage(n, foodId) { let c = 0; eachItemList(n, m => { c += m.items.filter(i => i.foodId === foodId).length }); return c }
export function deleteFood(n, foodId) {
  n.foods = n.foods.filter(f => f.id !== foodId)
  eachItemList(n, m => { m.items = m.items.filter(i => i.foodId !== foodId) })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/lib/nutrition-plans.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/nutrition-plans.js frontend/src/lib/nutrition-plans.test.js
git commit -m "Nutrition: plans, phases, day types, meals and foods, with their invariants"
```

---

### Task 4: Meal-plan file (`lib/meal-share.js`)

**Files:**
- Create: `frontend/src/lib/meal-share.js`
- Test: `frontend/src/lib/meal-share.test.js`

**Interfaces:**
- Consumes: `cleanFood`, `cleanName`, `clampGrams`, `LIMITS`, `ensureMine` (Task 3); `weekStartDate` (Task 2); `uid`, `t`.
- Produces:
  - `MEAL_FMT = 2`
  - `buildMealBundle(n, planId, today) → bundle`
  - `mealFileName(name) → 'meal-plan-<slug>.json'`
  - `looksLikeMealFile(text) → boolean`
  - `parseMealPlan(raw) → { name, afterLast, phases, foods, counts: { phases, dayTypes, meals, foods } }` — throws `Error` with `.code` `'not-meals'` or `'training-plan'` and a readable `.message`
  - `importMealPlan(n, parsed, { mode: 'replace' | 'new', start, ws, today }) → planId`

- [ ] **Step 1: Write the failing test**

```js
// frontend/src/lib/meal-share.test.js
import { describe, it, expect } from 'vitest'
import { MEAL_FMT, buildMealBundle, mealFileName, looksLikeMealFile, parseMealPlan, importMealPlan } from './meal-share.js'
import { ensureNutrition, ensureMine, addFood, addItem, addPhase, at, setTarget } from './nutrition-plans.js'

const TODAY = '2026-10-15', MON = 1

function coach() {
  const s = {}; const n = ensureNutrition(s); const planId = ensureMine(n, TODAY, MON)
  const plan = n.plans[0], phase = plan.phases[0], dt = phase.dayTypes[0]
  const ref = { planId, phaseId: phase.id, dayTypeId: dt.id }
  const rice = addFood(n, { name: 'Rice', kcal: 130, protein: 2.7, carbs: 28, fat: 0.3 })
  addFood(n, { name: 'Unused', kcal: 1, protein: 0, carbs: 0, fat: 0 })
  addItem(n, { ...ref, mealId: dt.meals[1].id }, rice, 250)
  setTarget(n, ref, { kcal: 2200, protein: 160 })
  addPhase(n, planId, { copyFrom: phase.id })
  plan.name = 'Anna – cut'
  return { n, planId, rice }
}

describe('export', () => {
  it('carries the plan and only the foods it uses, never the start', () => {
    const { n, planId } = coach()
    const b = buildMealBundle(n, planId, TODAY)
    expect(b.opengym_meals).toBe(MEAL_FMT)
    expect(b.exported).toBe(TODAY)
    expect(b.name).toBe('Anna – cut')
    expect(b.start).toBeUndefined()
    expect(b.phases).toHaveLength(2)
    expect(b.foods.map(f => f.name)).toEqual(['Rice'])
    expect(JSON.stringify(b)).not.toMatch(/workouts|bodyweight/)
  })
  it('names the file after the plan', () => {
    expect(mealFileName('Anna – cut / week 1')).toBe('meal-plan-anna-cut-week-1.json')
    expect(mealFileName('')).toBe('meal-plan.json')
  })
})

describe('detect and parse', () => {
  it('recognises a meal-plan file and nothing else', () => {
    expect(looksLikeMealFile(JSON.stringify({ opengym_meals: 2, phases: [] }))).toBe(true)
    expect(looksLikeMealFile(JSON.stringify({ opengym_plan: 1, routines: [] }))).toBe(false)
    expect(looksLikeMealFile('not json')).toBe(false)
  })
  it('round-trips an export', () => {
    const { n, planId } = coach()
    const p = parseMealPlan(JSON.stringify(buildMealBundle(n, planId, TODAY)))
    expect(p.name).toBe('Anna – cut')
    expect(p.counts).toEqual({ phases: 2, dayTypes: 2, meals: 8, foods: 1 })
    expect(p.phases[0].dayTypes[0].target).toEqual({ kcal: 2200, protein: 160 })
  })
  it('refuses broken JSON and foreign files readably', () => {
    expect(() => parseMealPlan('{oops')).toThrow(expect.objectContaining({ code: 'not-meals' }))
    expect(() => parseMealPlan(JSON.stringify({ hello: 1 }))).toThrow(expect.objectContaining({ code: 'not-meals' }))
    expect(() => parseMealPlan(JSON.stringify({ opengym_plan: 1, routines: [] }))).toThrow(expect.objectContaining({ code: 'training-plan' }))
    expect(() => parseMealPlan(JSON.stringify({ opengym_meals: 2, phases: [] }))).toThrow(expect.objectContaining({ code: 'not-meals' }))
  })
  it('repairs and clamps a hand-edited file', () => {
    const raw = {
      opengym_meals: 2, name: 'x'.repeat(200), afterLast: 'whatever',
      phases: [
        { name: 'A', weeks: null, dayTypes: [{ id: 'd1', name: 'Day', meals: [{ name: 'M', items: [{ foodId: 'f1', grams: 99999 }, { foodId: 'missing', grams: 10 }] }] }], week: { '1': 'nope' } },
        { name: 'B', weeks: 999, dayTypes: [], week: {} },
      ],
      foods: [{ id: 'f1', name: 'Rice', kcal: 5000, protein: 2, carbs: 28, fat: 0 }],
    }
    const p = parseMealPlan(JSON.stringify(raw))
    expect(p.name).toHaveLength(60)
    expect(p.afterLast).toBe('stay')
    expect(p.phases[0].weeks).toBe(4)                         // repeat only on the last
    expect(p.phases[1].weeks).toBe(104)
    expect(p.phases[1].dayTypes).toHaveLength(1)               // an empty phase gets a day type
    expect(Object.values(p.phases[0].week)).toEqual(Array(7).fill('d1'))
    expect(p.phases[0].dayTypes[0].meals[0].items).toEqual([{ id: expect.any(String), foodId: 'f1', grams: 5000 }])
    expect(p.foods[0].kcal).toBe(900)
  })
})

describe('import', () => {
  function client() { const s = {}; const n = ensureNutrition(s); ensureMine(n, TODAY, MON); return n }

  it('replaces my plan, keeps my plan id, starts on the chosen week', () => {
    const { n: c, planId } = coach()
    const parsed = parseMealPlan(JSON.stringify(buildMealBundle(c, planId, TODAY)))
    const n = client()
    const mine = n.mine
    const id = importMealPlan(n, parsed, { mode: 'replace', start: '2026-10-22', ws: MON, today: TODAY })
    expect(id).toBe(mine)
    expect(n.plans).toHaveLength(1)
    expect(n.plans[0]).toMatchObject({ id: mine, name: 'Anna – cut', start: '2026-10-19' })
    expect(n.plans[0].phases).toHaveLength(2)
  })
  it('saves as a new plan without touching mine', () => {
    const { n: c, planId } = coach()
    const parsed = parseMealPlan(JSON.stringify(buildMealBundle(c, planId, TODAY)))
    const n = client()
    const before = JSON.stringify(n.plans[0])
    const id = importMealPlan(n, parsed, { mode: 'new', start: TODAY, ws: MON, today: TODAY })
    expect(n.plans).toHaveLength(2)
    expect(id).not.toBe(n.mine)
    expect(JSON.stringify(n.plans[0])).toBe(before)
  })
  it('gives every imported thing a fresh id and remaps references', () => {
    const { n: c, planId } = coach()
    const parsed = parseMealPlan(JSON.stringify(buildMealBundle(c, planId, TODAY)))
    const n = client()
    const id = importMealPlan(n, parsed, { mode: 'new', start: TODAY, ws: MON, today: TODAY })
    const plan = n.plans.find(p => p.id === id), phase = plan.phases[0]
    expect(phase.id).not.toBe(c.plans[0].phases[0].id)
    expect(phase.dayTypes.map(d => d.id)).toContain(phase.week['1'])
    const item = phase.dayTypes[0].meals[1].items[0]
    expect(n.foods.find(f => f.id === item.foodId).name).toBe('Rice')
  })
  it('merges foods: same name and values reused, same name different values marked', () => {
    const { n: c, planId } = coach()
    const parsed = parseMealPlan(JSON.stringify(buildMealBundle(c, planId, TODAY)))
    const n = client()
    const same = addFood(n, { name: 'rice ', kcal: 130, protein: 2.7, carbs: 28, fat: 0.3 })
    importMealPlan(n, parsed, { mode: 'new', start: TODAY, ws: MON, today: TODAY })
    expect(n.foods).toHaveLength(1)
    expect(n.foods[0].id).toBe(same)

    const n2 = client()
    addFood(n2, { name: 'Rice', kcal: 120, protein: 2, carbs: 27, fat: 0.2 })
    importMealPlan(n2, parsed, { mode: 'new', start: TODAY, ws: MON, today: TODAY })
    expect(n2.foods.map(f => f.name)).toEqual(['Rice', 'Rice (imported)'])
    expect(n2.foods[1].source).toBe('import')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/lib/meal-share.test.js`
Expected: FAIL — cannot resolve `./meal-share.js`.

- [ ] **Step 3: Write the implementation**

```js
// frontend/src/lib/meal-share.js
// The meal-plan file a coach sends a client (fork feature, docs/NUTRITION.md). One plan per file
// with all its phases and only the foods it uses; never a start date (the client picks one),
// workouts, weigh-ins or settings. Import trusts nothing in the file: every number is clamped,
// every weekday that points nowhere is repaired, and every id is replaced.
import { uid } from './format.js'
import { t } from './i18n-core.js'
import { cleanFood, cleanName, clampGrams, LIMITS, ensureMine } from './nutrition-plans.js'
import { weekStartDate } from './nutrition-calendar.js'

export const MEAL_FMT = 2
const WEEKDAYS = ['0', '1', '2', '3', '4', '5', '6']
const AFTER = new Set(['stay', 'restart', 'end'])
const fail = (code, message) => Object.assign(new Error(message), { code })
const clone = o => JSON.parse(JSON.stringify(o))

export function buildMealBundle(n, planId, today) {
  const plan = n.plans.find(p => p.id === planId)
  const used = new Set()
  for (const ph of plan.phases) for (const dt of ph.dayTypes) for (const m of dt.meals) for (const i of m.items) used.add(i.foodId)
  return {
    opengym_meals: MEAL_FMT, exported: today, name: plan.name, afterLast: plan.afterLast,
    phases: clone(plan.phases),
    foods: n.foods.filter(f => used.has(f.id)).map(({ id, name, kcal, protein, carbs, fat, barcode }) =>
      ({ id, name, kcal, protein, carbs, fat, ...(barcode ? { barcode } : {}) })),
  }
}

export function mealFileName(name) {
  const slug = String(name || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return slug ? `meal-plan-${slug}.json` : 'meal-plan.json'
}

export function looksLikeMealFile(text) {
  try { const d = JSON.parse(text); return !!d && typeof d === 'object' && d.opengym_meals != null } catch { return false }
}

function parseDayType(raw, foodIds) {
  const meals = (Array.isArray(raw?.meals) ? raw.meals : []).slice(0, LIMITS.meals).map(m => ({
    id: uid(), name: cleanName(m?.name) || 'Meal',
    items: (Array.isArray(m?.items) ? m.items : [])
      .filter(i => foodIds.has(i?.foodId)).slice(0, LIMITS.items)
      .map(i => ({ id: uid(), foodId: i.foodId, grams: clampGrams(i.grams) })),
  }))
  const out = { id: raw?.id != null ? String(raw.id) : uid(), name: cleanName(raw?.name) || 'Day', meals }
  const target = {}
  for (const k of ['kcal', 'protein', 'carbs', 'fat']) {
    const v = Number(raw?.target?.[k])
    if (Number.isFinite(v) && v > 0) target[k] = Math.round(Math.min(v, k === 'kcal' ? 20000 : 2000))
  }
  if (Object.keys(target).length) out.target = target
  return out
}

export function parseMealPlan(raw) {
  let d
  try { d = typeof raw === 'string' ? JSON.parse(raw) : raw } catch { throw fail('not-meals', t('This isn’t an openGym meal-plan file.')) }
  if (d?.opengym_plan != null && d?.opengym_meals == null) throw fail('training-plan', t('This is a training plan. Import it from the Plan menu instead.'))
  if (!d || typeof d !== 'object' || d.opengym_meals == null || !Array.isArray(d.phases) || !d.phases.length) {
    throw fail('not-meals', t('This isn’t an openGym meal-plan file.'))
  }
  if (Number(d.opengym_meals) > MEAL_FMT) throw fail('not-meals', t('This meal plan was made by a newer version of openGym.'))
  const foods = (Array.isArray(d.foods) ? d.foods : []).map(f => cleanFood({ ...f, source: 'import' })).filter(Boolean)
  const foodIds = new Set(foods.map(f => f.id))
  const phases = d.phases.slice(0, LIMITS.phases).map((p, idx) => {
    let dayTypes = (Array.isArray(p?.dayTypes) ? p.dayTypes : []).slice(0, LIMITS.dayTypes).map(dt => parseDayType(dt, foodIds))
    if (!dayTypes.length) dayTypes = [parseDayType({ name: 'Day 1' }, foodIds)]
    const ids = new Set(dayTypes.map(x => x.id))
    const week = Object.fromEntries(WEEKDAYS.map(k => [k, ids.has(String(p?.week?.[k])) ? String(p.week[k]) : dayTypes[0].id]))
    const w = Number(p?.weeks)
    const weeks = p?.weeks == null ? null : Number.isFinite(w) ? Math.round(Math.min(LIMITS.weeks[1], Math.max(LIMITS.weeks[0], w))) : 4
    return { id: uid(), name: cleanName(p?.name) || `Phase ${idx + 1}`, weeks, dayTypes, week }
  })
  phases.forEach((p, i) => { if (p.weeks == null && i < phases.length - 1) p.weeks = 4 })
  const counts = {
    phases: phases.length,
    dayTypes: phases.reduce((a, p) => a + p.dayTypes.length, 0),
    meals: phases.reduce((a, p) => a + p.dayTypes.reduce((b, dt) => b + dt.meals.length, 0), 0),
    foods: foods.length,
  }
  return {
    name: cleanName(d.name) || t('Imported meal plan'),
    afterLast: AFTER.has(d.afterLast) ? d.afterLast : 'stay',
    phases, foods, counts,
  }
}

const sameValues = (a, b) => ['kcal', 'protein', 'carbs', 'fat'].every(k => (a[k] ?? null) === (b[k] ?? null))
const key = s => String(s).trim().toLowerCase()

function mergeFoods(n, foods) {
  const map = {}
  for (const f of foods) {
    const twin = n.foods.find(x => key(x.name) === key(f.name) && sameValues(x, f))
    if (twin) { map[f.id] = twin.id; continue }
    const clash = n.foods.some(x => key(x.name) === key(f.name))
    const added = cleanFood({ ...f, id: undefined, name: clash ? `${f.name} (imported)` : f.name, source: 'import' })
    added.id = uid()
    n.foods.push(added)
    map[f.id] = added.id
  }
  return map
}

export function importMealPlan(n, parsed, { mode, start, ws, today }) {
  const foodMap = mergeFoods(n, parsed.foods)
  const phases = parsed.phases.map(p => {
    const dtMap = {}
    const dayTypes = p.dayTypes.map(dt => {
      const id = uid(); dtMap[dt.id] = id
      return { ...clone(dt), id, meals: dt.meals.map(m => ({ id: uid(), name: m.name, items: m.items.map(i => ({ id: uid(), foodId: foodMap[i.foodId], grams: i.grams })) })) }
    })
    return { id: uid(), name: p.name, weeks: p.weeks, dayTypes, week: Object.fromEntries(WEEKDAYS.map(k => [k, dtMap[p.week[k]]])) }
  })
  const plan = { name: parsed.name, start: weekStartDate(start || today, ws), afterLast: parsed.afterLast, phases }
  if (mode === 'replace') {
    const mine = ensureMine(n, today, ws)
    const i = n.plans.findIndex(p => p.id === mine)
    n.plans[i] = { id: mine, ...plan }
    return mine
  }
  const id = uid()
  n.plans.push({ id, ...plan })
  return id
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/lib/meal-share.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/meal-share.js frontend/src/lib/meal-share.test.js
git commit -m "Nutrition: the meal-plan file, its checks and the food merge on import"
```

---

### Task 5: State default, sync pins and the food-search client

**Files:**
- Modify: `frontend/src/store/useStore.js` (the `DEF` object, lines 85–210)
- Create: `frontend/src/lib/food-search.js`
- Test: `frontend/src/lib/nutrition-sync.test.js`, `frontend/src/lib/food-search.test.js`, `api/test/nutrition-keep.test.js`

**Interfaces:**
- Consumes: `nutritionDefault` (Task 3); `mergeStates`, `stampEdits` from `lib/sync-merge.js`; `keepUnknown` from `api/sync-stamps.js`; `api` from `lib/api.js`.
- Produces: `DEF.nutrition`; `foodSearchAvailable(config, user) → boolean`; `searchFoods(q, lang) → Promise<results[]>` (rejects with `.status` from the API).

- [ ] **Step 1: Write the failing tests**

```js
// frontend/src/lib/nutrition-sync.test.js
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
```

```js
// frontend/src/lib/food-search.test.js
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
```

```js
// api/test/nutrition-keep.test.js
// An older app (no `nutrition` in its state) saving over the server must not drop it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { keepUnknown } from '../sync-stamps.js';

test('keepUnknown puts nutrition back when a save leaves it out', () => {
  const cur = { workouts: [], routines: [], nutrition: { foods: [{ id: 'f' }], plans: [], mine: null, defaultMeals: [] } };
  const next = { workouts: [], routines: [] };
  const out = keepUnknown(cur, next);
  assert.deepEqual(out.nutrition, cur.nutrition);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npx vitest run src/lib/nutrition-sync.test.js src/lib/food-search.test.js`
Expected: FAIL — `DEF.nutrition` is undefined; `./food-search.js` cannot be resolved.

Run: `cd api && node --test test/nutrition-keep.test.js`
Expected: PASS already (this pins existing behaviour). If it FAILS, stop: `keepUnknown` does not keep unknown keys the way the spec assumed; report back before continuing — approach A depends on it.

The `mergeStates` "later edit wins" test may also pass or fail depending on how `stampEdits` records the key. If it fails *after* Step 3, read `stampEdits`/`applyEdits` in `frontend/src/lib/sync-merge.js` (lines ~605–700) and adjust only the **test setup** (how the two copies are stamped) to mirror what `useStore.update` does (`stampChange` then `stampEdits`); never change sync code.

- [ ] **Step 3: Write the implementation**

In `frontend/src/store/useStore.js`, add the import next to the other `lib` imports:

```js
import { nutritionDefault } from '../lib/nutrition-plans.js'
```

and inside `DEF`, after `gymCards: [],`:

```js
  // Meal plans and foods (fork feature, docs/NUTRITION.md). One key, synced as a whole.
  nutrition: nutritionDefault(),
```

Create the client:

```js
// frontend/src/lib/food-search.js
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npx vitest run src/lib/nutrition-sync.test.js src/lib/food-search.test.js`
Expected: PASS.

Run the whole frontend suite, since `DEF` changed: `cd frontend && npx vitest run`
Expected: all pass. A snapshot or `toEqual(DEF…)` test that lists every key may need `nutrition` added — add it to that test's expectation only.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/store/useStore.js frontend/src/lib/food-search.js frontend/src/lib/food-search.test.js frontend/src/lib/nutrition-sync.test.js api/test/nutrition-keep.test.js
git commit -m "Nutrition: the state key, pinned sync behaviour and the search client"
```

---
### Task 6: Food search on the API

**Files:**
- Create: `api/food-search.js`
- Modify: `api/server.js` (import near line 28; constants after `const AUTH_BURST` at ~900; the sweep at ~907; `'GET /api/config'` at ~1867; a route next to `'GET /api/health'` at ~1838)
- Modify: `api/openapi.yaml` (new path after `/api/config`)
- Modify: `api/Dockerfile`, `api/Dockerfile.railway` (COPY line)
- Test: `api/test/food-search.test.js`, `api/test/food-search-route.test.js`

**Interfaces:**
- Produces: `normalizeHit(hit, lang) → { name, brand, barcode, per100: { kcal, protein, carbs, fat }, complete } | null`; `createFoodSearch({ url, origin, fetchImpl, timeoutMs, ttlMs, max, now }) → { search(q, lang) → Promise<{ status, body }> }`; route `GET /api/food/search`; `/api/config` key `food_search: true`.

- [ ] **Step 1: Write the failing unit test**

```js
// api/test/food-search.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeHit, createFoodSearch } from '../food-search.js';

test('normalizeHit: names, brands, kJ, strings, gaps', () => {
  assert.deepEqual(normalizeHit({ code: '123', product_name: 'Chicken breast', brands: ['Tesco'], nutriments: { 'energy-kcal_100g': 106, proteins_100g: 24, carbohydrates_100g: 0, fat_100g: 1.1 } }, 'en'), {
    name: 'Chicken breast', brand: 'Tesco', barcode: '123', per100: { kcal: 106, protein: 24, carbs: 0, fat: 1.1 }, complete: true,
  });
  const kj = normalizeHit({ product_name: 'Oats', nutriments: { 'energy-kj_100g': 1628, proteins_100g: '16.9', carbohydrates_100g: '66,3', fat_100g: 6.9 } }, 'en');
  assert.equal(kj.per100.kcal, 389.1);
  assert.equal(kj.per100.protein, 16.9);
  assert.equal(kj.per100.carbs, 66.3);
  const local = normalizeHit({ product_name: 'Banana', product_name_de: 'Banane', brands: 'A, B', nutriments: {} }, 'de');
  assert.equal(local.name, 'Banane');
  assert.equal(local.brand, 'A, B');
  assert.equal(local.complete, false);
  assert.deepEqual(local.per100, { kcal: null, protein: null, carbs: null, fat: null });
  assert.equal(normalizeHit({ product_name: '  ', nutriments: {} }, 'en'), null);
  assert.equal(normalizeHit(null, 'en'), null);
  assert.equal(normalizeHit({ product_name: 'Neg', nutriments: { fat_100g: -2 } }, 'en').per100.fat, null);
});

const okFetch = (hits, calls = []) => async (url, opts) => { calls.push({ url: String(url), opts }); return { ok: true, json: async () => ({ hits }) }; };

test('search: asks for 20 results in the language with a User-Agent', async () => {
  const calls = [];
  const fs = createFoodSearch({ url: 'http://off.test/search', origin: 'https://gym.example', fetchImpl: okFetch([{ product_name: 'Rice', nutriments: {} }], calls) });
  const r = await fs.search('rice', 'fr');
  assert.equal(r.status, 200);
  assert.equal(r.body.results[0].name, 'Rice');
  const u = new URL(calls[0].url);
  assert.equal(u.searchParams.get('q'), 'rice');
  assert.equal(u.searchParams.get('langs'), 'fr');
  assert.equal(u.searchParams.get('page_size'), '20');
  assert.match(u.searchParams.get('fields'), /product_name_fr/);
  assert.equal(calls[0].opts.headers['User-Agent'], 'openGym (https://gym.example)');
});

test('search: upstream errors, bad bodies and timeouts are 502', async () => {
  const bad = { status: 502, body: { error: 'food-search-unavailable' } };
  assert.deepEqual(await createFoodSearch({ fetchImpl: async () => ({ ok: false, json: async () => ({}) }) }).search('rice', 'en'), bad);
  assert.deepEqual(await createFoodSearch({ fetchImpl: async () => { throw new Error('down'); } }).search('rice', 'en'), bad);
  assert.deepEqual(await createFoodSearch({ fetchImpl: async () => ({ ok: true, json: async () => ({ nope: 1 }) }) }).search('rice', 'en'), bad);
  const hang = (u, o) => new Promise((_, rej) => o.signal.addEventListener('abort', () => rej(new Error('aborted'))));
  assert.deepEqual(await createFoodSearch({ fetchImpl: hang, timeoutMs: 20 }).search('rice', 'en'), bad);
});

test('search: caches by language and normalized query, expires, and stays bounded', async () => {
  let t = 0; const calls = [];
  const fs = createFoodSearch({ fetchImpl: okFetch([], calls), now: () => t, ttlMs: 1000, max: 2 });
  await fs.search('Brown  Rice', 'en');
  await fs.search('brown rice', 'en');
  assert.equal(calls.length, 1);
  await fs.search('brown rice', 'de');
  assert.equal(calls.length, 2);
  t = 1001;
  await fs.search('brown rice', 'en');      // expired: asks again
  assert.equal(calls.length, 3);
  await fs.search('oats', 'en');            // cache full (max 2): evicts the oldest, 'de'
  await fs.search('brown rice', 'de');
  assert.equal(calls.length, 5);
  const failing = createFoodSearch({ fetchImpl: async () => { calls.push(1); throw new Error('x'); } });
  await failing.search('rice', 'en');
  await failing.search('rice', 'en');
  assert.equal(calls.length, 7);             // failures are never cached
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd api && node --test test/food-search.test.js`
Expected: FAIL — `Cannot find module '../food-search.js'`.

- [ ] **Step 3: Write the module**

```js
// api/food-search.js
// Open Food Facts search for the meal planner (fork feature, docs/NUTRITION.md). The browser
// cannot call search.openfoodfacts.org itself (no CORS), and a phone should not talk to a third
// party on its own, so the API asks on the user's behalf: only the typed words leave the server,
// never who typed them. Answers are cached a day; failures never are.
const DEFAULT_URL = 'https://search.openfoodfacts.org/search';
const FIELDS = ['code', 'product_name', 'product_name_en', 'brands', 'nutriments'];
const UNAVAILABLE = () => ({ status: 502, body: { error: 'food-search-unavailable' } });

const toNum = v => {
  const n = typeof v === 'string' ? parseFloat(v.replace(',', '.')) : v;
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : null;
};
const r1 = n => (n == null ? null : Math.round(n * 10) / 10);

export function normalizeHit(h, lang) {
  if (!h || typeof h !== 'object') return null;
  const name = String(h[`product_name_${lang}`] || h.product_name || h.product_name_en || '').trim();
  if (!name) return null;
  const brand = (Array.isArray(h.brands) ? h.brands.join(', ') : String(h.brands || '')).trim();
  const nu = h.nutriments && typeof h.nutriments === 'object' ? h.nutriments : {};
  let kcal = toNum(nu['energy-kcal_100g']);
  if (kcal == null) {
    const kj = toNum(nu['energy-kj_100g']) ?? toNum(nu.energy_100g);   // energy_100g is kJ in OFF
    if (kj != null) kcal = kj / 4.184;
  }
  const per100 = { kcal: r1(kcal), protein: r1(toNum(nu.proteins_100g)), carbs: r1(toNum(nu.carbohydrates_100g)), fat: r1(toNum(nu.fat_100g)) };
  return {
    name: name.slice(0, 80), brand: brand.slice(0, 60), barcode: h.code ? String(h.code).slice(0, 32) : '',
    per100, complete: Object.values(per100).every(v => v != null),
  };
}

export function createFoodSearch({ url = DEFAULT_URL, origin = '', fetchImpl = globalThis.fetch, timeoutMs = 8000, ttlMs = 86400000, max = 500, now = Date.now } = {}) {
  const cache = new Map();
  return {
    async search(q, lang) {
      const key = lang + '|' + q.toLowerCase().replace(/\s+/g, ' ').trim();
      const hit = cache.get(key);
      if (hit && now() - hit.at < ttlMs) return { status: 200, body: hit.body };
      const u = new URL(url);
      u.searchParams.set('q', q);
      u.searchParams.set('langs', lang);
      u.searchParams.set('page_size', '20');
      u.searchParams.set('fields', [...FIELDS, `product_name_${lang}`].join(','));
      let json;
      try {
        const res = await fetchImpl(u, {
          headers: { 'User-Agent': `openGym (${origin})`, Accept: 'application/json' },
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (!res.ok) return UNAVAILABLE();
        json = await res.json();
      } catch { return UNAVAILABLE(); }
      if (!Array.isArray(json?.hits)) return UNAVAILABLE();
      const body = { results: json.hits.map(h => normalizeHit(h, lang)).filter(Boolean) };
      cache.delete(key);
      if (cache.size >= max) cache.delete(cache.keys().next().value);
      cache.set(key, { at: now(), body });
      return { status: 200, body };
    },
  };
}
```

- [ ] **Step 4: Run the unit test**

Run: `cd api && node --test test/food-search.test.js`
Expected: PASS.

- [ ] **Step 5: Write the failing route test**

```js
// api/test/food-search-route.test.js
// The route inside the real server.js, against a fake Open Food Facts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { boundPort } from './helpers.mjs';

const API = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SECRET = crypto.randomBytes(32).toString('hex');
const mint = uid => { const p = `${uid}:${Date.now() + 86400000}:0`; return p + '.' + crypto.createHmac('sha256', SECRET).update(p).digest('base64url'); };

async function fakeOff(t) {
  const srv = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ hits: [{ code: '1', product_name: 'Rice', nutriments: { 'energy-kcal_100g': 130, proteins_100g: 2.7, carbohydrates_100g: 28, fat_100g: 0.3 } }] }));
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  t.after(() => srv.close());
  return `http://127.0.0.1:${srv.address().port}/search`;
}

async function startServer(t, env) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-food-'));
  fs.writeFileSync(path.join(dataDir, 'secret'), SECRET, { mode: 0o600 });
  fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify({ users: [{ id: 'u1', name: 'One', created: new Date().toISOString() }], creds: [], subs: [], invites: [] }));
  const child = spawn(process.execPath, ['server.js'], {
    cwd: API, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: '0', DATA_DIR: dataDir, ORIGIN: 'http://localhost:8080', RP_ID: 'localhost', ...env },
  });
  let log = '';
  child.stdout.on('data', d => log += d); child.stderr.on('data', d => log += d);
  t.after(() => { child.kill('SIGKILL'); fs.rmSync(dataDir, { recursive: true, force: true }); });
  return `http://127.0.0.1:${await boundPort(child, () => log)}`;
}

const signedIn = { Cookie: `gymsid=${mint('u1')}` };

test('GET /api/food/search: auth, validation, results, config flag, rate limit', async t => {
  const api = await startServer(t, { FOOD_SEARCH_URL: await fakeOff(t) });
  assert.equal((await fetch(`${api}/api/food/search?q=rice`)).status, 401);
  assert.equal((await fetch(`${api}/api/food/search?q=r`, { headers: signedIn })).status, 400);
  assert.equal((await fetch(`${api}/api/food/search?q=${'x'.repeat(81)}`, { headers: signedIn })).status, 400);
  const r = await fetch(`${api}/api/food/search?q=rice&lang=en`, { headers: signedIn });
  assert.equal(r.status, 200);
  assert.deepEqual((await r.json()).results[0].per100, { kcal: 130, protein: 2.7, carbs: 28, fat: 0.3 });
  assert.equal((await (await fetch(`${api}/api/config`)).json()).food_search, true);
  let last;
  for (let i = 0; i < 30; i++) last = await fetch(`${api}/api/food/search?q=rice`, { headers: signedIn });
  assert.equal(last.status, 429);                  // the 31st counted search in the minute
  assert.ok(Number(last.headers.get('retry-after')) >= 1);
});

test('FOOD_SEARCH=0 switches the route and the config flag off', async t => {
  const api = await startServer(t, { FOOD_SEARCH: '0' });
  assert.equal((await fetch(`${api}/api/food/search?q=rice`, { headers: signedIn })).status, 404);
  assert.equal((await (await fetch(`${api}/api/config`)).json()).food_search, undefined);
});
```

Validation runs **before** the budget is taken, so the two 400 answers do not count: one good search plus the loop's 30 make the 31st, which is refused.

- [ ] **Step 6: Run it to verify it fails**

Run: `cd api && node --test test/food-search-route.test.js`
Expected: FAIL — the first assertion gets 404 instead of 401 (route not registered).

- [ ] **Step 7: Wire the route into `api/server.js`**

Add the import after `import { createBackoff, createWindow } from './rate-limit.js';`:

```js
import { createFoodSearch } from './food-search.js';
```

After `const AUTH_BURST = createWindow({ max: 60, windowMs: 60000 });`:

```js
// Meal plans' food search (fork feature, docs/NUTRITION.md): on unless FOOD_SEARCH=0. Its own
// budget, per user, so a search box used quickly can never spend the sign-in budget.
const FOOD_SEARCH_ON = process.env.FOOD_SEARCH !== '0';
const FOOD = createFoodSearch({ url: process.env.FOOD_SEARCH_URL || undefined, origin: ORIGIN });
const FOOD_BURST = createWindow({ max: 30, windowMs: 60000 });
```

Change the sweep line (~907) to:

```js
setInterval(() => { AUTH_BURST.sweep(); ADDR_FAILS.sweep(); ACCOUNT_FAILS.sweep(); FOOD_BURST.sweep(); }, 60000).unref();
```

In `'GET /api/config'`, after the `...(MEDIA_ON ? { media: mediaConfig(MEDIA_LIMITS) } : {}),` line:

```js
      // Public like media: its absence is how the app knows to offer manual entry only.
      ...(FOOD_SEARCH_ON ? { food_search: true } : {}),
```

After the `'GET /api/health'` route:

```js
  'GET /api/food/search': async (req, res) => {
    if (!FOOD_SEARCH_ON) return json(res, 404, { error: 'not found' });
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    const p = new URL(req.url, 'http://x').searchParams;
    const q = (p.get('q') || '').trim();
    if (q.length < 2 || q.length > 80) return json(res, 400, { error: 'q must be 2 to 80 characters' });
    const lang = /^[a-z]{2}/.test(p.get('lang') || '') ? p.get('lang').slice(0, 2) : 'en';
    const wait = FOOD_BURST.take(user.id);
    if (wait) return json(res, 429, { error: 'too many searches' }, { 'Retry-After': String(wait) });
    const r = await FOOD.search(q, lang);
    json(res, r.status, r.body);
  },
```

- [ ] **Step 8: Document the route in `api/openapi.yaml`**

Insert after the whole `/api/config:` block (before the next top-level path). The spec is OpenAPI 3.1, so `type: [number, 'null']` is valid:

```yaml
  /api/food/search:
    get:
      tags: [meta]
      operationId: foodSearch
      summary: Search Open Food Facts for a food (fork feature)
      description: >-
        Asks Open Food Facts' search on the user's behalf for the meal planner and returns
        values per 100 g. Signed-in users only, 30 searches a minute each; answers are cached
        for 24 hours. Off (404) when the server runs with `FOOD_SEARCH=0`, and `/api/config`
        then has no `food_search`. Only the search words leave the server.
      parameters:
        - name: q
          in: query
          required: true
          schema: { type: string, minLength: 2, maxLength: 80 }
        - name: lang
          in: query
          required: false
          schema: { type: string }
          description: Two-letter language code for product names; default `en`.
      responses:
        '200':
          description: Matching foods; a product without a name is left out.
          content:
            application/json:
              schema:
                type: object
                properties:
                  results:
                    type: array
                    items:
                      type: object
                      properties:
                        name: { type: string }
                        brand: { type: string }
                        barcode: { type: string }
                        per100:
                          type: object
                          properties:
                            kcal: { type: [number, 'null'] }
                            protein: { type: [number, 'null'] }
                            carbs: { type: [number, 'null'] }
                            fat: { type: [number, 'null'] }
                        complete: { type: boolean, description: False when any of the four values is unknown. }
        '400': { description: '`q` is missing, shorter than 2 or longer than 80 characters.' }
        '401': { $ref: '#/components/responses/Unauthorized' }
        '404': { description: Food search is switched off on this server. }
        '429': { $ref: '#/components/responses/TooManyRequests' }
        '502': { description: Open Food Facts did not answer in time, or answered with an error. }
```

In the `/api/config:` description, add one line at its end: `` `food_search` is there unless the server runs with `FOOD_SEARCH=0` (fork feature). ``

- [ ] **Step 9: Add the module to both images**

In `api/Dockerfile` **and** `api/Dockerfile.railway`, the `COPY server.js …` line becomes:

```dockerfile
COPY server.js push-messages.js nudge.js nudge-copy.js verify-error.js password.js rate-limit.js passkeys-store.js device-link.js media.js queue.js sync-stamps.js durable.js food-search.js ./
```

- [ ] **Step 10: Run the API suite**

Run: `cd api && npm test`
Expected: all pass, including `openapi-routes.test.js` (route documented) and both food-search files.

- [ ] **Step 11: Commit**

```bash
git add api/food-search.js api/server.js api/openapi.yaml api/Dockerfile api/Dockerfile.railway api/test/food-search.test.js api/test/food-search-route.test.js
git commit -m "API: food search through Open Food Facts for meal plans (FOOD_SEARCH=0 turns it off)"
```

---

### Task 7: Food picker and food form

**Files:**
- Create: `frontend/src/components/FoodPicker.jsx`
- Create: `frontend/src/meals.css` (whole file below; Task 8 relies on it)

**Interfaces:**
- Consumes: `ensureNutrition`, `addFood`, `clampGrams` (Task 3); `macroKcal`, `kcalMismatch`, `roundKcal`, `itemTotals` (Task 1); `foodSearchAvailable`, `searchFoods` (Task 5); `useStore`, `useUI`, `t`, `getLang`, `Button`, `TextField`, `NumberField`.
- Produces:
  - `editNutrition(fn) → fn's return value` — runs `fn(n)` inside `useStore.getState().update`
  - `FoodForm({ initial, onSave(food), onCancel, saveText })`
  - `foodPickerSheet({ onPicked(foodId, grams) })`
  - `gramsSheet({ foodId, grams, onSave(grams), onRemove })`

The UI is checked by hand in Task 10; the logic it calls is unit-tested in Tasks 1–5.

- [ ] **Step 1: Create the styles**

```css
/* frontend/src/meals.css — the Meals view of Plan and its sheets (fork feature, docs/NUTRITION.md) */
.meals{display:flex;flex-direction:column;gap:12px;margin-top:12px}
.ml-plans,.ml-days{display:flex;gap:6px;overflow-x:auto;padding-bottom:2px}
.ml-week{display:flex;align-items:center;gap:8px}
.ml-week .grow{flex:1;text-align:center}
.ml-day{display:flex;flex-direction:column;align-items:center;min-width:44px;padding:6px 4px;border-radius:12px;background:var(--surface-2);border:0;color:inherit}
.ml-day.on{background:var(--acc);color:var(--on-acc)}
.ml-day .dt{font-size:10px;opacity:.75;max-width:52px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ml-sum{display:grid;gap:8px}
.ml-row{display:grid;grid-template-columns:70px 1fr auto;gap:8px;align-items:center;font-size:14px}
.ml-bar{height:6px;border-radius:3px;background:var(--surface-2);overflow:hidden}
.ml-bar>i{display:block;height:100%;background:currentColor;opacity:.4}
.ml-row.ok .ml-bar>i{background:var(--green);opacity:1}
.ml-row.under .ml-bar>i{background:var(--orange);opacity:1}
.ml-row.over .ml-bar>i{background:var(--red);opacity:1}
.ml-meal-h{display:flex;align-items:baseline;gap:8px}
.ml-meal-h .grow{flex:1;font-weight:600}
.ml-item{display:flex;gap:8px;padding:8px 0;border-top:1px solid rgba(127,127,127,.2)}
.ml-item .grow{flex:1}
.ml-insert{align-self:center;border:0;background:none;color:var(--acc);font-size:20px;line-height:1;padding:0 12px}
.ml-note{font-size:13px}
.food-form{display:flex;flex-direction:column;gap:10px}
.ff-row{display:grid;grid-template-columns:1fr 120px;gap:8px;align-items:center}
.ff-warn{color:var(--orange)}
.fp-list{max-height:40vh;overflow-y:auto}
.fp-res{display:flex;gap:8px;padding:8px 0;border-top:1px solid rgba(127,127,127,.2)}
.fp-res .grow{flex:1}
```

- [ ] **Step 2: Create the picker**

```jsx
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

export function editNutrition(fn) {
  let out
  useStore.getState().update(s => { out = fn(ensureNutrition(s)) })
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
    <Button variant="primary" onClick={() => onSave(clampGrams(g))}>{saveText || t('Add')}</Button>
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
      {mine.map(f => <div key={f.id} className="fp-res" onClick={() => setStep({ kind: 'grams', foodId: f.id })}>
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
        {remote.results.map((r, i) => <div key={i} className="fp-res"
          onClick={() => setStep({ kind: 'form', initial: { name: r.brand ? `${r.name} (${r.brand})` : r.name, ...r.per100, source: 'off', barcode: r.barcode } })}>
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
```

- [ ] **Step 3: Build to catch mistakes**

Run: `cd frontend && npx vite build --outDir /tmp/og-build --emptyOutDir`
Expected: builds without errors (the picker is not reachable from the UI until Task 8; this only checks it compiles).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/FoodPicker.jsx frontend/src/meals.css
git commit -m "Nutrition: food picker with Open Food Facts search and the food form"
```

---

### Task 8: The Meals view in Plan

**Files:**
- Create: `frontend/src/components/MealSheets.jsx`
- Create: `frontend/src/views/Meals.jsx`
- Modify: `frontend/src/views/Plan.jsx` (`readView` at ~33–36; imports; the `Segmented` and render at ~169–172)
- Test: `frontend/src/views/Plan.meals.test.jsx`

**Interfaces:**
- Consumes: Tasks 1–3 and 7; `menuSheet`, `confirmSheet` from `sheets.jsx`; `weekOrder`, `weekStartOf`, `todayISO`, `DAYS`, `DAYN`, `fmtDate` from `lib/format.js`; `Icon`.
- Produces: in `MealSheets.jsx` — `nameSheet({ title, value, onSave })`, `targetsSheet(ref)`, `phasesSheet(planId)`, `dayTypesSheet(ref)`, `myFoodsSheet()`; default export `Meals({ S, update, onImport, onExport })` in `views/Meals.jsx`.

- [ ] **Step 1: Check the icon names**

Run: `grep -oE "^\s+[a-zA-Z]+:" frontend/src/components/Icon.jsx | tr -d ' :' | sort | tr '\n' ' '`

The code below uses `plus`, `edit`, `trash`, `calendar`, `list`, `share`, `download`, `copy`, `arrowUp`, `arrowDown`, `chevronLeft`, `chevronRight`, `chevronDown`, `more`. For any name not in the output, use the existing glyph with the same meaning (e.g. `pencil` for `edit`, `dots` for `more`) throughout Tasks 8–9. A `menuSheet` item also works with no icon.

Also check `export function Button` in `frontend/src/components/ui.jsx` for a `size` prop; if it has none, drop `size="sm"` everywhere below.

- [ ] **Step 2: Write the failing view test**

First look at how an existing Plan view test sets up the store and renders (`ls frontend/src/views | grep -i '^Plan.*test'`, open one). Use the same setup; the test below assumes a plain `useStore.setState({ S })` and a `MemoryRouter`.

```jsx
// frontend/src/views/Plan.meals.test.jsx
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { useStore, DEF } from '../store/useStore.js'
import Plan, { PLAN_VIEW_KEY } from './Plan.jsx'

describe('Plan → Meals', () => {
  beforeEach(() => {
    localStorage.setItem(PLAN_VIEW_KEY, 'meals')
    useStore.setState({ S: structuredClone(DEF) })
  })
  it('opens on Meals, creates my plan and shows the default meals', () => {
    render(<MemoryRouter><Plan /></MemoryRouter>)
    for (const name of ['Breakfast', 'Lunch', 'Snack', 'Dinner']) expect(screen.getAllByText(name).length).toBeGreaterThan(0)
    const n = useStore.getState().S.nutrition
    expect(n.mine).toBeTruthy()
    expect(n.plans).toHaveLength(1)
  })
  it('switching views still remembers the choice', () => {
    render(<MemoryRouter><Plan /></MemoryRouter>)
    fireEvent.click(screen.getByText('Routines'))
    expect(localStorage.getItem(PLAN_VIEW_KEY)).toBe('routines')
  })
})
```

If the existing Plan tests seed the store with a helper (for `user`, `config`, or a mocked `update`), use that helper; keep the two tests' assertions.

- [ ] **Step 3: Run it to verify it fails**

Run: `cd frontend && npx vitest run src/views/Plan.meals.test.jsx`
Expected: FAIL — no "Breakfast" (Plan falls back to Schedule; there is no Meals view).

- [ ] **Step 4: Create the sheets**

```jsx
// frontend/src/components/MealSheets.jsx
// The sheets behind the Meals view (fork feature, docs/NUTRITION.md). Each reads the live store
// itself, so an edit inside a sheet shows at once, and writes only through lib/nutrition-plans.js.
import { useState } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
import { DAYS, fmtDate, weekStartOf } from '../lib/format.js'
import { Button, TextField, NumberField, Switch, Segmented } from './ui.jsx'
import { menuSheet, confirmSheet } from '../sheets.jsx'
import { FoodForm, editNutrition } from './FoodPicker.jsx'
import {
  at, setTarget, applyTargetToAll, addPhase, renamePhase, setPhaseWeeks, movePhase, deletePhase,
  setPlanStart, setAfterLast, addDayType, renameDayType, deleteDayType, dayTypeUsage, useAsDefaultMeals,
  updateFood, deleteFood, foodUsage,
} from '../lib/nutrition-plans.js'
import { macroKcal, roundKcal } from '../lib/nutrition.js'
import { phaseDates } from '../lib/nutrition-calendar.js'

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
```

Sheets opened with `open(() => <X />)` stay open while the user edits and are dismissed by swiping or tapping outside, like the existing settings sheets.

- [ ] **Step 5: Create the view**

```jsx
// frontend/src/views/Meals.jsx
// Plan → Meals (fork feature, docs/NUTRITION.md). Shows one week of the selected meal plan: the
// phase and day type each date falls on, each day's meals, and the day's totals against its
// day type's targets. All edits go through lib/nutrition-plans.js.
import { useEffect, useMemo, useState } from 'react'
import { t } from '../lib/i18n.js'
import { DAYS, DAYN, weekOrder, weekStartOf, todayISO, fmtDate } from '../lib/format.js'
import { Button } from '../components/ui.jsx'
import Icon from '../components/Icon.jsx'
import { menuSheet, confirmSheet } from '../sheets.jsx'
import { foodPickerSheet, gramsSheet, editNutrition } from '../components/FoodPicker.jsx'
import { nameSheet, targetsSheet, phasesSheet, dayTypesSheet, myFoodsSheet } from '../components/MealSheets.jsx'
import {
  ensureNutrition, ensureMine, addPlan, renamePlan, deletePlan, assignDay, makeDaySeparate,
  insertMeal, renameMeal, moveMeal, deleteMeal, addItem, setItemGrams, removeItem,
} from '../lib/nutrition-plans.js'
import { foodIndex, itemTotals, mealTotals, dayTotals, dayStatus, roundKcal, roundGrams, MACROS } from '../lib/nutrition.js'
import { addDays, weekStartDate, weekdayOf, dayFor } from '../lib/nutrition-calendar.js'
import '../meals.css'

const LABEL = () => ({ kcal: t('kcal'), protein: t('Protein'), carbs: t('Carbs'), fat: t('Fat') })

export default function Meals({ S, update, onImport, onExport }) {
  const ws = weekStartOf(S)
  const today = todayISO()
  const n = S.nutrition
  const [planId, setPlanId] = useState(null)
  const [weekOff, setWeekOff] = useState(0)
  const [weekday, setWeekday] = useState(() => weekdayOf(today))
  const foods = useMemo(() => foodIndex(n?.foods), [n?.foods])
  const ready = !!(n?.mine && n.plans?.some(p => p.id === n.mine))
  useEffect(() => { if (!ready) update(s => { ensureMine(ensureNutrition(s), today, ws) }) }, [ready])
  if (!ready) return null

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
      onClick: () => nameSheet({ title: t('Name the plan'), value: '', onSave: v => setPlanId(editNutrition(x => addPlan(x, { name: v, copyFrom: o.from, today, ws }))) }),
    })),
  })
  const planMenu = () => menuSheet({
    title: plan.name,
    sections: [
      { items: [
        { icon: 'plus', label: t('New meal plan'), onClick: newPlan },
        { icon: 'edit', label: t('Rename'), onClick: () => nameSheet({ title: t('Rename meal plan'), value: plan.name, onSave: v => editNutrition(x => renamePlan(x, plan.id, v)) }) },
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
      { icon: 'copy', label: t('Make this day separate'), sub: t('Its own copy, so changes affect only {0}', t(DAYN[weekday])), onClick: () => editNutrition(x => makeDaySeparate(x, ref, weekday, t(DAYN[weekday]))) },
      { icon: 'list', label: t('Edit day types'), onClick: () => dayTypesSheet({ planId: plan.id, phaseId: ref.phaseId }) },
    ],
  })
  const addMealAt = index => nameSheet({ title: t('New meal'), value: t('Snack'), onSave: v => editNutrition(x => insertMeal(x, ref, index, v)) })
  const mealMenu = (m, i, count) => {
    const mref = { ...ref, mealId: m.id }
    menuSheet({
      title: m.name,
      items: [
        { icon: 'edit', label: t('Rename'), onClick: () => nameSheet({ title: t('Rename meal'), value: m.name, onSave: v => editNutrition(x => renameMeal(x, mref, v)) }) },
        i > 0 && { icon: 'arrowUp', label: t('Move up'), onClick: () => editNutrition(x => moveMeal(x, mref, -1)) },
        i < count - 1 && { icon: 'arrowDown', label: t('Move down'), onClick: () => editNutrition(x => moveMeal(x, mref, 1)) },
        { icon: 'trash', label: t('Delete meal'), danger: true, onClick: () => m.items.length
          ? confirmSheet({ title: t('Delete “{0}”?', m.name), message: t('Its {0} foods go with it.', m.items.length), danger: true, confirmText: t('Delete'), onConfirm: () => editNutrition(x => deleteMeal(x, mref)) })
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
      <Summary dayType={day.dayType} foods={foods} onTargets={() => targetsSheet(ref)} />
      {day.dayType.meals.map((m, i) => <MealCard key={m.id} meal={m} foods={foods}
        onInsertBefore={() => addMealAt(i)} onMenu={() => mealMenu(m, i, day.dayType.meals.length)}
        onAdd={() => foodPickerSheet({ onPicked: (foodId, g) => editNutrition(x => addItem(x, { ...ref, mealId: m.id }, foodId, g)) })}
        onItem={it => gramsSheet({
          foodId: it.foodId, grams: it.grams,
          onSave: g => editNutrition(x => setItemGrams(x, { ...ref, mealId: m.id }, it.id, g)),
          onRemove: () => editNutrition(x => removeItem(x, { ...ref, mealId: m.id }, it.id)),
        })} />)}
      <Button variant="tinted" onClick={() => addMealAt(day.dayType.meals.length)}>{t('Add meal')}</Button>
    </>}
  </div>
}

function Summary({ dayType, foods, onTargets }) {
  const tot = dayTotals(dayType, foods)
  const st = dayStatus(tot, dayType.target)
  const L = LABEL()
  const hasTarget = MACROS.some(k => st[k] !== 'none')
  return <div className="card ml-sum">
    {MACROS.map(k => {
      const goal = dayType.target?.[k]
      const have = k === 'kcal' ? roundKcal(tot[k]) : roundGrams(tot[k])
      return <div key={k} className={'ml-row ' + st[k]}>
        <span>{L[k]}</span>
        <div className="ml-bar"><i style={{ width: goal ? Math.min(100, (tot[k] / goal) * 100) + '%' : 0 }} /></div>
        <span>{have}{goal ? ' / ' + goal : ''}</span>
      </div>
    })}
    {tot.incomplete && <div className="small ff-warn">{t('Some foods have missing values, so these totals are too low.')}</div>}
    <Button variant="ghost" onClick={onTargets}>{hasTarget ? t('Edit targets') : t('Set targets')}</Button>
  </div>
}

function MealCard({ meal, foods, onAdd, onItem, onMenu, onInsertBefore }) {
  const tot = mealTotals(meal, foods)
  return <>
    <button className="ml-insert" aria-label={t('Add a meal here')} onClick={onInsertBefore}>+</button>
    <div className="card">
      <div className="ml-meal-h">
        <span className="grow">{meal.name}</span>
        <span className="muted small">{roundKcal(tot.kcal)} kcal · {roundGrams(tot.protein)} g P</span>
        <button className="iconbtn" aria-label={t('Meal options')} onClick={onMenu}><Icon name="more" /></button>
      </div>
      {meal.items.map(it => {
        const f = foods.get(it.foodId)
        const r = itemTotals(f, it.grams)
        return <div key={it.id} className="ml-item" onClick={() => onItem(it)}>
          <span className="grow">{f?.name || t('Deleted food')}</span>
          <span className="muted">{it.grams} g</span>
          <span className="muted">{r.kcal == null ? '?' : roundKcal(r.kcal)} kcal</span>
        </div>
      })}
      <Button variant="ghost" onClick={onAdd}>{t('Add food')}</Button>
    </div>
  </>
}
```

- [ ] **Step 6: Add the segment in `Plan.jsx`**

Add the import after `import { DEMO } from '../lib/demo.js'`:

```jsx
import Meals from './Meals.jsx'
```

Replace `readView`:

```jsx
const readView = () => {
  try { const v = localStorage.getItem(PLAN_VIEW_KEY); return v === 'routines' || v === 'meals' ? v : 'schedule' } catch { return 'schedule' }
}
```

Replace the `Segmented` and the conditional below it:

```jsx
    <Segmented className="plan-views" value={view} onChange={setView}
      options={[{ value: 'schedule', label: t('Schedule') }, { value: 'routines', label: t('Routines') }, { value: 'meals', label: t('Meals') }]} />
    {view === 'meals'
      ? <Meals S={S} update={update} />
      : view === 'routines'
        ? <Routines S={S} update={update} nav={nav} />
        : <Schedule S={S} update={update} nav={nav} mode={mode} />}
```

(Task 9 adds `onImport` / `onExport`.)

- [ ] **Step 7: Run the view test and the whole frontend suite**

Run: `cd frontend && npx vitest run src/views/Plan.meals.test.jsx`
Expected: PASS.

Run: `cd frontend && npx vitest run`
Expected: all pass. An existing Plan test that counts the segments (two) needs that one expectation raised to three; change nothing else.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/components/MealSheets.jsx frontend/src/views/Meals.jsx frontend/src/views/Plan.jsx frontend/src/views/Plan.meals.test.jsx
git commit -m "Nutrition: Plan → Meals with phases, day types, meals and targets"
```

---

### Task 9: Export, import and the wrong-menu hand-off

**Files:**
- Modify: `frontend/src/components/MealSheets.jsx` (append export/import)
- Modify: `frontend/src/views/Plan.jsx` (hidden meal file input, pass `onImport` / `onExport`)
- Modify: `frontend/src/sheets.jsx` (`importPlanFile`, ~line 1913; one import)
- Test: `frontend/src/components/MealSheets.import.test.jsx`

**Interfaces:**
- Consumes: `buildMealBundle`, `mealFileName`, `parseMealPlan`, `importMealPlan`, `looksLikeMealFile` (Task 4); `startOptions` (Task 2); `MOBILE`, `shareExport` from `lib/mobile.js`.
- Produces: `exportMealPlanFile(planId)`, `importMealText(text)` (opens the preview sheet, or toasts the refusal), `importMealFile(file)`.

- [ ] **Step 1: Write the failing test**

```jsx
// frontend/src/components/MealSheets.import.test.jsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useStore, DEF } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { importMealText } from './MealSheets.jsx'

describe('importMealText', () => {
  let toast, openSheet
  beforeEach(() => {
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
```

The code below calls `useUI.getState().toast(...)` and `useUI.getState().openSheet(...)` at call time, so the spies on the state object take effect. If a spy does not intercept (the store returns a fresh object), replace them with `useUI.setState({ toast: vi.fn(), openSheet: vi.fn() })` and read them back with `useUI.getState().toast`.

- [ ] **Step 2: Run it to verify it fails**

Run: `cd frontend && npx vitest run src/components/MealSheets.import.test.jsx`
Expected: FAIL — `importMealText` is not exported.

- [ ] **Step 3: Append export and import to `MealSheets.jsx`**

Change its `../lib/format.js` import to `import { DAYS, fmtDate, weekStartOf, todayISO } from '../lib/format.js'`, and add:

```jsx
import { MOBILE, shareExport } from '../lib/mobile.js'
import { buildMealBundle, mealFileName, parseMealPlan, importMealPlan } from '../lib/meal-share.js'
```

Change the `../lib/nutrition-calendar.js` import to `import { phaseDates, startOptions } from '../lib/nutrition-calendar.js'`.

Append at the end of the file:

```jsx
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
```

- [ ] **Step 4: Hand meal files over from the training import in `sheets.jsx`**

Add next to the plan-share import (line ~32):

```jsx
import { looksLikeMealFile } from './lib/meal-share.js'
```

In `importPlanFile`, make `rd.onload` start with the hand-off, keeping the existing `try`/`catch` lines below it unchanged:

```jsx
  rd.onload = () => {
    // A meal-plan file picked in the training-plan import (fork feature): open the meal import
    // instead of refusing it. Loaded lazily, because MealSheets imports this file.
    if (looksLikeMealFile(rd.result)) { onRead?.(); import('./components/MealSheets.jsx').then(m => m.importMealText(rd.result)); return }
    try { const bundle = parsePlan(rd.result, S().unit || 'kg'); onRead?.(); planImportSheet(bundle) }
```

- [ ] **Step 5: Wire the menu entries in `Plan.jsx`**

Add the import:

```jsx
import { exportMealPlanFile, importMealFile } from '../components/MealSheets.jsx'
```

Inside `Plan()`, next to `const fileRef = useRef(null)`:

```jsx
  const mealFileRef = useRef(null)
```

Next to the existing hidden `<input ref={fileRef} … hidden />`:

```jsx
    <input ref={mealFileRef} type="file" accept="application/json,.json" hidden
      onChange={ev => { const f = ev.target.files[0]; ev.target.value = ''; importMealFile(f) }} />
```

And change the Meals line to pass the handlers:

```jsx
      ? <Meals S={S} update={update} onImport={() => mealFileRef.current?.click()} onExport={exportMealPlanFile} />
```

- [ ] **Step 6: Run the tests**

Run: `cd frontend && npx vitest run src/components/MealSheets.import.test.jsx src/lib/meal-share.test.js`
Expected: PASS.

Run: `cd frontend && npx vitest run`
Expected: all pass (the existing plan-import tests are unaffected: a training file never `looksLikeMealFile`).

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/MealSheets.jsx frontend/src/components/MealSheets.import.test.jsx frontend/src/views/Plan.jsx frontend/src/sheets.jsx
git commit -m "Nutrition: export and import a meal plan; the training import hands meal files over"
```

---

### Task 10: Docs and full verification

**Files:**
- Create: `docs/NUTRITION.md`
- Modify: `.env.example` (one commented block at the end)

- [ ] **Step 1: Write `docs/NUTRITION.md`**

````markdown
# Meal plans (fork feature)

Plan → **Meals** holds weekly meal plans with calorie and macro targets. It plans what to eat;
it does not log what was eaten.

## How a plan is built

- **Foods**: your own list, values per 100 g (kcal, protein, carbs, fat). Add one by hand, or
  search Open Food Facts and check the numbers before saving. Plans refer to your saved copy, so
  a plan never changes because Open Food Facts did. Meals ⋯ → My foods edits them.
- **Day types**: e.g. "Training day" and "Rest day", each with its own meals and targets. Every
  weekday uses one; editing a day type changes every weekday that uses it. "Make this day
  separate" gives one weekday its own copy.
- **Meals**: Breakfast, Lunch, Snack, Dinner to begin with. Add one anywhere with the **+**
  between meals; rename, move or delete any. "Use as my default meals" (⋯ → Day types) sets the
  layout new day types start with.
- **Phases**: a plan runs in phases of a number of weeks (e.g. 6 weeks cut, then 4 weeks
  maintenance) from its start date. The last phase can repeat every week with no end. After the
  last phase a plan stays on it, starts again, or ends. ⋯ → Phases.
- Grams, kcal and grams of macros are used everywhere, also for profiles set to lb.

## Coaches: plans for clients

⋯ → New meal plan keeps a separate draft per client next to your own ("My plan"), empty or as a
copy of another plan. ⋯ → Export meal plan saves the selected plan as `meal-plan-<name>.json`:
the plan and the foods it uses, never workouts, weigh-ins or settings. The client opens
Plan → Meals → ⋯ → Import meal plan, picks when it starts, and replaces their plan or saves it as
a new one. A meal-plan file picked in the training-plan import is recognised and handed over.

## Food search and privacy

Searches go from your server to Open Food Facts (`search.openfoodfacts.org`): only the words
typed and the app language, never who typed them. Signed-in users only, 30 searches a minute
each, answers cached for a day. Phones in local mode (no server) have manual entry only.

Turn the search off with `FOOD_SEARCH=0` on the api service; the app then offers manual entry
only.

## Sync

Meal plans and foods sync between your devices as one piece: if two devices change them before
syncing, the later save wins.
````

- [ ] **Step 2: Mention the switch in `.env.example`**

Append:

```bash
# ── Meal plans: food search (fork feature, docs/NUTRITION.md) ──────────────
# Plan → Meals can search Open Food Facts through this server (only the search
# words leave it). On by default; to offer manual entry only:
#
#   FOOD_SEARCH=0
```

- [ ] **Step 3: Run every suite and the build**

Run: `cd frontend && npx vitest run`
Expected: all pass (the 4,293 existing tests plus the new ones).

Run: `cd api && npm test`
Expected: all pass.

Run: `cd frontend && npx vite build --outDir /tmp/og-build --emptyOutDir`
Expected: builds.

- [ ] **Step 4: Check by hand in the browser**

Start the API (`cd api && DATA_DIR=/tmp/og-data PORT=3000 node server.js`) and the dev server (`cd frontend && npm run dev`) in two terminals; open the printed URL and create a profile. Then check, in order:

1. Plan → Meals shows "This week", the day strip and Breakfast / Lunch / Snack / Dinner.
2. Add food → type "oats" → Search Open Food Facts → pick one → the form is pre-filled → Save → 80 g → Add. The line and the meal header show kcal; the summary moves.
3. Set targets 2,200 kcal / 160 g protein: bars and colours follow.
4. ⋯ → Day types → Add "Rest day"; on Tuesday choose "Rest day": Tuesday shows the default meals, Monday keeps the oats.
5. On Thursday, "Make this day separate", change Thursday: Monday is unchanged.
6. The **+** between Breakfast and Lunch inserts a meal there; delete Dinner.
7. ⋯ → Phases: Repeat off, 2 weeks; Add phase; the arrows two weeks ahead show the second phase's label; set "End" and step past it: "This plan ended on …".
8. ⋯ → New meal plan → Copy of My plan → "Anna": the selector appears; edit Anna; My plan is unchanged.
9. Export Anna; sign in as a second profile; Plan → Meals → ⋯ → Import meal plan → Next week → Replace: the second profile shows Anna's plan from next week, foods included.
10. Pick the meal file in Plan → (share icon) → Import a plan file: the meal import opens.

Then repeat 1–3 on the Android emulator against the same dev server.

Fix anything that does not match in the owning task's file, with a test where it is logic.

- [ ] **Step 5: Commit**

```bash
git add docs/NUTRITION.md .env.example
git commit -m "Docs: meal plans, the coach workflow and the food-search privacy note"
```

- [ ] **Step 6: Hand back for deployment**

Do not deploy. Report to the user: the branch, the commits, the suite results and the manual-check outcome. Deploying (the API to Railway first, then `scripts/deploy-vercel.sh`) waits for their go-ahead.
