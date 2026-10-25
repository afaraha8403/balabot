/**
 * BalaBot Modular Harness Component Assembler
 *
 * Implements the component breakdown specified in docs/kb/plans/harness-recursion.md:
 *   1. SOUL.md — frozen persona voice and identity
 *   2. System Prompt — role guidelines and mission (from AGENTS.md / systemprompt.md)
 *   3. Guardrails — standing safety invariants and consent ladders
 *   4. Memory — persistent curated domain facts and active session context
 *   5. Tool Guidance — tool descriptions, effect classes, and OpenUI Generative UI rules
 *   6. Skills — catalog of active skills available for invoke
 *   7. Constitution — non-negotiable bedrock rules
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { BalaBotDatabase } from "./db.js";
import { SkillCurator } from "./skills.js";

export interface HarnessAssemblyOptions {
  botId: string;
  botName: string;
  sessionId?: string;
  db: BalaBotDatabase;
}

export interface AssembledHarness {
  soul: string;
  systemPrompt: string;
  guardrails: string;
  memory: string;
  toolGuidance: string;
  skills: string;
  constitution: string;
  combined: string;
}

export class HarnessComponentAssembler {
  private db: BalaBotDatabase;
  private curator: SkillCurator;

  constructor(db: BalaBotDatabase) {
    this.db = db;
    this.curator = new SkillCurator(db);
  }

  public assemble(options: HarnessAssemblyOptions): AssembledHarness {
    const { botId, botName, sessionId } = options;
    const cwd = process.cwd();

    // 1. SOUL.md — frozen identity & voice
    const soulPath = path.resolve(cwd, "personas", botId, "SOUL.md");
    let soul = fs.existsSync(soulPath) ? fs.readFileSync(soulPath, "utf-8").trim() : `You are ${botName}, a trusted BalaBot agent.`;

    // 2. System Prompt — role instructions & domain mission (from AGENTS.md)
    const agentsPath = path.resolve(cwd, "personas", botId, "AGENTS.md");
    let systemPrompt = fs.existsSync(agentsPath) ? fs.readFileSync(agentsPath, "utf-8").trim() : `Operate as ${botName} on the Pi Durable engine.`;

    // 3. Guardrails — standing safety invariants
    const guardrails = [
      "## Guardrails & Standing Invariants",
      "- **Consent Ladder:** Propose before any irreversible action (sending, spending, deleting, publishing). The human owner always approves.",
      "- **NEVER THE HOST Desktop Law:** Zero synthetic input injection into the host OS. Do not run or invoke xdotool, uinput, SendInput, or cliclick.",
      "- **Strict Secret Boundary:** Never print, log, or echo API keys, tokens, or passwords in chat responses or files.",
      "- **Multi-Tenant Jail:** File operations are strictly confined within the designated workspace jail. Traversal attempts (../) are rejected.",
      "- **Jev Infrastructure:** Jev is a hard dependency for decision gating and signal detection. Fail loud when unreachable; never degrade silently.",
    ].join("\n");

    // 4. Memory — curated persistent domain facts and session context
    const facts: string[] = [];
    if (sessionId) {
      facts.push(`Active Session: ${sessionId}`);
      const decisions = this.db.getDecisions(sessionId);
      if (decisions.length > 0) {
        facts.push(`Session Decisions:\n${decisions.map(d => `- [${d.recorded_at}] "${d.decision_text}"`).join("\n")}`);
      }
    }
    const memory = [
      "## Persistent Memory & Context",
      facts.length > 0 ? facts.join("\n") : "No recorded decisions for this session yet.",
    ].join("\n");

    // 5. Tool Guidance — tools & OpenUI Generative UI rules
    const toolGuidance = [
      "## Tool Guidance & Effect Classes",
      "Available execution tools:",
      "- `read_file(path)` [Effect: read] — Read workspace file contents.",
      "- `write_file(path, content)` [Effect: write_local] — Write or edit a workspace file.",
      "- `exec_command(executable, args)` [Effect: write_local] — Execute an allowed CLI tool inside the jailed workspace.",
      "- `web_search(query)` [Effect: read] — Perform up-to-date web searches.",
      "",
      "### OpenUI Generative UI Rules:",
      "When proposing to hire or configure a new agent, ALWAYS emit an interactive OpenUI code block:",
      "```openui-lang",
      'root = HireAgentCard("Role Title", "bot-name", "Role mission description", "Skill1, Skill2")',
      "```",
      "Never fake command-line executions for hiring. The in-chat card is the user's consent gate.",
    ].join("\n");

    // 6. Skills — active skill catalog
    const catalog = this.curator.getCatalog("balacode");
    const activeSkillNames = catalog.skills.slice(0, 15).map(s => `- **${s.name}** (${s.tier}): ${s.description}`).join("\n");
    const skills = [
      "## Available Skills Catalog",
      activeSkillNames,
    ].join("\n");

    // 7. Constitution — bedrock non-negotiables
    const constitution = [
      "## Constitution",
      "1. The human user is the absolute owner and is never overruled.",
      "2. When in doubt or encountering unknown variables, stop and name the exact friction point.",
      "3. Every change to system state must be transparent, logged, and reversible.",
    ].join("\n");

    const combined = [
      `# Persona Identity\n${soul}`,
      `# System Guidelines\n${systemPrompt}`,
      guardrails,
      memory,
      toolGuidance,
      skills,
      constitution,
    ].join("\n\n---\n\n");

    return {
      soul,
      systemPrompt,
      guardrails,
      memory,
      toolGuidance,
      skills,
      constitution,
      combined,
    };
  }
}
