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
