# Meal plans & nutrition targets — design

Status: approved in conversation 2026-10-12, revised 2026-10-13 (phases, day types, meal layout);
awaiting spec review.
Scope: the `nhegedus/fitbook` fork only (not proposed upstream). Branch: `feature/nutrition`.

## 1. Goal

Let every user plan what they eat, with calorie and macro targets, reuse the same day across
several weekdays, and run a plan in phases over weeks. Let a coach draft meal plans for clients
and hand them over as a file.

What counts as done:

- A user can build a plan from foods with per-100 g values, assign day types to weekdays, and see
  for any date the planned kcal / protein / carbs / fat against that day's target.
- A plan can run in phases (e.g. 6 weeks cut, then 4 weeks maintenance) and the app shows the right
  phase for each date.
- A coach can keep several named client drafts next to their own plan, export one as a file, and
  the client imports it with a start date and sees the same plan.

## 2. Decisions taken

| Question | Decision |
|---|---|
| Who writes plans | Everyone their own; a coach also drafts client plans |
| Planning or logging | **Planning only.** Nothing records what was actually eaten |
| Macros | Counted from the plan's foods, compared with targets |
| Food data | Open Food Facts search, proxied by the API, copied into a personal foods list |
| Coach → client | A file (export / import), like training plans; no server-side coach link |
| Reusing a day | **Day types** ("Training day", "Rest day") assigned to weekdays, linked; a weekday can be made separate |
| Targets | Per day type (so every weekday shows its day type's target) |
| Repeating / periods | **Phases** of N weeks in order; the last may repeat with no end; after the last phase: stay / start again / end |
| Meals | Standard Breakfast, Lunch, Snack, Dinner; insert anywhere, rename, move, delete; a personal default layout |
| Client drafts | Several named plans per account; the user's own plan is one of them and is never overwritten by drafting |
| Sync | Approach A: one new top-level state key, synced last-writer-wins as a whole |
| Units | Grams, kcal and grams of macros always, also for lb profiles |
| Languages | English only for now; untranslated strings fall back to English |

Out of scope (possible later): intake logging, barcode scanning, recipes built from foods, meal
photos, print / PDF of a meal plan, a server-side coach→client link, finer sync merging
(approach B), translations, a fork-built APK.

## 3. Data

A new top-level key in the persisted state `S`, defaulted in `DEF` (`frontend/src/store/useStore.js`).
Older profiles get the default through the existing `Object.assign(clone(DEF), saved)` overlay; no
migration is needed.

```js
nutrition: {
  foods: [                                 // shared by every plan; values per 100 g
    { id, name, kcal, protein, carbs, fat,    // numbers or null when unknown
      source: 'off' | 'manual' | 'import', barcode?: string }
  ],
  defaultMeals: ['Breakfast', 'Lunch', 'Snack', 'Dinner'],   // layout for new day types
  plans: [
    { id, name: 'My plan',
      start: '2026-10-13',                 // ISO date; first day of the week it starts in
      afterLast: 'stay' | 'restart' | 'end',
      phases: [
        { id, name: 'Cut',
          weeks: 6,                         // integer ≥ 1, or null = repeat every week, no end
          dayTypes: [
            { id, name: 'Training day',
              target?: { kcal, protein, carbs, fat },          // each optional
              meals: [ { id, name, items: [ { id, foodId, grams } ] } ] }
          ],
          week: { '1': '<dayTypeId>', '2': '…', …, '0': '…' }  // getDay(): 1 = Monday … 0 = Sunday
        }
      ] }
  ],
  mine: '<id of the user\'s own plan>'
}
```

Rules:

- The foods list is the single source of a food's values. Items reference foods by id and store
  only grams; correcting a food updates every plan that uses it.
- A new plan has one phase (`weeks: null`), one day type "Day 1" built from `defaultMeals`, on all
  seven weekdays, `afterLast: 'stay'`, and `start` = the first day of the current week.
- `weeks: null` (the "Repeat every week" checkbox) is allowed only on the last phase; when a phase
  is added after it, it gets a length (default 4).
- Every weekday of a phase points at one of that phase's day types. Deleting a day type that is in
  use asks which day type those weekdays should use instead; the last day type of a phase cannot be
  deleted.
- "Make this day separate" duplicates the weekday's day type as "<Weekday>" and points only that
  weekday at the copy.
- Meals: any number, including none, in any order; a meal may be empty.
- `mine` always points at an existing plan. It is created on first use ("My plan") and cannot be
  deleted. Every other plan is a draft.
- Deleting a food that is used asks first and removes its items from every plan.
- Grams: 1–5000, integers. Per-100 g values: 0–900 kcal, 0–100 g for each macro; `null` = unknown.
  Phase length 1–104 weeks; at most 12 phases, 14 day types per phase, 12 meals per day type.

## 4. Logic — pure, unit-tested helpers

`frontend/src/lib/nutrition.js` (numbers):

- `itemTotals(food, grams)` = each value × grams / 100; `null` stays `null` and marks the result
  incomplete.
- `mealTotals`, `dayTotals` sum items; a total is incomplete if any item is.
- `dayStatus(totals, target)` per value: `ok` within ±5 % of the target, `under`, `over`, or `none`
  when there is no target.
- `macroKcal({protein, carbs, fat})` = 4·P + 4·C + 9·F. A food whose stated kcal differs from it by
  more than 15 % and more than 20 kcal is flagged "values don't add up".
- Full precision internally; rounding (kcal to 1; grams to 1 decimal under 10 g, else whole) only in
  display helpers.

`frontend/src/lib/nutrition-calendar.js` (dates):

- `phaseFor(plan, date, weekStart)` → `{ phase, index, weekOfPhase, weeksInPhase }` or
  `{ ended: true, endedOn }` or `{ notStarted: true, startsOn }`. Weeks are counted from `start`
  using the user's week-start setting. After the last phase: `stay` keeps the last phase,
  `restart` cycles from phase 1, `end` returns `ended`. A `weeks: null` phase never ends.
- `dayFor(plan, date, weekStart)` → `{ phase, dayType }` for that date.
- `phaseDates(plan, weekStart)` → start and end date per phase, for the Phases list.
- `startOptions(today, weekStart)` → this week / next week first days, for import.

`frontend/src/lib/nutrition-plans.js` (edits, all pure `(state, args) → state`):

- Plans: create (defaults above), duplicate, rename, delete (not `mine`), ensure `mine`, set start,
  set after-last.
- Phases: add (empty or duplicate of the previous), duplicate, rename, set weeks / repeat, move,
  delete (not the last remaining).
- Day types: add, duplicate, rename, delete (with replacement), assign to weekday, make weekday
  separate, set / clear target, apply target to all day types of the phase.
- Meals: insert at position (from `defaultMeals` names or custom), rename, move, delete; "use as my
  default meals" copies a day type's meal names into `defaultMeals`.
- Items: add, change grams, remove. Foods: add / update / delete (with usage count).

The store calls these through its existing `update(s => …)`.

## 5. Screens

**Plan → Schedule | Routines | Meals.** A third value in the existing `Segmented` control in
`Plan.jsx`, remembered with the others in `gym_plan_view`. The Meals view is `views/Meals.jsx`.

- **Plan selector** at the top, shown only when there is more than one plan: the user's plan first,
  drafts below, "+ New meal plan" (empty or duplicate of any plan). The ⋯ menu per plan: rename,
  duplicate, delete (not for `mine`).
- **Week header**: ‹ week › arrows and the phase label ("Cut · week 3 of 6"); "Starts on …" or
  "Plan ended on …" when outside the plan.
- **Day strip** Mon…Sun following the week-start setting, opening on today, each day labelled
  with its day type.
- **Day type row**: "Training day ▾" — choose another day type for this weekday in this phase,
  "Make this day separate", "Edit day types".
- **Day summary card**: kcal, protein, carbs, fat as planned / target with a bar; green `ok`, amber
  `under`, red `over`; without a target, totals and a "Set targets" link; "incomplete" when a food
  lacks values. A note that edits apply to every weekday using this day type when it is used on
  more than one.
- **Meal cards**: header with name, kcal and protein; lines with food name, grams, kcal; tap a line
  to change grams or remove; "+ Add food"; ⋯ rename, move up / down, delete. A **+** between meals
  (and after the last) inserts a meal at that position.
- **Targets sheet** (per day type): four numbers, macro-implied kcal shown beside kcal, "Apply to all
  day types in this phase", "Clear".
- **Phases sheet** (⋯ → Phases): plan start date, the phases in order with weeks and dates, the
  current one marked; add, duplicate, rename, set weeks or "Repeat every week" (last phase only),
  reorder, delete; "After the last phase: stay / start again / end".
- **Day types sheet** (⋯ → Day types): the current phase's day types with the weekdays using them;
  add, duplicate, rename, delete (asks for the replacement), "Use as my default meals".
- **Food picker sheet** (`components/FoodPicker.jsx`):
  1. Search box filtering the user's foods instantly (offline).
  2. "Search Open Food Facts" below when the server offers it (signed in or paired, and
     `/api/config` reports `foodSearch: true`): name, brand, kcal and protein per 100 g;
     incomplete results marked.
  3. Picking a result opens the food form pre-filled; save adds it to the foods list and then asks
     for grams. "Add manually" opens the same form empty.
- **My foods** (⋯ → My foods): list with usage counts, edit, delete.
- ⋯ also holds Export meal plan / Import meal plan.

## 6. Food search — API

New module `api/food-search.js`, registered in `server.js`'s route table as
`GET /api/food/search?q=<term>&lang=<code>`.

- Requires a session (`readSession`), 401 otherwise. `q` 2–80 characters after trimming, 400
  otherwise.
- Calls `https://search.openfoodfacts.org/search` (overridable by `FOOD_SEARCH_URL` for tests) with
  `q`, `langs`, `page_size=20` and only the needed fields, with Node's built-in `fetch`, an 8 s
  timeout and `User-Agent: openGym (<ORIGIN>)`. No new dependency.
- Response `200 { results: [ { name, brand, barcode, per100: { kcal, protein, carbs, fat },
  complete } ] }`. kcal from kJ ÷ 4.184 when only kJ is given; nameless products dropped;
  `complete` false when any value is missing.
- Errors: upstream non-2xx, timeout or unparsable body → `502 { error: 'food-search-unavailable' }`;
  more than 30 searches per minute per user → `429` via `api/rate-limit.js`.
- In-memory cache keyed by `lang + normalized q`, 24 h, at most 500 entries.
- `FOOD_SEARCH=0` disables the route (404) and `/api/config` reports `foodSearch: false`; the app
  then hides the search. Default on.
- Added to `api/openapi.yaml` (the API suite fails on undocumented routes), to the COPY list in
  `api/Dockerfile` and `api/Dockerfile.railway`.

Phone app: when paired, searches go through the server like all its calls; in local mode the search
is hidden and manual entry remains.

Privacy: the typed search term goes from the server to Open Food Facts, never the user's identity.
Documented in `docs/NUTRITION.md` with the `FOOD_SEARCH` switch.

## 7. Sharing — `frontend/src/lib/meal-share.js` (pure, unit-tested)

File format, one plan per file, with all its phases:

```json
{ "opengym_meals": 2, "exported": "2026-10-13", "name": "Anna – cut & maintain",
  "afterLast": "stay",
  "phases": [ { "name": "Cut", "weeks": 6, "dayTypes": [], "week": {} } ],
  "foods": [ { "id": "…", "name": "…", "kcal": 0, "protein": 0, "carbs": 0, "fat": 0 } ] }
```

- Export: the selected plan (without its `start`) plus only the foods it uses; no workouts,
  weigh-ins or settings. File name `meal-plan-<plan name>.json`. Web downloads it; the phone uses
  the same share path the training-plan export uses.
- Parse: rejects anything without `opengym_meals: 2` or with malformed phases / day types / foods,
  with a clear message; clamps numbers and counts to the ranges in §3; repairs weekdays pointing at
  missing day types (first day type of the phase); drops items pointing at missing foods.
- Import preview: name, phases with weeks, day types per phase with kcal vs target, foods count.
  The user picks **when it starts** (this week, next week, or a date) and then:
  - **Replace my meal plan** (confirms when `mine` has any food in it)
  - **Save as a new plan** (a new draft; nothing existing changes)
- Food merge: a food with the same name (case-insensitive, trimmed) and the same four values is
  reused; same name with different values is added as "<name> (imported)"; otherwise added. All
  imported ids are fresh.
- Wrong-menu safety: the existing training-plan import in `sheets.jsx` checks for `opengym_meals`
  before `parsePlan` and hands the file to the meal import instead (about three lines). The meal
  import likewise recognises a training-plan file and says where it belongs.

## 8. Sync

`nutrition` is a top-level key unknown to the merge code, so it is synced last-writer-wins as one
value through `edited['nutrition']` (`frontend/src/lib/sync-merge.js` `stampEdits` / `applyEdits`),
and `api/sync-stamps.js` `keepUnknown` puts it back when an older, non-stamping app saves without
it. Known trade-off: two devices editing different parts before syncing keep only the later save.
No sync code changes; tests pin the behaviour so an upstream change to it is noticed. The whole key
stays far below the 5 MB state limit at the caps in §3.

## 9. Tests

- `lib/nutrition.test.js` — item / meal / day totals, null handling, status thresholds,
  macro-kcal and the mismatch flag, display rounding.
- `lib/nutrition-calendar.test.js` — phase and day for dates before the start, inside each phase,
  on phase boundaries, after the last phase with `stay` / `restart` / `end`, a `weeks: null` last
  phase, Monday and Sunday week starts, a start date mid-week normalized to its week.
- `lib/nutrition-plans.test.js` — plan defaults and create / duplicate / delete (not `mine`); phases
  add / duplicate / move / delete, repeat only on the last; day types add / delete with replacement
  / assign / make separate; targets and apply-to-all; meal insert at position / move / delete /
  zero meals; default meals; food delete with usage.
- `lib/meal-share.test.js` — export carries only used foods and no start, round trip, start date
  applied on import, replace / save as new, food merge rules, repair of broken weekday references,
  malformed and foreign files, training vs meal file detection.
- Sync — `nutrition` survives `mergeStates` between two copies (later edit wins) and the server's
  `keepUnknown` path.
- `api/test/food-search.test.js` — stub upstream server; 401, 400, normalization (kJ → kcal,
  incomplete, nameless dropped), 502 on timeout / error, 429, cache hit, `FOOD_SEARCH=0` → 404.
- Full frontend and API suites green; manual check in the browser and on the Android emulator:
  build a two-phase draft with two day types, export, import on a second profile with a start date,
  step through the weeks and compare totals.

## 10. Files

New: `frontend/src/lib/nutrition.js`, `nutrition-calendar.js`, `nutrition-plans.js`,
`meal-share.js` (+ tests), `frontend/src/views/Meals.jsx`, `frontend/src/components/FoodPicker.jsx`,
`api/food-search.js`, `api/test/food-search.test.js`, `docs/NUTRITION.md`.

Changed (small): `useStore.js` (DEF default), `Plan.jsx` (third segment), `sheets.jsx`
(wrong-menu hand-off), `api/server.js` (route + `foodSearch` in config), `api/openapi.yaml`,
`api/Dockerfile`, `api/Dockerfile.railway`.

## 11. Rollout

1. Work on `feature/nutrition`; `main` untouched until approved.
2. Deploy API to Railway, then the web app to Vercel (`scripts/deploy-vercel.sh`).
3. The upstream APK does not contain this feature; phones use the web app until a fork APK is
   built (separate task).
