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
