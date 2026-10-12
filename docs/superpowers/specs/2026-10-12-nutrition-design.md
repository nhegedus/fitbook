# Meal plans & nutrition targets — design

Status: approved in conversation 2026-10-12, awaiting spec review.
Scope: the `nhegedus/fitbook` fork only (not proposed upstream). Branch: `feature/nutrition`.

## 1. Goal

Let every user plan what they eat across the week, with calorie and macro targets per weekday,
and let a coach draft meal plans for clients and hand them over as a file.

What counts as done:

- A user can build a week of meals from foods with per-100 g values and see, per day, the plan's
  kcal / protein / carbs / fat against that day's target.
- A coach can keep several named client drafts next to their own plan, export one as a file, and
  the client imports it and sees the same week.

## 2. Decisions taken

| Question | Decision |
|---|---|
| Who writes plans | Everyone their own; a coach also drafts client plans |
| Planning or logging | **Planning only.** Nothing records what was actually eaten |
| Macros | Counted from the plan's foods, compared with targets |
| Food data | Open Food Facts search, proxied by the API, copied into a personal foods list |
| Coach → client | A file (export / import), like training plans; no server-side coach link |
| Targets | Per weekday, with "apply to all days" |
| Client drafts | Several named plans per account; the user's own plan is one of them and is never overwritten by drafting |
| Sync | Approach A: one new top-level state key, synced last-writer-wins as a whole |
| Units | Grams, kcal and grams of macros always, also for lb profiles |
| Languages | English only for now; untranslated strings fall back to English |

Out of scope (possible later): intake logging, barcode scanning, recipes built from foods, meal
photos, copying a whole week, print / PDF of a meal plan, a server-side coach→client link,
per-day sync merging (approach B), translations, a fork-built APK.

## 3. Data

A new top-level key in the persisted state `S`, defaulted in `DEF` (`frontend/src/store/useStore.js`).
Older profiles get the default through the existing `Object.assign(clone(DEF), saved)` overlay; no
migration is needed.

```js
nutrition: {
  foods: [                                // shared by every plan; values per 100 g
    { id, name, kcal, protein, carbs, fat,   // numbers or null when unknown
      source: 'off' | 'manual' | 'import', barcode?: string }
  ],
  plans: [
    { id, name: 'My plan',
      days: {                             // keys '0'..'6' as getDay(): 1 = Monday … 0 = Sunday
        '1': {
          target?: { kcal, protein, carbs, fat },   // each optional
          meals: [ { id, name, items: [ { id, foodId, grams } ] } ]
        }
      } }
  ],
  mine: '<id of the user\'s own plan>'
}
```

Rules:

- The foods list is the single source of a food's values. Items reference foods by id and store
  only grams; correcting a food updates every plan that uses it.
- A day that has never been opened has no entry. Opening it creates the four default meals:
  Breakfast, Lunch, Dinner, Snacks. Meals can be renamed, reordered, added and deleted.
- `mine` always points at an existing plan. It is created on first use ("My plan") and cannot be
  deleted. Every other plan is a draft.
- Deleting a food that is used asks first and removes its items from every plan.
- Grams: 1–5000, integers. Per-100 g values: 0–900 kcal, 0–100 g for each macro; `null` = unknown.

## 4. Calculations — `frontend/src/lib/nutrition.js` (pure, unit-tested)

- `itemTotals(food, grams)` = each value × grams / 100; `null` stays `null` and marks the result
  incomplete.
- `mealTotals`, `dayTotals` sum items; a total is incomplete if any item is.
- `dayStatus(totals, target)` per value: `ok` within ±5 % of the target, `under`, `over`, or `none`
  when there is no target.
- `macroKcal({protein, carbs, fat})` = 4·P + 4·C + 9·F. A food whose stated kcal differs from it by
  more than 15 % (and 20 kcal) is flagged "values don't add up".
- Full precision internally; rounding (kcal to 1, grams to 1 decimal under 10 g, else whole) happens
  only in display helpers.

Plan operations live in `frontend/src/lib/nutrition-plans.js` (pure, unit-tested): create /
duplicate / rename / delete plan, ensure `mine`, open day (default meals), add / rename / move /
delete / copy meal, copy day to days, add / update / delete food (with usage count), set / clear /
apply-to-all targets. The store calls them through its existing `update(s => …)`.

## 5. Screens

**Plan → Schedule | Routines | Meals.** A third value in the existing `Segmented` control in
`Plan.jsx`, remembered with the others in `gym_plan_view`. The Meals view is `views/Meals.jsx`.

