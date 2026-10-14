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
      // Not AbortSignal.timeout: its timer is unref'd, so it cannot keep a hung request alive to fire.
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), timeoutMs);
      try {
        const res = await fetchImpl(u, {
          headers: { 'User-Agent': `openGym (${origin})`, Accept: 'application/json' },
          signal: ctl.signal,
        });
        if (!res.ok) return UNAVAILABLE();
        json = await res.json();
      } catch { return UNAVAILABLE(); } finally { clearTimeout(timer); }
      if (!Array.isArray(json?.hits)) return UNAVAILABLE();
      const body = { results: json.hits.map(h => normalizeHit(h, lang)).filter(Boolean) };
      cache.delete(key);
      if (cache.size >= max) cache.delete(cache.keys().next().value);
      cache.set(key, { at: now(), body });
      return { status: 200, body };
    },
  };
}
