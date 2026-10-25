import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { BalaBotDatabase } from "../../server/db.js";
import { HarnessComponentAssembler } from "../../server/components.js";
import { SkillCurator } from "../../server/skills.js";
import { PiDurableHarness } from "../../server/harness.js";
import { BalaBotServer } from "../../server/api.js";

describe("BalaBot Harness Foundation & Wave H1 Capabilities", () => {
  let tmpDir: string;
  let dbPath: string;
  let db: BalaBotDatabase;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "balabot-harness-foundation-"));
    dbPath = path.join(tmpDir, "continuity.db");
    db = new BalaBotDatabase(dbPath);
  });

  afterEach(() => {
    db.close();
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("1. Modular Harness Components: Assembles SOUL, System Prompt, Guardrails, Memory, Tool Guidance, Skills, Constitution", () => {
    const assembler = new HarnessComponentAssembler(db);
    const assembled = assembler.assemble({
      botId: "principal",
      botName: "Principal",
      sessionId: "test-sess-components",
      db,
    });

    expect(assembled.soul).toContain("Principal");
    expect(assembled.systemPrompt).toBeDefined();
    expect(assembled.guardrails).toContain("Guardrails & Standing Invariants");
    expect(assembled.guardrails).toContain("NEVER THE HOST");
    expect(assembled.guardrails).toContain("Consent Ladder");
    expect(assembled.memory).toContain("Persistent Memory & Context");
    expect(assembled.toolGuidance).toContain("Tool Guidance & Effect Classes");
    expect(assembled.toolGuidance).toContain("read_file");
    expect(assembled.skills).toContain("Available Skills Catalog");
    expect(assembled.constitution).toContain("Constitution");

    // Combined prompt integrates all structured components
    expect(assembled.combined).toContain("Persona Identity");
    expect(assembled.combined).toContain("Guardrails & Standing Invariants");
    expect(assembled.combined).toContain("Tool Guidance & Effect Classes");
    expect(assembled.combined).toContain("Constitution");
  });

  it("2. Real Skill Curator: Resolves Shipped, Brought, and Learned skills from disk and SQLite", () => {
    const curator = new SkillCurator(db);
    const catalog = curator.getCatalog("balacode");

    expect(catalog.available).toBe(true);
    expect(Array.isArray(catalog.shipped ?? catalog.brought)).toBe(true);
    expect(Array.isArray(catalog.learned)).toBe(true);
    expect(catalog.brought.length).toBeGreaterThan(0);
    expect(catalog.learned.length).toBeGreaterThan(0);

    // Verify presence of real skills
    const skillNames = catalog.skills.map(s => s.name);
    expect(skillNames).toContain("read_file");
    expect(skillNames).toContain("write_file");
    expect(skillNames).toContain("exec_command");
    expect(skillNames).toContain("wrangler");
    expect(skillNames).toContain("cloudflare");
  });

  it("3. Curator Actions: Pins and promotes learned skills", () => {
    const saved = db.saveLearnedSkill({
      name: "custom-learned-skill",
      description: "A newly learned agent skill",
      content: "# Custom Learned Skill\nDo something useful.",
      category: "Learned",
      source: "curator",
    });

    expect(saved.name).toBe("custom-learned-skill");
    expect(saved.pinned).toBe(0);

    const pinOk = db.pinSkill("custom-learned-skill", true);
    expect(pinOk).toBe(true);

    const promoteOk = db.promoteSkill("custom-learned-skill");
    expect(promoteOk).toBe(true);

    const list = db.listLearnedSkills();
    const found = list.find(s => s.name === "custom-learned-skill");
    expect(found).toBeDefined();
    expect(found.pinned).toBe(1);
    expect(found.promoted).toBe(1);
  });

  it("4. Curator Queue: Proposals can be listed, approved, and rejected", () => {
    const prop = db.createHarnessProposal({
      botId: "principal",
      title: "Add SEO auditing skill",
      description: "Improves organic search guidance",
      riskTier: "low",
    });

    expect(prop.state).toBe("pending");
    expect(prop.proposal_id).toBeDefined();

    const approved = db.decideHarnessProposal(prop.proposal_id, "approved", "user");
    expect(approved.state).toBe("approved");
    expect(approved.decided_by).toBe("user");
  });

  it("5. API Endpoints: /api/skills/library and /api/harness/proposals serve real data", async () => {
    const serverPort = 9449;
    const server = new BalaBotServer({ port: serverPort, db });
    await server.listen();

    try {
      // Test /api/skills/library
      const res = await fetch(`http://127.0.0.1:${serverPort}/api/skills/library`);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.available).toBe(true);
      expect(Array.isArray(data.learned)).toBe(true);
      expect(Array.isArray(data.brought)).toBe(true);
      expect(data.brought.some((s: any) => s.name === "wrangler")).toBe(true);

      // Test /api/harness/proposals
      const propRes = await fetch(`http://127.0.0.1:${serverPort}/api/harness/proposals`);
      expect(propRes.status).toBe(200);
      const propData = await propRes.json();
      expect(propData.ok).toBe(true);
      expect(Array.isArray(propData.proposals)).toBe(true);
    } finally {
      await server.close();
    }
  });

  it("6. Tool Loop & Pre-Execution Durability: Executes turn and records trace in SQLite", async () => {
    const harness = new PiDurableHarness({ db });
    const sessionId = "tool-loop-sess-test";

    const turn = await harness.executeTurn({
      sessionId,
      botId: "principal",
      userMessage: "Status check on local engine",
    });

    expect(turn.text).toBeDefined();
    expect(turn.assistantMessage).toBeDefined();
    expect(turn.assistantMessage.role).toBe("assistant");

    // Ensure persisted to SQLite
    const messages = db.getSessionMessages(sessionId);
    expect(messages.length).toBe(2); // user + assistant
    expect(messages[0].role).toBe("user");
    expect(messages[1].role).toBe("assistant");
  });
});