- **Plan selector** at the top, shown only when there is more than one plan: the user's plan first,
  drafts below, "+ New meal plan" (empty or duplicate of any plan). The ⋯ menu per plan: rename,
  duplicate, delete (not for `mine`).
- **Day strip** Mon…Sun following the week-start setting, opening on today.
- **Day summary card**: kcal, protein, carbs, fat as planned / target with a bar; green `ok`, amber
  `under`, red `over`; without a target, totals and a "Set targets" link; "incomplete" when a food
  lacks values.
- **Meal cards**: header with name, kcal and protein; lines with food name, grams, kcal; tap a line
  to change grams or remove; "+ Add food"; ⋯ rename, move up / down, copy to another day, delete.
- **Bottom**: "+ Add meal", "Copy this day to…" (pick days, replaces them after confirming),
  "Targets".
- **Targets sheet**: four numbers, macro-implied kcal shown beside kcal, "Apply to all days", "Clear".
- **Food picker sheet** (`components/FoodPicker.jsx`):
  1. Search box filtering the user's foods instantly (offline).
  2. "Search Open Food Facts" below when the server offers it (signed in or paired, and
     `/api/config` reports `foodSearch: true`): name, brand, kcal and protein per 100 g;
     incomplete results marked.
  3. Picking a result opens the food form pre-filled; save adds it to the foods list and then asks
     for grams. "Add manually" opens the same form empty.
- **My foods** (Meals ⋯ → My foods): list with usage counts, edit, delete.
- Meals ⋯ also holds Export meal plan / Import meal plan.

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

File format, one plan per file:

```json
{ "opengym_meals": 1, "exported": "2026-10-12", "name": "Anna – cut",
  "days": { "1": { "target": {}, "meals": [] } },
  "foods": [ { "id": "…", "name": "…", "kcal": 0, "protein": 0, "carbs": 0, "fat": 0 } ] }
```

- Export: the selected plan plus only the foods it uses; no workouts, weigh-ins or settings. File
  name `meal-plan-<plan name>.json`. Web downloads it; the phone uses the same share path the
  training-plan export uses.
- Parse: rejects anything without `opengym_meals: 1` or with malformed days / foods, with a clear
  message; clamps numbers to the ranges in §3; drops items pointing at missing foods.
- Import preview: name, days, meals, foods, each day's kcal vs target. Choices:
  - **Replace my meal plan** (confirms when `mine` is not empty)
  - **Fill empty days only** (into `mine`)
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
No sync code changes; tests pin the behaviour so an upstream change to it is noticed.

## 9. Tests

- `lib/nutrition.test.js` — item / meal / day totals, null handling, status thresholds,
  macro-kcal and the mismatch flag, display rounding.
- `lib/nutrition-plans.test.js` — plan create / duplicate / rename / delete (not `mine`), default
  meals, meal add / move / copy / delete, copy day, food delete with usage, targets apply-to-all.
- `lib/meal-share.test.js` — export carries only used foods, round trip, replace / fill empty /
  save as new, food merge rules, malformed and foreign files, training vs meal file detection.
- Sync — `nutrition` survives `mergeStates` between two copies (later edit wins) and the server's
  `keepUnknown` path.
- `api/test/food-search.test.js` — stub upstream server; 401, 400, normalization (kJ → kcal,
  incomplete, nameless dropped), 502 on timeout / error, 429, cache hit, `FOOD_SEARCH=0` → 404.
- Full frontend and API suites green; manual check in the browser and on the Android emulator:
  build a draft, export, import on a second profile, compare totals.

## 10. Files

New: `frontend/src/lib/nutrition.js`, `nutrition-plans.js`, `meal-share.js` (+ tests),
`frontend/src/views/Meals.jsx`, `frontend/src/components/FoodPicker.jsx`, `api/food-search.js`,
`api/test/food-search.test.js`, `docs/NUTRITION.md`.

Changed (small): `useStore.js` (DEF default), `Plan.jsx` (third segment), `sheets.jsx`
(wrong-menu hand-off), `api/server.js` (route + `foodSearch` in config), `api/openapi.yaml`,
`api/Dockerfile`, `api/Dockerfile.railway`.

## 11. Rollout

1. Work on `feature/nutrition`; `main` untouched until approved.
2. Deploy API to Railway, then the web app to Vercel (`scripts/deploy-vercel.sh`).
3. The upstream APK does not contain this feature; phones use the web app until a fork APK is
   built (separate task).
