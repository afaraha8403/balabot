/**
 * BalaBot — "agent thinking" E2E (real UI, real DOM assertions).
 *
 * Verifies the reasoning ("thinking") stream is:
 *   1. HIDDEN by default (no reasoning text anywhere in the DOM),
 *   2. revealed only by a persistent user toggle (survives reload),
 *   3. rendered as a DISTINCT collapsible disclosure — collapsed first,
 *      expanding only when the user clicks it, never as a normal chat message.
 *
 * Every assertion reads real rendered state. The seeded-canary check is
 * mutation-sensitive: delete the `showThinking &&` render gate and step 2 fails.
 *
 * Run: node tests/e2e/ui_thinking_e2e.mjs
 */
import fs from 'fs';
import path from 'path';
import os from 'os';

const CB = 'file:///C:/Users/ali/AppData/Roaming/npm/node_modules/cloakbrowser/dist/index.js';
let launch;
try { ({ launch } = await import(CB)); } catch { ({ launch } = await import('cloakbrowser')); }

const BASE = process.env.BASE || 'http://127.0.0.1:9119';
const PASSWORD = process.env.PASSWORD || fs.readFileSync(
  path.join(os.homedir(), 'secrets', 'balabot-dashboard.key'), 'utf8').replace(/\r?\n/g, '');
const AUTH = 'Basic ' + Buffer.from(`ali:${PASSWORD}`).toString('base64');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const CANARY = 'CANARY_REASONING_ZZTOP_9f3a the private ledger note';
/** A known reasoning delta appended to the real live SSE body. The disclosure
 *  assertions must not depend on the model being verbose (a live turn can carry
 *  as little as "Answer: 391."), so a distinctive canary rides the same
 *  `delta.reasoning_content` channel; the product must parse it, buffer it, and
 *  reveal it behind the live disclosure exactly like the model's own tokens. */
const LIVE_CANARY = 'CANARY_LIVE_REASONING_5e7b the live-stream private note';
/** Per-run session id. The app persists every live turn to the server-backed
 *  session of the same id, so a fixed id makes repeated runs non-independent:
 *  the next run replays the prior run's whole transcript over SSE and the
 *  fixture is measured underneath it. A unique id keeps each run hermetic. */
const SEED_ID = `s_seed_${Date.now().toString(36)}`;
const results = [];
const record = (name, ok, detail = '') => {
  results.push({ name, ok, detail: String(detail).slice(0, 300) });
  console.log(`${ok ? '  PASS' : '  FAIL'}  ${name}${ok ? '' : '  <- ' + String(detail).slice(0, 220)}`);
};

const seed = (showThinking) => `
  localStorage.clear();
  localStorage.setItem('balabot.sessions.v1', JSON.stringify([{
    id: ${JSON.stringify(SEED_ID)}, botId: 'principal', title: 'Seed', createdAt: 1, handoffs: [],
    messages: [
      {role: 'user', content: 'Seed question', at: 1},
      {role: 'assistant', content: 'CANARY_ANSWER_123', at: 2, thinking: ${JSON.stringify(CANARY)}}
    ]
  }]));
  localStorage.setItem('balabot.lastBot.v1', 'principal');
  ${showThinking ? `localStorage.setItem('balabot.showThinking.v1', 'true');` : `localStorage.removeItem('balabot.showThinking.v1');`}
`;
/** Session-list-only re-seed: the running app persists the server's whole session
 *  register into the same store, so on reload the newest live session — not the
 *  fixture — becomes active. Re-seeding just the list keeps the fixture mounted
 *  while leaving the user's showThinking choice (set by the toggle) untouched. */
const seedSessions = () => `
  localStorage.setItem('balabot.sessions.v1', JSON.stringify([{
    id: ${JSON.stringify(SEED_ID)}, botId: 'principal', title: 'Seed', createdAt: 1, handoffs: [],
    messages: [
      {role: 'user', content: 'Seed question', at: 1},
      {role: 'assistant', content: 'CANARY_ANSWER_123', at: 2, thinking: ${JSON.stringify(CANARY)}}
    ]
  }]));
  localStorage.setItem('balabot.lastBot.v1', 'principal');
`;

const bodyText = (page) => page.evaluate(() => document.body.innerText || '');
/** Thinking disclosures actually in the DOM. Scoped to collapsibles whose trigger
 *  reads "Thinking"/"Thinking…" — the bots sidebar also renders Astryx Collapsible
 *  sections (OPS, GOVERNANCE, Hidden Bots) which are chrome, not reasoning. */
const disclosures = (page) => page.evaluate(() =>
  [...document.querySelectorAll('.astryx-collapsible')].filter(el =>
    /^Thinking(…|\.\.\.)?$/.test(((el.querySelector('button, [role="button"]') || {}).innerText || '').trim())
  ).length);
/** Wait until the rendered transcript contains `needle` (the seeded answer proves
 *  the session is mounted — without this, "nothing is rendered yet" reads as
 *  "hidden"). Scoped to the transcript: the bots sidebar echoes the same text. */
