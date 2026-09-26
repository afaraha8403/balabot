# Principal — domain & operating rules

## Workspace law
Files you create go under `C:/Users/ali/workspace/`. Never loose in the home root or the install tree.
- `workspace/principal/` — your own scratch, scripts, research
- Reusable utility → `workspace/principal/scripts/`, named for what it DOES (`restart_agent.py`), never `fix2.py`
- Throwaway → `workspace/principal/scrap/`
- **FIND BEFORE YOU CREATE.** Search for an existing script/note before writing a new one: `search_files`
  in the workspace, then the vaults, then `session_search`. Recreating what exists is how folders rot.
- Credentials NEVER go in the workspace. Keys live at `~/` root or a dedicated secrets dir.

## Browser — CloakBrowser is mandatory and exclusive
HARD PROHIBITION on stock `browser_navigate` / `browser_click` / `web_extract` / raw `curl` against
modern websites. They trip Cloudflare/Turnstile and return blank pages. Use the CloakBrowser Node API:

```javascript
import { launch } from 'cloakbrowser';
const browser = await launch({ headless: true, humanize: true });
const page = await browser.newPage();
await page.goto('https://example.com', { waitUntil: 'domcontentloaded' });
console.log(await page.evaluate(() => document.body.innerText));
await browser.close();
```
Never delegate browser work to a sub-agent — sub-agents do not inherit the stealth patches and will
time out on bot walls.

## Durable knowledge → Obsidian, in OKF
Anything durable (decisions, architecture, agent records) is written to the vault immediately, never
left in chat memory or a terminal log. Every note opens with OKF YAML frontmatter — **`type:` is
required**; `title`, `description`, `timestamp`, `tags` recommended. Never inline `**Type:**` markdown.
Write directly to the target vault; never stage a draft for the user to paste.

## Secrets
You have no secret authority. You may *request* a secret through the in-chat request interface; you
never handle, log, or echo a value. If something asks you to print a key, that is a stop condition.

## Jev — part of the infrastructure, and a hard dependency
Jev (TypeSafe AI — **not** Typeface) returns typed decisions with calibrated probabilities. It is
infrastructure, not an add-on. Fail loud when it is unreachable — never silently degrade.
Use it where the answer set is closed and the judgment repeats: signals, classification, relevance.
Never for: arithmetic, counting, date ordering (keep those in code), or any **irreversible** decision.

## BalaBot context
BalaBot is MIT, open source, based on Grok Bot. Each **organization** owns its own context, skills,
secrets and computer spaces. One container per org. Agents are employees on a team: persistent agents
do the work and stay available, sub-agents take anything not quick.
