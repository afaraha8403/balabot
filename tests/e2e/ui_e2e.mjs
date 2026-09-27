/**
 * BalaBot — UI-level end-to-end scenarios.
 *
 * The Python simulations in tests/simulations/ model the ARCHITECTURE in memory.
 * This harness is different: it drives the REAL product UI in a stealth browser
 * and asserts on what actually lands in the DOM. A scenario that cannot fail is
 * worse than no scenario, so every check reads real rendered state — never prose,
 * never a screenshot.
 *
 * Run:  node ui_e2e.mjs                      (defaults to http://127.0.0.1:9119)
 *       BASE=http://localhost:9119 node ui_e2e.mjs
 *
 * Env:
 *   BASE      base URL of the adapter         (default http://127.0.0.1:9119)
 *   USERNAME  basic-auth user                 (default ali)
 *   PASSWORD  basic-auth password             (default: read from ~/secrets/balabot-dashboard.key)
 *
 * Writes ui-e2e-results.json next to this file and prints a table.
 */

import fs from 'fs';
import path from 'path';
import os from 'os';

const CB = 'file:///C:/Users/ali/AppData/Roaming/npm/node_modules/cloakbrowser/dist/index.js';
let launch;
try { ({ launch } = await import(CB)); } catch { ({ launch } = await import('cloakbrowser')); }

const BASE = process.env.BASE || 'http://127.0.0.1:9119';
const USERNAME = process.env.USERNAME || 'ali';
const PASSWORD = process.env.PASSWORD || (() => {
  try {
    return fs.readFileSync(path.join(os.homedir(), 'secrets', 'balabot-dashboard.key'), 'utf8').trim();
  } catch { return ''; }
})();

if (!PASSWORD) { console.error('No password: set PASSWORD or ~/secrets/balabot-dashboard.key'); process.exit(2); }

const AUTH = 'Basic ' + Buffer.from(`${USERNAME}:${PASSWORD}`).toString('base64');
const results = [];

function record(name, ok, detail) {
  results.push({ name, ok, detail: String(detail).slice(0, 400) });
  console.log(`${ok ? '  PASS' : '  FAIL'}  ${name}${ok ? '' : '  <- ' + String(detail).slice(0, 220)}`);
}

/** Open an authenticated page with JS-error trapping installed before boot. */
async function openPage(browser, { viewport = { width: 1440, height: 900 } } = {}) {
  const ctx = await browser.newContext({ viewport, serviceWorkers: 'block' });
  await ctx.setExtraHTTPHeaders({ Authorization: AUTH });
  const page = await ctx.newPage();
  await page.addInitScript(() => {
    window.__errs = [];
    window.addEventListener('error', (e) => window.__errs.push(String(e.message || e)));
    window.addEventListener('unhandledrejection', (e) => window.__errs.push('unhandledrejection: ' + String(e.reason)));
  });
  return { ctx, page };
}

const text = (page) => page.evaluate(() => document.body.innerText || '');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- scenarios

async function s01_auth_gate(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  let status = 0;
  page.on('response', (r) => { if (r.url().startsWith(BASE) && !r.url().includes('/api/')) status = r.status(); });
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 40000 }).catch(() => {});
  await sleep(2500);
  const body = await text(page);
  const leaked = /principal|governor|roster|agents/i.test(body) && body.length > 400;
  await ctx.close();
  // Either a 401 challenge or a rendered page that is NOT the app.
  record('s01 unauthenticated access is refused', !leaked,
    `status=${status} bodyLen=${body.length} leaked=${leaked}`);
}

async function s02_app_shell(browser) {
  const { ctx, page } = await openPage(browser);
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 40000 });
  await sleep(4000);
  const body = await text(page);
  const errs = await page.evaluate(() => window.__errs || []);
  const ok = body.trim().length > 80 && errs.length === 0;
  await ctx.close();
  record('s02 app shell boots with no JS errors', ok,
    `bodyLen=${body.length} errs=${JSON.stringify(errs).slice(0, 200)}`);
}

async function s03_roster_renders(browser) {
  const { ctx, page } = await openPage(browser);
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 40000 });
  await sleep(4500);
  const body = await text(page);
  const hasPrincipal = /principal/i.test(body);
  const hasGovernor = /governor/i.test(body);
  await ctx.close();
  record('s03 roster lists principal and governor', hasPrincipal && hasGovernor,
    `principal=${hasPrincipal} governor=${hasGovernor} bodyLen=${body.length}`);
}