const waitForText = async (page, needle, timeoutMs = 20000) => {
  const start = Date.now();
  for (;;) {
    const t = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="transcript"]');
      return (el ? el.innerText : document.body.innerText) || '';
    });
    if (t.includes(needle)) return true;
    if (Date.now() - start > timeoutMs) return false;
    await sleep(500);
  }
};
const switchEl = (page) => page.evaluate(() => {
  const label = [...document.querySelectorAll('label')]
    .find(l => (l.innerText || '').trim().includes('Show thinking'));
  const byLabel = label && label.htmlFor ? document.getElementById(label.htmlFor) : null;
  const el = byLabel || document.querySelector('input[role="switch"]') ||
    [...document.querySelectorAll('input[type="checkbox"]')][0];
  return el ? { found: true, checked: el.checked } : { found: false, checked: null };
});
const clickSwitch = (page) => page.evaluate(() => {
  const label = [...document.querySelectorAll('label')]
    .find(l => (l.innerText || '').trim().includes('Show thinking'));
  if (label) { label.click(); return true; }
  const el = document.querySelector('input[role="switch"]') || document.querySelector('input[type="checkbox"]');
  if (!el) return false;
  el.click();
  return true;
});
/** The "Show thinking" switch lives in the bot settings panel (per-bot display
 *  preference). Open that panel so the label/switch are present in the DOM. */
const openBotSettings = (page) => page.evaluate(() => {
  const b = [...document.querySelectorAll('button, [role="button"]')]
    .find(x => (x.getAttribute('aria-label') || x.innerText || '').trim() === 'Bot settings');
  if (b) b.click();
  return !!b;
});
const isTrigger = (t) => /^Thinking(…|\.\.\.)?$/.test(t);
const thinkingTriggers = (page) => page.evaluate(() =>
  [...document.querySelectorAll('button, [role="button"]')]
    .map(b => (b.innerText || '').trim())
    .filter(t => /^Thinking(…|\.\.\.)?$/.test(t)));
const expandTrigger = (page) => page.evaluate(() => {
  const btn = [...document.querySelectorAll('button, [role="button"]')]
    .find(b => /^Thinking(…|\.\.\.)?$/.test((b.innerText || '').trim()));
  if (!btn) return false;
  btn.click();
  return true;
});
const collapsedOpen = (page) => page.evaluate(() => {
  const btn = [...document.querySelectorAll('button, [role="button"]')]
    .find(b => /^Thinking(…|\.\.\.)?$/.test((b.innerText || '').trim()));
  if (!btn) return null;
  return btn.getAttribute('aria-expanded');
});
/** Wait until the live turn's real in-flight affordance has appeared AND settled:
 *  the streaming bubble / Stop control is gone and the final message's own
 *  "Thinking" disclosure has rendered (seeded 1 -> live 2). A body-text-length
 *  stability loop exits during the pre-first-token window — before the turn's
 *  response is delivered — and then measures an empty live stream (`segs=0`). */
const waitForLiveTurn = async (page, timeoutMs = 120000) => {
  const start = Date.now();
  let streamingSeen = false;
  for (;;) {
    const st = await page.evaluate(() => ({
      live: Boolean(document.querySelector('[data-message-id="progress:live"]')) ||
        Boolean(document.querySelector('button[aria-label="Stop"], .polaris-composer-btn-stop')),
      thinking: [...document.querySelectorAll('button, [role="button"]')]
        .filter(b => /^Thinking$/.test((b.innerText || '').trim())).length,
    }));
    if (st.live) streamingSeen = true;
    if (streamingSeen && !st.live && st.thinking >= 2) return true;
    if (Date.now() - start > timeoutMs) return false;
    await sleep(300);
  }
};
const sendPrompt = async (page, text) => {
  await page.evaluate(() => {
    const el = document.querySelector('[data-testid="composer-fieldset"] textarea')
      || document.querySelector('textarea[role="combobox"]') || document.querySelector('textarea');
    el.click(); el.focus();
  });
  await page.keyboard.type(text, { delay: 20 });
  await sleep(250);
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find(x => /^Send$/.test((x.getAttribute('aria-label') || x.innerText || '').trim()));
    if (b) b.click();
  });
  return waitForLiveTurn(page);
};

