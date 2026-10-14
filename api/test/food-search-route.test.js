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
