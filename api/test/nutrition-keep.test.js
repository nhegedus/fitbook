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
