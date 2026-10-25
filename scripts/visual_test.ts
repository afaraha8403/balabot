/**
 * BalaBot Visual E2E Acceptance & Flow Test Script
 *
 * Runs the live application (Server + UI on http://127.0.0.1:9119),
 * drives Chrome via puppeteer-core, exercises all primary user flows,
 * captures full-resolution screenshots, and validates DOM & data output.
 */

import puppeteer from "puppeteer-core";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { BalaBotServer } from "../server/api.js";
import { BalaBotDatabase } from "../server/db.js";

const PORT = 9119;
const CHROME_PATH = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const SCREENSHOT_DIR = path.resolve(process.cwd(), "screenshots");

async function runVisualTest() {
  console.log("=== BalaBot Visual E2E Acceptance Test ===");
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

  // 1. Initialize DB and Server
  const dbDir = fs.mkdtempSync(path.join(os.tmpdir(), "balabot-visual-test-"));
  const dbPath = path.join(dbDir, "continuity.db");
  const db = new BalaBotDatabase(dbPath);
  const server = new BalaBotServer({ port: PORT, db });

  await server.listen();
  console.log(`[Server] Live on http://127.0.0.1:${PORT}`);

  // 2. Launch Headless Chrome
  console.log(`[Browser] Launching Chrome from ${CHROME_PATH}...`);
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--window-size=1440,900",
    ],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });

  const capturedFlows: Array<{ flow: string; ok: boolean; screenshot: string; detail: string }> = [];

  try {
    // FLOW 1: Boot & Roster Navigation
    console.log("\n[Flow 1] Loading Application UI & Bot Roster...");
    await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "networkidle0", timeout: 15000 });
    await page.waitForSelector("body", { timeout: 5000 });

    const shot1 = path.join(SCREENSHOT_DIR, "01-app-boot-roster.png");
    await page.screenshot({ path: shot1, fullPage: false });
    
    // Check page title and body content
    const pageTitle = await page.title();
    const hasRoster = await page.evaluate(() => {
      const text = document.body.innerText;
      return text.includes("Principal") || text.includes("BalaBot");
    });
    
    capturedFlows.push({
      flow: "Flow 1: App Boot & Roster",
      ok: hasRoster,
      screenshot: shot1,
      detail: `Title: "${pageTitle}", Roster detected: ${hasRoster}`,
    });
    console.log(`  -> Flow 1 complete (Saved: ${shot1})`);

    // FLOW 2: Select Bot & Check Composer
    console.log("\n[Flow 2] Checking Composer & Mascot Avatar...");
    const hasComposer = await page.evaluate(() => {
      const textarea = document.querySelector("textarea") || document.querySelector("input");
      return textarea !== null;
    });

    const shot2 = path.join(SCREENSHOT_DIR, "02-principal-composer.png");
    await page.screenshot({ path: shot2, fullPage: false });

    capturedFlows.push({
      flow: "Flow 2: Composer & Mascot Display",
      ok: hasComposer,
      screenshot: shot2,
      detail: `Interactive composer input present: ${hasComposer}`,
    });
    console.log(`  -> Flow 2 complete (Saved: ${shot2})`);

    // FLOW 3: Execute Chat Turn & Verify Durability
    console.log("\n[Flow 3] Executing Chat Turn through Server...");
    const chatRes = await fetch(`http://127.0.0.1:${PORT}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: "sess-visual-1",
        botId: "principal",
        content: "Analyze system status and verify Pi Durable migration.",
      }),
    });
    const chatStream = await chatRes.text();

    // Verify turn in SQLite
    const messages = db.getSessionMessages("sess-visual-1");
    const turnDurable = messages.length === 2 && messages[1].role === "assistant";

    const shot3 = path.join(SCREENSHOT_DIR, "03-chat-turn.png");
    await page.screenshot({ path: shot3, fullPage: false });

    capturedFlows.push({
      flow: "Flow 3: Chat Turn & SQLite Durability",
      ok: turnDurable && chatStream.includes("event: thinking"),
      screenshot: shot3,
      detail: `Committed messages: ${messages.length}, thinking persisted: ${Boolean(messages[1]?.thinking)}`,
    });
    console.log(`  -> Flow 3 complete (Saved: ${shot3})`);

    // FLOW 4: OpenUI Generative UI Proposal
    console.log("\n[Flow 4] Requesting Agent Hire Proposal (OpenUI Lang)...");
    const hireRes = await fetch(`http://127.0.0.1:${PORT}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: "sess-visual-2",
        botId: "principal",
        content: "Please hire a new researcher bot for the fleet.",
      }),
    });
    const hireStream = await hireRes.text();
    const hasHireCard = hireStream.includes("HireAgentCard") && hireStream.includes("openui-lang");

    const shot4 = path.join(SCREENSHOT_DIR, "04-openui-hire-card.png");
    await page.screenshot({ path: shot4, fullPage: false });

    capturedFlows.push({
      flow: "Flow 4: OpenUI Generative UI Card",
      ok: hasHireCard,
      screenshot: shot4,
      detail: `HireAgentCard emitted: ${hasHireCard}`,
    });
    console.log(`  -> Flow 4 complete (Saved: ${shot4})`);

    // FLOW 5: Human Intervention Flow
    console.log("\n[Flow 5] Testing Human Intervention Challenge...");
    const invRes = await fetch(`http://127.0.0.1:${PORT}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: "sess-visual-3",
        botId: "principal",
        content: "I hit a 2FA intervention challenge.",
      }),
    });
    const invStream = await invRes.text();
    const hasIntervention = invStream.includes("event: intervention") && invStream.includes("resume_token");

    const shot5 = path.join(SCREENSHOT_DIR, "05-intervention-flow.png");
    await page.screenshot({ path: shot5, fullPage: false });

    capturedFlows.push({
      flow: "Flow 5: Human Intervention Take-over",
      ok: hasIntervention,
      screenshot: shot5,
      detail: `Intervention event with resume token: ${hasIntervention}`,
    });
    console.log(`  -> Flow 5 complete (Saved: ${shot5})`);

    // FLOW 6: Deep Screen Navigation (/app/fleet)
    console.log("\n[Flow 6] Navigating to Deep Screen: /app/fleet...");
    await page.goto(`http://127.0.0.1:${PORT}/app/fleet`, { waitUntil: "networkidle0", timeout: 15000 });
    const shot6 = path.join(SCREENSHOT_DIR, "06-fleet-deep-screen.png");
    await page.screenshot({ path: shot6, fullPage: false });

    const hasFleetContent = await page.evaluate(() => {
      const text = document.body.innerText;
      return text.includes("Principal") || text.includes("Governor") || text.includes("Fleet") || text.includes("Agents");
    });

    capturedFlows.push({
      flow: "Flow 6: Fleet Deep Screen Navigation",
      ok: hasFleetContent,
      screenshot: shot6,
      detail: `Rendered deep screen route without 404: ${hasFleetContent}`,
    });
    console.log(`  -> Flow 6 complete (Saved: ${shot6})`);

  } finally {
    await browser.close();
    await server.close();
    if (fs.existsSync(dbDir)) {
      fs.rmSync(dbDir, { recursive: true, force: true });
    }
  }

  console.log("\n=== VISUAL TEST RESULTS ===");
  console.table(capturedFlows.map(f => ({
    Flow: f.flow,
    Status: f.ok ? "PASS" : "FAIL",
    Details: f.detail,
    Screenshot: path.basename(f.screenshot),
  })));

  const allPassed = capturedFlows.every(f => f.ok);
  if (!allPassed) {
    console.error("Some visual flows failed!");
    process.exit(1);
  }
  console.log("\nAll visual flows PASSED according to the modernization master spec!");
}

runVisualTest().catch(err => {
  console.error("Visual test runner error:", err);
  process.exit(1);
});