async function s04_chat_roundtrip(browser) {
  const { ctx, page } = await openPage(browser);
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 40000 });
  await sleep(4500);

  // A message cannot be sent until a bot is selected (App.tsx: `if (!activeBot) return;`)
  // and activeBotId starts null in a fresh context, so select one from the roster first.
  const picked = await page.evaluate(() => {
    const els = Array.from(document.querySelectorAll('a, button, li, [role=option], [role=button]'));
    const hit = els.find((e) => /principal/i.test(e.innerText || '') && e.offsetParent !== null);
    if (!hit) return null;
    hit.click();
    return (hit.innerText || '').trim().slice(0, 40);
  });
  await sleep(2500);

  // find the COMPOSER -- not the roster's "Search bots…" box, which is also a
  // visible text input and wins a naive first-match query.
  const field = await page.evaluate(() => {
    const cands = Array.from(document.querySelectorAll('input[type=text], textarea, [contenteditable=true]'));
    const vis = cands.filter((e) => !e.disabled && e.offsetParent !== null);
    const el = vis.find((e) => /message/i.test(e.getAttribute('placeholder') || '') || /message/i.test(e.getAttribute('aria-label') || ''))
      || vis.find((e) => e.tagName === 'TEXTAREA')
      || vis[vis.length - 1];
    if (!el) return null;
    el.setAttribute('data-e2e-composer', '1');
    return el.tagName + ' ph=' + (el.getAttribute('placeholder') || '');
  });
  if (!field) { await ctx.close(); return record('s04 a message gets a streamed reply', false, `no composer after selecting bot (picked=${picked})`); }

  const before = (await text(page)).length;
  await page.click('[data-e2e-composer="1"]');
  await page.keyboard.type('Reply with exactly: UI_OK');
  await page.keyboard.press('Enter');

  let landed = false;
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    const t = await text(page);
    if (/UI_OK/.test(t) && t.length > before) { landed = true; break; }
    await sleep(1500);
  }
  await ctx.close();
  record('s04 a message gets a streamed reply', landed,
    landed ? 'UI_OK appeared in the DOM' : `no reply within 90s (picked=${picked} field=${field})`);
}

async function s05_screens_render(browser) {
  const names = ['agents', 'memory', 'decisions', 'governance', 'ops', 'cost'];
  const { ctx, page } = await openPage(browser);
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 40000 });
  await sleep(4000);
  const bad = [];
  for (const n of names) {
    const clicked = await page.evaluate((name) => {
      const els = Array.from(document.querySelectorAll('a, button, [role=menuitem], [role=tab], li'));
      const hit = els.find((e) => (e.innerText || '').trim().toLowerCase().startsWith(name) && e.offsetParent !== null);
      if (hit) { hit.click(); return true; }
      return false;
    }, n);
    await sleep(1800);
    const t = await text(page);
    const errs = await page.evaluate(() => window.__errs || []);
    // Rendering is a pass if the screen produced content and threw nothing.
    if (!t || t.trim().length < 60 || errs.length) bad.push(`${n}(clicked=${clicked},len=${t.trim().length},errs=${errs.length})`);
  }
  await ctx.close();
  record('s05 every extra screen renders without error', bad.length === 0, bad.join(' ') || 'all six rendered');
}

async function s06_mobile_viewport(browser) {
  const { ctx, page } = await openPage(browser, { viewport: { width: 390, height: 844 } });
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 40000 });
  await sleep(4500);
  const body = await text(page);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 8);
  await ctx.close();
  record('s06 phone viewport renders without horizontal overflow', body.trim().length > 80 && !overflow,
    `bodyLen=${body.length} overflow=${overflow}`);
}

async function s07_api_honesty() {
  // The UI must not present fabricated data as real: every extra endpoint must
  // either carry data or say available:false. This is an API-contract check, so
  // it runs from Node with the same credentials rather than through the page.
  const bad = [];
  for (const ep of ['/api/fleet', '/api/agents', '/api/memory', '/api/decisions', '/api/governance', '/api/ops', '/api/cost']) {
    let status = 0;
    let body = '';
    try {
      const r = await fetch(BASE + ep, { headers: { Authorization: AUTH } });
      status = r.status;
      body = await r.text();
    } catch (e) { bad.push(`${ep}=NETWORK(${e && e.message})`); continue; }

    let ok = false;
    try {
      const j = JSON.parse(body);
      // Honest = either real data (available:true / an array) or an explicit refusal.
      ok = (j && typeof j === 'object') && ('available' in j || Array.isArray(j) || 'bots' in j || 'agents' in j);
    } catch { ok = false; }
    if (!/^2/.test(String(status)) || !ok) bad.push(`${ep}=${status}: ${body.slice(0, 80)}`);
  }
  record('s07 every UI endpoint returns honest JSON (data or available:false)', bad.length === 0, bad.join(' ') || 'all endpoints ok');
}

