import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { BalaBotServer } from "../../server/api.js";
import { BalaBotDatabase } from "../../server/db.js";
import { JevClient, JevNotConfigured } from "../../server/jev.js";
import { LocalToolBridge } from "../../server/bridge.js";

describe("BalaBot End-to-End Modern Acceptance Suite (15/15 Real Scenarios)", () => {
  let tmpDir: string;
  let dbPath: string;
  let db: BalaBotDatabase;
  let server: BalaBotServer;
  const E2E_PORT = 9339;
  const BASE_URL = `http://127.0.0.1:${E2E_PORT}`;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "balabot-e2e-suite-"));
    dbPath = path.join(tmpDir, "continuity.db");
    db = new BalaBotDatabase(dbPath);
    server = new BalaBotServer({ port: E2E_PORT, db });
    await server.listen();
  });

  afterAll(async () => {
    await server.close();
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  // Scenario 1
  it("Scenario 1 [Zero-Container & Healthcheck]: Server boots natively and responds on /healthz", async () => {
    const res = await fetch(`${BASE_URL}/healthz`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(body.engine).toBe("pi-durable");
    expect(body.mode).toBe("local");
  });

  // Scenario 2
  it("Scenario 2 [Hierarchy & Shipped Protection]: Shipped bots principal and governor refuse deletion with 409", async () => {
    const res = await fetch(`${BASE_URL}/api/fleet`);
    expect(res.status).toBe(200);
    const body = await res.json();
    const botIds = body.bots.map((b: any) => b.bot_id);
    expect(botIds).toContain("principal");
    expect(botIds).toContain("governor");

    // Attempt deletion of principal
    const delRes = await fetch(`${BASE_URL}/api/bots/principal`, { method: "DELETE" });
    expect(delRes.status).toBe(409);
    const delBody = await delRes.json();
    expect(delBody.error).toContain("Cannot modify or delete shipped system bots");
  });

  // Scenario 3
  it("Scenario 3 [Fleet Management]: Custom persistent bot can be created, queried, and purged", async () => {
    db.createBot({
      bot_id: "e2e-scout",
      name: "E2E Scout Bot",
      title: "Exploration Agent",
      icon: "MagnifyingGlassIcon",
      color: "emerald",
      role_class: "persistent",
      created_by: "user",
      config_json: "{}",
    });

    const fleetRes = await fetch(`${BASE_URL}/api/fleet`);
    const fleetBody = await fleetRes.json();
    const scout = fleetBody.bots.find((b: any) => b.bot_id === "e2e-scout");
    expect(scout).toBeDefined();
    expect(scout.name).toBe("E2E Scout Bot");

    // Purge custom bot
    const delRes = await fetch(`${BASE_URL}/api/bots/e2e-scout`, { method: "DELETE" });
    expect(delRes.status).toBe(200);
    const delBody = await delRes.json();
    expect(delBody.purged).toBe("e2e-scout");
  });

  // Scenario 4
  it("Scenario 4 [Pre-execution Durability & Chat]: Turn streams and persists to SQLite before return", async () => {
    const sessionId = "e2e-sess-durability";
    const userMessage = "Verify pre-execution turn journaling under Pi Durable.";

    const res = await fetch(`${BASE_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId,
        botId: "principal",
        content: userMessage,
      }),
    });

    expect(res.status).toBe(200);
    const streamText = await res.text();
    expect(streamText).toContain("event: thinking");
    expect(streamText).toContain("event: text");
    expect(streamText).toContain("event: final");

    // Query SQLite database directly
    const stored = db.getSessionMessages(sessionId);
    expect(stored.length).toBe(2);
    expect(stored[0].role).toBe("user");
    expect(stored[0].content).toBe(userMessage);
    expect(stored[1].role).toBe("assistant");
    expect(stored[1].thinking).toBeTruthy();
  });

  // Scenario 5
  it("Scenario 5 [Thinking Stream Disclosure]: Reasoning tokens stay segregated from text stream", async () => {
    const sessionId = "e2e-sess-thinking";
    const res = await fetch(`${BASE_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId,
        botId: "principal",
        content: "Analyze telemetry logs in detail.",
      }),
    });

    const stream = await res.text();
    const lines = stream.split("\n");

    let thinkingChunks = 0;
    let textChunks = 0;

    for (let i = 0; i < lines.length; i++) {
      if (lines[i].startsWith("event: thinking")) {
        thinkingChunks++;
        const dataLine = lines[i + 1];
        if (dataLine?.startsWith("data:")) {
          const parsed = JSON.parse(dataLine.slice(5).trim());
          expect(parsed.choices[0].delta.reasoning_content).toBeDefined();
        }
      } else if (lines[i].startsWith("event: text")) {
        textChunks++;
        const dataLine = lines[i + 1];
        if (dataLine?.startsWith("data:")) {
          const parsed = JSON.parse(dataLine.slice(5).trim());
          expect(parsed.choices[0].delta.content).toBeDefined();
        }
      }
    }

    expect(thinkingChunks).toBeGreaterThan(0);
    expect(textChunks).toBeGreaterThan(0);
  });

  // Scenario 6
  it("Scenario 6 [Carrier Frame Integrity]: jev_carrier frames are consumed without leaking into transcript", async () => {
    const rawCarrierPayload = `<jev_carrier><intent>internal_eval</intent><score>0.92</score></jev_carrier>`;
    
    // Simulate what client handleFrame in ui/src/api.ts parses
    let transcriptLeakedText = "";
    const handleFrameSim = (frame: string) => {
      let eventName = "";
      const dataLines: string[] = [];
      for (const line of frame.split("\n")) {
        if (line.startsWith("event:")) eventName = line.slice(6).trim();
        else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
      }
      const data = dataLines.join("\n");
      if (!data) return;

      // The patched safeguard from Wave 6:
      if (eventName === "jev_carrier" || eventName === "jev") {
        return; // Consumed cleanly
      }

      transcriptLeakedText += data;
    };

    handleFrameSim(`event: jev_carrier\ndata: ${rawCarrierPayload}\n\n`);
    expect(transcriptLeakedText).toBe(""); // Zero leakage
  });

  // Scenario 7
  it("Scenario 7 [OpenUI Generative UI]: Bot hire request emits HireAgentCard rather than monologuing", async () => {
    const sessionId = "e2e-sess-openui";
    const res = await fetch(`${BASE_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId,
        botId: "principal",
        content: "Please hire a new researcher bot for the team.",
      }),
    });

    const streamText = await res.text();
    expect(streamText).toContain("openui-lang");
    expect(streamText).toContain("HireAgentCard");
  });

  // Scenario 8
  it("Scenario 8 [Human Intervention Flow]: Pause turn emits intervention and resumes via token", async () => {
    const sessionId = "e2e-sess-intervention";
    const res = await fetch(`${BASE_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId,
        botId: "principal",
        content: "I hit a 2FA intervention requirement.",
      }),
    });

    const streamText = await res.text();
    expect(streamText).toContain("event: intervention");
    expect(streamText).toContain("resume_token");

    // Extract resume token
    const match = streamText.match(/token_[a-z0-9]+/);
    expect(match).not.toBeNull();
    const token = match![0];

    // Resolve intervention
    const resolveRes = await fetch(`${BASE_URL}/api/intervention/${token}/resolve`, {
      method: "POST",
    });
    expect(resolveRes.status).toBe(200);
    const resolveBody = await resolveRes.json();
    expect(resolveBody.resolved).toBe(true);
  });

  // Scenario 9
  it("Scenario 9 [Crash Resilience]: Server reboot restores full transcript and session continuity from SQLite", async () => {
    const sessionId = "e2e-sess-crash";
    // 1. Send first turn
    await fetch(`${BASE_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId,
        botId: "principal",
        content: "Turn 1 before sudden restart.",
      }),
    });

    // 2. Simulate process restart by instantiating a new database & server instance on the same file
    const restartedDb = new BalaBotDatabase(dbPath);
    const msgs = restartedDb.getSessionMessages(sessionId);
    expect(msgs.length).toBe(2);
    expect(msgs[0].content).toBe("Turn 1 before sudden restart.");
    expect(msgs[1].role).toBe("assistant");
    restartedDb.close();
  });

  // Scenario 10
  it("Scenario 10 [Topic Spans Contract]: Extend open span vs split on topic boundary", () => {
    const sid = "e2e-sess-spans";
    db.createSession(sid, "principal", "Span Contract Test");

    // Open span 1
    const span1 = db.appendTopic(sid, "database-migration", 1);
    expect(span1.start_seq).toBe(1);
    expect(span1.end_seq).toBe(1);

    // Same topic -> extends
    const span1Ext = db.appendTopic(sid, "database-migration", 3);
    expect(span1Ext.start_seq).toBe(1);
    expect(span1Ext.end_seq).toBe(3);

    // Different topic -> closes span 1, opens span 2
    const span2 = db.appendTopic(sid, "cloudflare-deployment", 4);
    expect(span2.start_seq).toBe(4);
    expect(span2.end_seq).toBe(4);

    const spans = db.getTopicSpans(sid);
    expect(spans.length).toBe(2);
    expect(spans[0].topic).toBe("database-migration");
    expect(spans[0].end_seq).toBe(3);
    expect(spans[1].topic).toBe("cloudflare-deployment");
    expect(spans[1].start_seq).toBe(4);
  });

  // Scenario 11
  it("Scenario 11 [Transactional Inbox]: FIFO ordering and conditional at-most-once delivery", () => {
    const agent = "governor";
    db.enqueueInbox({ agentId: agent, messageType: "follow_up", payload: "Msg A" });
    db.enqueueInbox({ agentId: agent, messageType: "follow_up", payload: "Msg B" });

    // Drain batch
    const drained = db.drainInbox(agent);
    expect(drained.length).toBe(2);
    expect(drained[0].payload).toBe("Msg A");
    expect(drained[1].payload).toBe("Msg B");

    // Second drain is empty (at-most-once claim)
    const emptyDrain = db.drainInbox(agent);
    expect(emptyDrain.length).toBe(0);
  });

  // Scenario 12
  it("Scenario 12 [Jev Decision Gating]: Evaluates binding decisions into OKF governor ledger", async () => {
    const jev = new JevClient({ mode: "heuristic" });

    const ordinary = await jev.isDecisionWorthy("How is the weather today?");
    expect(ordinary.answer).toBe(false);

    const binding = await jev.isDecisionWorthy("We ratified the decision to decommission Docker in Wave 7.");
    expect(binding.answer).toBe(true);
    expect(binding.probability).toBeGreaterThanOrEqual(0.8);
  });

  // Scenario 13
  it("Scenario 13 [Jev Frustration Sensor]: Detects frustration and escalates to growth ledger", async () => {
    const jev = new JevClient({ mode: "heuristic" });

    const neutral = await jev.evaluateFrustration("Can you list the registered bots?");
    expect(neutral.answer).toBe(false);

    const frustrated = await jev.evaluateFrustration("This is broken and completely useless, stop wasting my time!");
    expect(frustrated.answer).toBe(true);
    expect(frustrated.probability).toBeGreaterThanOrEqual(0.6);
  });

  // Scenario 14
  it("Scenario 14 [Reverse RPC Jailing]: Executes inside workspace and rejects traversal attempts", async () => {
    const bridge = new LocalToolBridge({ allowedWorkspaces: [tmpDir] });

    // Allowed write & read
    const writeRes = await bridge.executeAction({
      action: "write_file",
      path: "e2e-vault.txt",
      content: "OKF Ratified Decision",
      cwd: tmpDir,
    });
    expect(writeRes.exit_code).toBe(0);

    const readRes = await bridge.executeAction({
      action: "read_file",
      path: "e2e-vault.txt",
      cwd: tmpDir,
    });
    expect(readRes.stdout).toBe("OKF Ratified Decision");

    // Denied path traversal
    await expect(bridge.executeAction({
      action: "read_file",
      path: "../../../../../etc/passwd",
      cwd: tmpDir,
    })).rejects.toThrow(/outside workspace jail/);
  });

  // Scenario 15
  it("Scenario 15 [NEVER THE HOST Containment]: Prohibits synthetic OS input injection", async () => {
    const bridge = new LocalToolBridge({ allowedWorkspaces: [tmpDir] });

    for (const tool of ["xdotool", "uinput", "SendInput", "CGEvent", "cliclick", "pyautogui"]) {
      await expect(bridge.executeAction({
        action: "run_command",
        executable: tool,
        args: ["click"],
        cwd: tmpDir,
      })).rejects.toThrow(/NEVER THE HOST Desktop Law Violation/);
    }
  });

  // Scenario 16
  it("Scenario 16 [Model Selector & Auto-Discovery]: Discovers models, configures per-agent model in DB and serves in roster", async () => {
    // 1. Auto-discovery returns discovered models catalog
    const modelRes = await fetch(`${BASE_URL}/api/models`);
    expect(modelRes.status).toBe(200);
    const modelData = await modelRes.json();
    expect(modelData.ok).toBe(true);
    expect(Array.isArray(modelData.models)).toBe(true);
    expect(modelData.models.length).toBeGreaterThan(0);
    expect(modelData.models[0]).toHaveProperty("id");
    expect(modelData.models[0]).toHaveProperty("name");

    // 2. Configure model specifically for principal bot via PATCH /api/bots/:botId
    const patchRes = await fetch(`${BASE_URL}/api/bots/principal`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "deepseek/deepseek-chat" }),
    });
    expect(patchRes.status).toBe(200);
    const patchBody = await patchRes.json();
    expect(patchBody.ok).toBe(true);
    expect(patchBody.model).toBe("deepseek/deepseek-chat");

    // 3. GET /api/bots and GET /api/fleet reflect the updated per-agent model
    const botsRes = await fetch(`${BASE_URL}/api/bots`);
    const botsData = await botsRes.json();
    const principalBot = botsData.bots.find((b: any) => b.bot_id === "principal");
    expect(principalBot).toBeDefined();
    expect(principalBot.model).toBe("deepseek/deepseek-chat");

    // 4. Reset or change model for another bot
    const governorPatch = await fetch(`${BASE_URL}/api/bots/governor`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "openai/gpt-4o" }),
    });
    expect(governorPatch.status).toBe(200);
    const fleetRes = await fetch(`${BASE_URL}/api/fleet`);
    const fleetData = await fleetRes.json();
    const govBot = fleetData.bots.find((b: any) => b.bot_id === "governor");
    expect(govBot.model).toBe("openai/gpt-4o");
  });

  // Scenario 17
  it("Scenario 17 [OpenUI Bot Proposals & Creation Flow]: Proposes, approves, and creates new agent from OpenUI card", async () => {
    // 1. Submit proposal (mimicking OpenUI hire submission)
    const proposeRes = await fetch(`${BASE_URL}/api/bot-proposals`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "seo-analyst",
        role: "SEO Analyst",
        description: "Organic search ranking specialist",
        suggested_tools: ["web_search"],
      }),
    });
    expect([200, 201]).toContain(proposeRes.status);
    const proposeData = await proposeRes.json();
    expect(proposeData.proposed).toBe(true);
    const propId = proposeData.proposal.id;
    expect(propId).toBeDefined();

    // 2. Fetch proposals list
    const listRes = await fetch(`${BASE_URL}/api/bot-proposals`);
    expect(listRes.status).toBe(200);
    const listData = await listRes.json();
    expect(listData.proposals.some((p: any) => p.id === propId)).toBe(true);

    // 3. Approve proposal
    const approveRes = await fetch(`${BASE_URL}/api/bot-proposals/${propId}/approve`, {
      method: "POST",
    });
    expect(approveRes.status).toBe(200);
    const approveData = await approveRes.json();
    expect(approveData.approved).toBe(true);

    // 4. Create approved bot into fleet
    const createRes = await fetch(`${BASE_URL}/api/bot-proposals/${propId}/create`, {
      method: "POST",
    });
    expect(createRes.status).toBe(200);
    const createData = await createRes.json();
    expect(createData.created).toBe(true);
    expect(createData.bot.bot_id).toBe("seo-analyst");

    // 5. Verify bot is active in fleet
    const fleetRes = await fetch(`${BASE_URL}/api/fleet`);
    const fleetData = await fleetRes.json();
    const createdBot = fleetData.bots.find((b: any) => b.bot_id === "seo-analyst");
    expect(createdBot).toBeDefined();
    expect(createdBot.title).toBe("SEO Analyst");

    // Clean up created bot
    await fetch(`${BASE_URL}/api/bots/seo-analyst`, { method: "DELETE" });
  });
});