const browser = await launch({ headless: true, humanize: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
await ctx.setExtraHTTPHeaders({ Authorization: AUTH });
const page = await ctx.newPage();
let lastReasoning = '';
await page.route('**/api/chat', async (route) => {
  const resp = await route.fetch();
  const body = await resp.text();
  let r = '';
  for (const line of body.split('\n')) {
    if (!line.startsWith('data:')) continue;
    const d = line.slice(5).trim();
    if (!d.startsWith('{')) continue;
    try { const p = JSON.parse(d); r += p.choices?.[0]?.delta?.reasoning_content || ''; } catch {}
  }
  if (r) lastReasoning = r;
  // Append the known reasoning delta so the live-disclosure checks have a
  // deterministic needle regardless of how terse the model's own reasoning is.
  const injected = body.replace(/\s*$/, '') + '\n\n' +
    'data: ' + JSON.stringify({ choices: [{ delta: { reasoning_content: ' ' + LIVE_CANARY } }] }) + '\n\n';
  await route.fulfill({ response: resp, body: injected });
});

try {
  // ---- 1. default OFF: seeded reasoning must not be in the DOM at all ----
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(seed(false));
  await page.reload({ waitUntil: 'domcontentloaded' });
  const mounted = await waitForText(page, 'CANARY_ANSWER_123');
  record('t00 seeded session actually rendered (guards the hidden-checks)', mounted,
    'seeded answer never appeared — a "hidden" pass here would be vacuous');
  let txt = await bodyText(page);
  record('t01 seeded reasoning text not visible when toggle is off', mounted && !txt.includes(CANARY), `canaryVisible=${txt.includes(CANARY)}`);
  record('t02 no thinking disclosure element in the DOM when off',
    mounted && (await disclosures(page)) === 0 && (await thinkingTriggers(page)).length === 0,
    `disclosures=${await disclosures(page)} triggers=${(await thinkingTriggers(page)).length}`);
  await openBotSettings(page);
  await sleep(400);
  const sw0 = await switchEl(page);
  record('t03 toggle exists and is off by default', sw0.found && sw0.checked === false, JSON.stringify(sw0));

  // ---- 2. toggle ON, persists across reload ----
  record('t04 toggle is clickable in the real UI', await clickSwitch(page));
  await sleep(500);
  const stored = await page.evaluate(() => localStorage.getItem('balabot.showThinking.v1'));
  record('t05 toggle choice persisted to storage', stored === 'true', `stored=${stored}`);
  await page.evaluate(seedSessions());
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitForText(page, 'CANARY_ANSWER_123');
  await openBotSettings(page);
  await sleep(400);
  const sw1 = await switchEl(page);
  record('t06 toggle survives a reload (persistent)', sw1.found && sw1.checked === true, JSON.stringify(sw1));
  record('t07 message content is not corrupted by the reasoning stream', !(await bodyText(page)).includes(CANARY), 'seeded thinking leaked into the thread body');

  // ---- 3. distinct + collapsible, not a normal message ----
  const trig = await thinkingTriggers(page);
  record('t08 thinking rendered as its own disclosure trigger', trig.length >= 1 && (await disclosures(page)) >= 1, `triggers=${JSON.stringify(trig)} disclosures=${await disclosures(page)}`);
  record('t09 disclosure starts COLLAPSED', (await collapsedOpen(page)) === 'false', `aria-expanded=${await collapsedOpen(page)}`);
  txt = await bodyText(page);
  record('t10 reasoning text still hidden while collapsed', !txt.includes(CANARY));
  record('t11 expanding the disclosure is possible', await expandTrigger(page));
  await sleep(600);
  txt = await bodyText(page);
  record('t12 reasoning revealed after expanding', txt.includes(CANARY));
  record('t13 answer and thinking are separate blocks', txt.includes('CANARY_ANSWER_123') && txt.includes(CANARY));

  // ---- 4. live stream: real reasoning arrives on its own channel ----
  await sendPrompt(page, 'What is 17*23? Think step by step, then answer.');
  const live = lastReasoning;
  record('t14 live stream carried reasoning_content', live.trim().length > 0, `reasoningChars=${live.length}`);
  // The known live-reasoning canary (injected into the real SSE body above) is
  // the deterministic needle: hidden while collapsed, revealed on expanding the
  // newest disclosure. The model's own reasoning length cannot be relied on.
  const domNow = await bodyText(page);
  record('t15 live reasoning not shown while collapsed',
    !domNow.includes(LIVE_CANARY), `canaryVisible=${domNow.includes(LIVE_CANARY)}`);
  // expand the newest Thinking disclosure (last one) and confirm it reveals the live text
  await page.evaluate(() => {
    const btns = [...document.querySelectorAll('button, [role="button"]')].filter(b => /^Thinking(…|\.\.\.)?$/.test((b.innerText || '').trim()));
    if (btns.length) btns[btns.length - 1].click();
  });
  await sleep(700);
  const domAfter = await bodyText(page);
  record('t16 expanding live thinking reveals the reasoning',
    domAfter.includes(LIVE_CANARY), `canaryVisible=${domAfter.includes(LIVE_CANARY)}`);

  // ---- 5. turn OFF again → everything hidden again ----
  await openBotSettings(page);
  await sleep(400);
  await clickSwitch(page);
  await sleep(500);
  record('t17 toggle turns back off', (await switchEl(page)).checked === false);
  txt = await bodyText(page);
  record('t18 reasoning hidden again when toggled off',
    !txt.includes(CANARY) && (await disclosures(page)) === 0 && (await thinkingTriggers(page)).length === 0,
    `disclosures=${await disclosures(page)}`);
} catch (e) {
  record('harness completed without throwing', false, (e && e.stack) || String(e));
}

const passed = results.filter(r => r.ok).length;
console.log(`\n${passed}/${results.length} checks passed`);
fs.writeFileSync(new URL('./ui-thinking-e2e-results.json', import.meta.url), JSON.stringify(results, null, 2));
await browser.close();
process.exit(passed === results.length ? 0 : 1);