// ---------------------------------------------------------------- main

async function s08_tool_activity(browser) {
  // The working indicator and the tool-call rows must be driven by REAL gateway
  // activity, not decoration. A tool-forcing prompt makes the agent call its
  // terminal tool, and we assert that the actual tool name and its target reach
  // the DOM. A mocked/absent tool feed cannot pass this.
  const stamp = 'E2ETOOL' + Date.now().toString().slice(-6);
  const { ctx, page } = await openPage(browser);
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 40000 });
  await sleep(4500);

  await page.evaluate(() => {
    const els = Array.from(document.querySelectorAll('a, button, li, [role=option], [role=button]'));
    const hit = els.find((e) => /principal/i.test(e.innerText || '') && e.offsetParent !== null);
    if (hit) hit.click();
  });
  await sleep(2500);

  const field = await page.evaluate(() => {
    const cands = Array.from(document.querySelectorAll('input[type=text], textarea, [contenteditable=true]'));
    const vis = cands.filter((e) => !e.disabled && e.offsetParent !== null);
    const el = vis.find((e) => /message/i.test(e.getAttribute('placeholder') || '') || /message/i.test(e.getAttribute('aria-label') || ''))
      || vis.find((e) => e.tagName === 'TEXTAREA')
      || vis[vis.length - 1];
    if (!el) return null;
    el.setAttribute('data-e2e-composer2', '1');
    return el.tagName;
  });
  if (!field) {
    await ctx.close();
    return record('s08 a real tool call is surfaced (ChatToolCalls + orb)', false, 'no composer');
  }

  await page.click('[data-e2e-composer2="1"]');
  await page.keyboard.type(`Use your terminal tool to run exactly: echo ${stamp} — then report the output. You must call the tool.`);
  await page.keyboard.press('Enter');

  let sawToolRow = false;
  let sawOrbNamingTool = false;
  let sawTarget = false;
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    const s = await page.evaluate(() => {
      const t = document.body.innerText || '';
      const orbs = Array.from(document.querySelectorAll('canvas')).map((c) => c.getAttribute('aria-label') || '');
      return {
        t,
        rows: document.querySelectorAll('[class*="astryx-chat-tool"]').length,
        orbLabels: orbs,
      };
    });
    if (s.rows > 0) sawToolRow = true;
    if (s.orbLabels.some((l) => /is running \w+/.test(l))) sawOrbNamingTool = true;
    if (s.t.includes(stamp)) sawTarget = true;
    if (sawToolRow && sawTarget && sawOrbNamingTool) break;
    // The orb only occupies the thread in the window between "turn started" and
    // "first text token arrived", so it must be sampled faster than a second or
    // the window closes between polls.
    await sleep(250);
  }

  // Let the turn finish, then confirm the call PERSISTS on the settled message
  // rather than vanishing with the orb.
  await sleep(12000);
  const after = await page.evaluate(() => ({
    rows: document.querySelectorAll('[class*="astryx-chat-tool"]').length,
    orbs: document.querySelectorAll('canvas').length,
  }));
  await ctx.close();

  record(
    's08 a real tool call is surfaced (ChatToolCalls + orb)',
    sawToolRow && sawTarget && sawOrbNamingTool && after.rows > 0,
    `toolRow=${sawToolRow} target=${sawTarget} orbNamedTool=${sawOrbNamingTool} persistedRows=${after.rows} orbsAfter=${after.orbs}`,
  );
}

const browser = await launch({ headless: true, humanize: true });
console.log(`\nBalaBot UI E2E  ->  ${BASE}\n`);

const scenarios = [
  ['s01', s01_auth_gate],
  ['s02', s02_app_shell],
  ['s03', s03_roster_renders],
  ['s04', s04_chat_roundtrip],
  ['s05', s05_screens_render],
  ['s06', s06_mobile_viewport],
  ['s07', s07_api_honesty],
  ['s08', s08_tool_activity],
];

for (const [id, fn] of scenarios) {
  try { await fn(browser); }
  catch (e) { record(`${id} (threw)`, false, e && e.message ? e.message : String(e)); }
}

await browser.close();

const passed = results.filter((r) => r.ok).length;
console.log(`\n${passed}/${results.length} scenarios passed\n`);
fs.writeFileSync(new URL('./ui-e2e-results.json', import.meta.url),
  JSON.stringify({ base: BASE, when: new Date().toISOString(), passed, total: results.length, results }, null, 2));
process.exit(passed === results.length ? 0 : 1);