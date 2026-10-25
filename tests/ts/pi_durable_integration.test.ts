import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { BalaBotDatabase } from "../../server/db.js";
import { JevClient, JevNotConfigured } from "../../server/jev.js";
import { LocalToolBridge } from "../../server/bridge.js";
import { PiDurableHarness } from "../../server/harness.js";
import { BalaBotServer } from "../../server/api.js";

describe("Pi Durable Core Engine & System Integration (Waves 2, 3, 5)", () => {
  let tmpDir: string;
  let dbPath: string;
  let db: BalaBotDatabase;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "balabot-core-test-"));
    dbPath = path.join(tmpDir, "continuity.db");
    db = new BalaBotDatabase(dbPath);
  });

  afterEach(() => {
    db.close();
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  describe("Wave 2: SQLite Unified Persistence & Session Contracts", () => {
    it("enforces session continuity with topic span extend vs split rules", () => {
      db.createSession("sess-100", "principal", "Fleet Coordination");

      // Appending same topic extends end_seq
      const span1 = db.appendTopic("sess-100", "roster-audit", 1);
      expect(span1.start_seq).toBe(1);
      expect(span1.end_seq).toBe(1);

      const span1Extended = db.appendTopic("sess-100", "roster-audit", 4);
      expect(span1Extended.start_seq).toBe(1);
      expect(span1Extended.end_seq).toBe(4);

      // Appending different topic closes span1 and opens span2
      const span2 = db.appendTopic("sess-100", "policy-check", 5);
      expect(span2.start_seq).toBe(5);
      expect(span2.end_seq).toBe(5);

      const allSpans = db.getTopicSpans("sess-100");
      expect(allSpans.length).toBe(2);
      expect(allSpans[0].topic).toBe("roster-audit");
      expect(allSpans[0].end_seq).toBe(4);
      expect(allSpans[1].topic).toBe("policy-check");
      expect(allSpans[1].start_seq).toBe(5);
    });

    it("enforces FIFO ordering and at-most-once delivery in transactional inbox", () => {
      db.enqueueInbox({ agentId: "scout", messageType: "follow_up", payload: "First item" });
      db.enqueueInbox({ agentId: "scout", messageType: "follow_up", payload: "Second item" });

      const batch1 = db.drainInbox("scout");
      expect(batch1.length).toBe(2);
      expect(batch1[0].payload).toBe("First item");
      expect(batch1[1].payload).toBe("Second item");

      // Calling drain again returns zero items because items were claimed (at-most-once)
      const batch2 = db.drainInbox("scout");
      expect(batch2.length).toBe(0);

      // Mark delivered
      db.markInboxDelivered(batch1[0].message_id);
      const item = db.getInboxItem(batch1[0].message_id);
      expect(item?.handled).toBe(1);
      expect(item?.delivered_at).not.toBeNull();
    });

    it("enforces agent hierarchy: shipped bots (principal, governor) reject deletion with 409", () => {
      const fleet = db.getFleet();
      const botIds = fleet.map(b => b.bot_id);
      expect(botIds).toContain("principal");
      expect(botIds).toContain("governor");

      // Attempt to delete principal
      const delPrincipal = db.deleteBot("principal");
      expect(delPrincipal.success).toBe(false);
      expect(delPrincipal.status).toBe(409);

      // User created persistent bot can be deleted
      db.createBot({
        bot_id: "custom-analyst",
        name: "Custom Analyst",
        title: "Market Analyst",
        icon: "ChartBarIcon",
        color: "teal",
        role_class: "persistent",
        created_by: "user",
        config_json: "{}",
      });

      const delCustom = db.deleteBot("custom-analyst");
      expect(delCustom.success).toBe(true);
      expect(db.getBot("custom-analyst")).toBeNull();
    });
  });

  describe("Wave 3: Jev System 1 Pipeline (Frustration, Decision Gate, Fail-Loud)", () => {
    it("fails loud in cloud mode when TYPESAFE_API_KEY is missing", async () => {
      const cloudJev = new JevClient({ apiKey: "", mode: "cloud" });
      await expect(cloudJev.isDecisionWorthy("We ratified the new model")).rejects.toThrow(JevNotConfigured);
    });

    it("detects frustration signals with exclusion filters in offline heuristic mode", async () => {
      const jev = new JevClient({ mode: "heuristic" });

      // Clean neutral statement
      const clean = await jev.evaluateFrustration("Please summarize the repo commits.");
      expect(clean.answer).toBe(false);

      // Exclusion list word overrides marker (e.g. "Anyways")
      const excluded = await jev.evaluateFrustration("Anyways, wrong answer but let's move on.");
      expect(excluded.answer).toBe(false);

      // Real frustration signal
      const frustrated = await jev.evaluateFrustration("This is broken and completely useless, stop wasting my time!");
      expect(frustrated.answer).toBe(true);
      expect(frustrated.probability).toBeGreaterThanOrEqual(0.6);
    });

    it("evaluates decision gates correctly", async () => {
      const jev = new JevClient({ mode: "heuristic" });

      const ordinary = await jev.isDecisionWorthy("What is the weather today?");
      expect(ordinary.answer).toBe(false);

      const decision = await jev.isDecisionWorthy("I have decided we will adopt Pi Durable for all future agents.");
      expect(decision.answer).toBe(true);
      expect(decision.probability).toBeGreaterThanOrEqual(0.8);
    });
  });

  describe("Wave 5: Reverse RPC Tool Bridge & NEVER THE HOST Desktop Law", () => {
    it("strictly blocks synthetic mouse/keyboard injection tools under NEVER THE HOST law", async () => {
      const bridge = new LocalToolBridge({ allowedWorkspaces: [tmpDir] });

      for (const banned of ["xdotool", "uinput", "SendInput", "CGEvent", "cliclick", "pyautogui"]) {
        await expect(bridge.executeAction({
          action: "run_command",
          executable: banned,
          args: ["key", "Return"],
          cwd: tmpDir,
        })).rejects.toThrow(/NEVER THE HOST Desktop Law Violation/);
      }
    });

    it("denies raw shell string execution ('-c') to prevent unsanitized injection", async () => {
      const bridge = new LocalToolBridge({ allowedWorkspaces: [tmpDir] });

      await expect(bridge.executeAction({
        action: "run_command",
        executable: "bash",
        args: ["-c", "rm -rf /"],
        cwd: tmpDir,
      })).rejects.toThrow(/Raw shell string execution/);
    });

    it("enforces workspace jailing against path traversal", async () => {
      const bridge = new LocalToolBridge({ allowedWorkspaces: [tmpDir] });

      await expect(bridge.executeAction({
        action: "read_file",
        path: "../../../../../etc/passwd",
        cwd: tmpDir,
      })).rejects.toThrow(/outside workspace jail/);
    });

    it("executes safe commands and read/write within jailed workspace", async () => {
      const bridge = new LocalToolBridge({ allowedWorkspaces: [tmpDir] });

      // Write file
      const writeRes = await bridge.executeAction({
        action: "write_file",
        path: "test-note.txt",
        content: "Verified Pi Durable Jailing",
        cwd: tmpDir,
      });
      expect(writeRes.exit_code).toBe(0);

      // Read file
      const readRes = await bridge.executeAction({
        action: "read_file",
        path: "test-note.txt",
        cwd: tmpDir,
      });
      expect(readRes.stdout).toBe("Verified Pi Durable Jailing");
    });
  });

  describe("End-to-End Local API Server Integration", () => {
    let server: BalaBotServer;
    const testPort = 9229;

    beforeEach(async () => {
      server = new BalaBotServer({ port: testPort, db });
      await server.listen();
    });

    afterEach(async () => {
      await server.close();
    });

    it("responds to /healthz with engine: pi-durable", async () => {
      const res = await fetch(`http://127.0.0.1:${testPort}/healthz`);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.engine).toBe("pi-durable");
      expect(data.mode).toBe("local");
    });

    it("streams chat turn with pre-execution journaling and thinking tokens", async () => {
      const res = await fetch(`http://127.0.0.1:${testPort}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: "sess-e2e-1",
          botId: "principal",
          content: "Hello Principal, verify readiness.",
        }),
      });

      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/event-stream");

      const text = await res.text();
      expect(text).toContain("event: thinking");
      expect(text).toContain("event: text");

      // Verify that the turn was durably committed to SQLite before finishing
      const messages = db.getSessionMessages("sess-e2e-1");
      expect(messages.length).toBe(2);
      expect(messages[0].role).toBe("user");
      expect(messages[0].content).toBe("Hello Principal, verify readiness.");
      expect(messages[1].role).toBe("assistant");
      expect(messages[1].thinking).toBeTruthy();
    });
  });
});
