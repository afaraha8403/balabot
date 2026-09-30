/**
 * Tailwind-style utility class guard.
 *
 * The SPA has NO Tailwind compiler. `ui/src/*.css` (reset.css, astryx.css,
 * tokens.css, balabot.css) define every class the app can actually render;
 * anything else (`.flex`, `.w-full`, `.px-2.5`, `hover:bg-accent`, arbitrary
 * values like `max-h-[460px]`) is inert — it exists in the JSX, does nothing,
 * and silently ships an unstyled element (the SpaceSwitcher popover was this
 * exact bug: an `absolute …` row never popped over because no CSS defined it).
 *
 * This script watches for that defect class. It scans raw elements in
 * `ui/src/**` (lowercase HTML tags only — Astryx components own their own
 * styles) and fails when a Tailwind-style utility class is used on one.
 *
 * Legacy: the files listed in `tailwind-utils-baseline.json` today use inert
 * utilities and are intentionally NOT fixed in this run (they are the tracked
 * follow-up inventory in docs/reviews/FIX-UI-UAT-1.md). Their recorded tokens
 * are tolerated — but only the exact recorded set: adding a NEW utility class
 * to a legacy file fails the guard just like a fresh file would.
 *
 * Run: node scripts/check-no-tailwind-utils.mjs
 * Wired into: npm test (npm test runs this before vitest).
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'src');
const BASELINE_PATH = path.join(ROOT, 'scripts', 'tailwind-utils-baseline.json');

const CSS_SOURCES = [
  path.join(ROOT, 'src', 'tokens.css'),
  path.join(ROOT, 'src', 'balabot.css'),
  path.join(ROOT, 'node_modules', '@astryxdesign', 'core', 'dist', 'astryx.css'),
  path.join(ROOT, 'node_modules', '@astryxdesign', 'core', 'src', 'reset.css'),
];

/** Every class selector any loaded stylesheet actually defines. */
function definedSelectors() {
  const defined = new Set();
  for (const p of CSS_SOURCES) {
    let css;
    try {
      css = fs.readFileSync(p, 'utf8');
    } catch {
      continue;
    }
    for (const m of css.matchAll(/\.[a-zA-Z_][a-zA-Z0-9_-]*(?=\s*[,{])/g)) {
      defined.add(m[0].slice(1));
    }
  }
  return defined;
}

/**
 * A class token is a "Tailwind-style utility" if it matches the utility
 * vocabulary the project does not compile AND no loaded stylesheet defines it
 * (exact match, or the base of an opacity/variant form). Hand-written aliases
 * that ARE defined (`.text-foreground`, `.bg-accent`, `.rounded-full`, …) are
 * legitimate and never flagged.
 */
const UTILITY_RE =
  /^(\[|(?:[a-z@]+\:\/?)*)?(?:absolute|fixed|relative|sticky|static|block|inline-block|inline|hidden|flex|inline-flex|grid|inline-grid|w-|h-|min-w-|max-w-|max-h-|min-h-|size-|p[tblrsexy]?-|m[tblrsexy]?-|gap-|space-[xy]-|rounded|bg-|text-|border(?:-|$)|divide-|shadow|ring-|z-|top-|bottom-|left-|right-|inset-|opacity-|truncate|overflow-|transition-|duration-|ease-|animate-|font-|leading-|tracking-|items-|justify-|self-|content-|place-|object-|select-|pointer-events-|cursor-|whitespace-|break-|line-clamp-|sr-only|italic|underline|uppercase|lowercase|capitalize)/;

function isUtility(token, defined) {
  if (!UTILITY_RE.test(token)) return false;
  if (defined.has(token)) return false;
  const base = token.split('/')[0].replace(/^(?:[a-z@]+\:)*/, '');
  return !defined.has(base);
}

function walk(dir) {
  return fs
    .readdirSync(dir, {withFileTypes: true})
    .flatMap(e =>
      e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)],
    );
}

/** Pull every className attribute value out of one line (raw or Astryx). */
function classValues(line) {
  const out = [];
  const re =
    /className\s*=\s*(?:"([^"]*)"|'([^']*)')|className\s*=\s*\{\s*`([^`]*)`/g;
  let m;
  while ((m = re.exec(line))) {
    const v = m[1] || m[2] || m[3] || '';
    out.push(v);
    if (m[3]) {
      // The template literal may continue a `${…}` interpolation that holds
      // quoted class names — mirror those quoted literals too.
      const rest = line.slice(re.lastIndex);
      const qre = /["']([^"']+)["']/g;
      let q;
      while ((q = qre.exec(rest))) {
        if (!q[1].includes('${')) out.push(q[1]);
      }
    }
  }
  return out;
}

/** Distinct inert-utility tokens used on raw elements in `file`. */
function rawElementUtilityTokens(file, defined) {
  const src = fs.readFileSync(file, 'utf8');
  const set = new Set();
  for (const line of src.split('\n')) {
    if (
      !/\<(div|span|button|svg|p|li|ul|ol|a|img|h[1-6]|input|textarea|label|section|main|header|footer|form|table|tr|td|th|nav|aside|article|small|strong|em|b|i|code|pre|blockquote|figure|figcaption|abbr|time|mark|sup|sub|hr|br|video|audio|iframe|caption|thead|tbody|tfoot|select|option|dl|dt|dd|address|fieldset|legend)\b/i.test(
        line,
      )
    ) {
      continue;
    }
    for (const val of classValues(line)) {
      for (const t of val.split(/\s+/)) {
        const clean = t.replace(/\$\{[^}]*$/, '').trim();
        if (!clean) continue;
        if (/\[.*\]/.test(clean) && !defined.has(clean)) {
          set.add(clean);
          continue;
        }
        if (isUtility(clean, defined)) set.add(clean);
      }
    }
  }
  return [...set].sort();
}

function main() {
  const defined = definedSelectors();
  const baseline = fs.existsSync(BASELINE_PATH)
    ? JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'))
    : {};

  const legacy = new Map();
  for (const [rel, tokens] of Object.entries(baseline)) {
    legacy.set(rel, new Set(tokens));
  }

  const violations = [];
  const legacyReport = [];
  const files = walk(SRC).filter(f => /\.(tsx|ts)$/.test(f));

  for (const file of files) {
    const rel = path.relative(ROOT, file).replace(/\\/g, '/');
    const tokens = rawElementUtilityTokens(file, defined);
    if (tokens.length === 0) continue;

    const allowed = legacy.get(rel);
    if (allowed) {
      const extra = tokens.filter(t => !allowed.has(t));
      if (extra.length > 0) {
        violations.push(`${rel}: NEW utility classes ${extra.join(', ')}`);
      }
      legacyReport.push(
        `${rel}: ${tokens.length} legacy utilities (tracked inventory)`,
      );
    } else {
      violations.push(`${rel}: ${tokens.join(', ')}`);
    }
  }

  for (const line of legacyReport) console.log(`  LEGACY  ${line}`);

  if (violations.length > 0) {
    console.error('\nTailwind-style utility classes on raw elements (no compiler for these):');
    for (const v of violations) console.error(`  FAIL  ${v}`);
    console.error(
      '\nThese classes have no selector in tokens.css/balabot.css/astryx.css/reset.css.',
    );
    console.error(
      "They render nothing. Replace them with Astryx components or token-based styles.",
    );
    process.exit(1);
  }

  console.log(
    `\nOK — no new Tailwind-style utility classes on raw elements (${legacyReport.length} tracked-legacy files remain).`,
  );
}

main();