/**
 * Unified SQLite Database Layer for BalaBot (Pi Durable Modernization)
 *
 * Implements the authoritative relational schema specified in PRD-PI-DURABLE.md Section 3.2.
 * Reconciles legacy continuity.db, queue.db, handoffs.db, approvals.db, fleet, and groups.
 */

import { createRequire } from "node:module";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { UNIFIED_SCHEMA, getDefaultDestDbPath } from "../scripts/migrate_legacy_data.js";

const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite");

export interface PiSession {
  session_id: string;
  agent_id: string;
  bot_id: string;
  purpose: string | null;
  compaction_count: number;
  last_compaction_at: number | null;
  created_at: number;
  updated_at: number;
  status: string;
  metadata: string;
}

export interface PiMessage {
  id: string;
  session_id: string;
  seq: number;
  role: string;
  content: string;
  thinking: string | null;
  tool_calls: string | null;
  created_at: number;
}

export interface PiTask {
  task_id: string;
  session_id: string;
  parent_task_id: string | null;
  task_type: string;
  status: "pending" | "running" | "completed" | "failed" | "paused";
  input_payload: string;
  output_payload: string | null;
  error_message: string | null;
  wake_at: number | null;
  created_at: number;
  updated_at: number;
}

export interface PiInboxItem {
  message_id: string;
  agent_id: string;
  session_id: string | null;
  source_agent: string | null;
  message_type: "steer" | "follow_up" | "handoff" | "secret_grant";
  payload: string;
  seq: number | null;
  handled: number;
  claimed_at: number | null;
  delivered_at: number | null;
  created_at: number;
}

export interface TopicSpan {
  session_id: string;
  topic: string;
  start_seq: number;
  end_seq: number;
}

export interface SessionDecision {
  id: string;
  session_id: string;
  decision_text: string;
  provenance: string;
  recorded_at: string;
}

export interface FleetBot {
  bot_id: string;
  name: string;
  title: string;
  icon: string;
  color: string;
  role_class: "shipped" | "persistent" | "subagent";
  created_by: string;
  created_at: string;
  config_json: string;
}

export interface PiGroup {
  id: string;
  group_id: string;
  org_id: string;
  name: string;
  created_by: string;
  created_at: number;
  createdAt: string;
  members: string[];
  computerAgent: string;
  round: number;
  transcript: any[];
  sessionLens: Record<string, number>;
}

export interface BotProposal {
  id: string;
  name: string;
  role: string;
  description: string;
  proposed_by: string;
  status: "proposed" | "approved" | "rejected" | "registered";
  created_at: string;
}

export interface BotRoutine {
  id: string;
  botId: string;
  title: string;
  schedule: string;
  enabled: boolean;
  lastRun: string;
  prompt: string;
}

export interface BotRoutineRun {
  id: string;
  routine_id: string;
  bot_id: string;
  status: string;
  output: string | null;
  started_at: number;
  finished_at: number | null;
}

export interface BotMemoryItem {
  id: string;
  bot_id: string;
  content: string;
  category: string;
  created_at: number;
}

export interface BotKbDoc {
  id: string;
  bot_id: string;
  title: string;
  content: string;
  created_at: number;
}

export class BalaBotDatabase {
  private db: any;
  public readonly dbPath: string;

  constructor(dbPath?: string) {
    this.dbPath = dbPath || process.env.BALABOT_DB_PATH || getDefaultDestDbPath();
    if (this.dbPath !== ":memory:") {
      fs.mkdirSync(path.dirname(this.dbPath), { recursive: true });
    }
    this.db = new DatabaseSync(this.dbPath);
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec("PRAGMA foreign_keys = ON;");
    this.db.exec(UNIFIED_SCHEMA);
    // Schema migrations for existing databases
    try { this.db.exec("ALTER TABLE pi_groups ADD COLUMN members TEXT DEFAULT '[]';"); } catch {}
    try { this.db.exec("ALTER TABLE pi_groups ADD COLUMN computer_agent TEXT DEFAULT 'principal';"); } catch {}
    try { this.db.exec("ALTER TABLE pi_groups ADD COLUMN round INTEGER DEFAULT 0;"); } catch {}
    try { this.db.exec("ALTER TABLE pi_groups ADD COLUMN transcript TEXT DEFAULT '[]';"); } catch {}
    try { this.db.exec("ALTER TABLE pi_groups ADD COLUMN session_lens TEXT DEFAULT '{}';"); } catch {}
    this.seedShippedDefaults();
  }

  private seedShippedDefaults(): void {
    const nowMs = Date.now();
    // Default Org
    this.db.prepare(`
      INSERT OR IGNORE INTO pi_orgs (org_id, name, created_at, metadata)
      VALUES (?, ?, ?, ?)
    `).run("balacode", "BalaCode Primary Org", nowMs, "{}");

    // Shipped Principal Bot (Immutable)
    this.db.prepare(`
      INSERT OR IGNORE INTO fleet_roster (
        bot_id, name, title, icon, color, role_class, created_by, created_at, config_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      "principal",
      "Principal",
      "Operations & Principal Orchestrator",
      "ShieldCheckIcon",
      "indigo",
      "shipped",
      "system",
      new Date().toISOString(),
      JSON.stringify({ locked: true, system: true })
    );

    // Shipped Governor Bot (Immutable)
    this.db.prepare(`
      INSERT OR IGNORE INTO fleet_roster (
        bot_id, name, title, icon, color, role_class, created_by, created_at, config_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      "governor",
      "Governor",
      "Policy, OKF Decisions & Curation",
      "ScaleIcon",
      "amber",
      "shipped",
      "system",
      new Date().toISOString(),
      JSON.stringify({ locked: true, system: true })
    );
  }

  // --- Sessions & Continuity ---

  public createSession(sessionId: string, botId: string, purpose?: string): PiSession {
    const nowMs = Date.now();
    const stmt = this.db.prepare(`
      INSERT INTO pi_sessions (
        session_id, agent_id, bot_id, purpose, compaction_count,
        last_compaction_at, created_at, updated_at, status, metadata
      ) VALUES (?, ?, ?, ?, 0, NULL, ?, ?, 'active', '{}')
    `);
    stmt.run(sessionId, botId, botId, purpose || null, nowMs, nowMs);
    return this.getSession(sessionId)!;
  }

  public getSession(sessionId: string): PiSession | null {
    const row = this.db.prepare("SELECT * FROM pi_sessions WHERE session_id = ?").get(sessionId);
    return (row as PiSession) || null;
  }

  public listSessions(botId?: string, includeTestFixtures: boolean = false): PiSession[] {
    let sql = "SELECT * FROM pi_sessions WHERE 1=1";
    const params: any[] = [];
    if (botId) {
      sql += " AND bot_id = ?";
      params.push(botId);
    }
    if (!includeTestFixtures) {
      sql += " AND session_id NOT LIKE 'test-%' AND (purpose IS NULL OR purpose NOT LIKE 'test-%')";
    }
    sql += " ORDER BY updated_at DESC";
    return this.db.prepare(sql).all(...params) as PiSession[];
  }

  public deleteSession(sessionId: string): boolean {
    this.db.prepare("DELETE FROM topic_spans WHERE session_id = ?").run(sessionId);
    this.db.prepare("DELETE FROM session_decisions WHERE session_id = ?").run(sessionId);
    this.db.prepare("DELETE FROM pi_messages WHERE session_id = ?").run(sessionId);
    const res = this.db.prepare("DELETE FROM pi_sessions WHERE session_id = ?").run(sessionId);
    return res.changes > 0;
  }

  public clearSessionMessages(sessionId: string): void {
    this.db.prepare("DELETE FROM pi_messages WHERE session_id = ?").run(sessionId);
    this.db.prepare("DELETE FROM topic_spans WHERE session_id = ?").run(sessionId);
  }

  public appendMessage(msg: {
    id?: string;
    sessionId: string;
    role: string;
    content: string;
    thinking?: string | null;
    toolCalls?: string | null;
  }): PiMessage {
    const nowMs = Date.now();
    // Get next sequence number
    const maxSeqRow = this.db.prepare("SELECT MAX(seq) as max_seq FROM pi_messages WHERE session_id = ?").get(msg.sessionId) as any;
    const nextSeq = (maxSeqRow && maxSeqRow.max_seq !== null) ? maxSeqRow.max_seq + 1 : 1;
    const id = msg.id || `msg-${Math.random().toString(36).substring(2, 10)}`;

    this.db.prepare(`
      INSERT INTO pi_messages (id, session_id, seq, role, content, thinking, tool_calls, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, msg.sessionId, nextSeq, msg.role, msg.content, msg.thinking || null, msg.toolCalls || null, nowMs);

    this.db.prepare("UPDATE pi_sessions SET updated_at = ? WHERE session_id = ?").run(nowMs, msg.sessionId);
    return this.getMessage(id)!;
  }

  public getMessage(id: string): PiMessage | null {
    const row = this.db.prepare("SELECT * FROM pi_messages WHERE id = ?").get(id);
    return (row as PiMessage) || null;
  }

  public getSessionMessages(sessionId: string): PiMessage[] {
    return this.db.prepare("SELECT * FROM pi_messages WHERE session_id = ? ORDER BY seq ASC").all(sessionId) as PiMessage[];
  }

  // --- Topic Spans (balabot/sessions.py contract) ---

  public appendTopic(sessionId: string, topic: string, seq: number): TopicSpan {
    // Contract: appending topic that equals currently-open span extends end_seq.
    // Different topic closes open span and opens a new one.
    const openSpan = this.db.prepare(`
      SELECT * FROM topic_spans
      WHERE session_id = ?
      ORDER BY start_seq DESC LIMIT 1
    `).get(sessionId) as TopicSpan | undefined;

    if (openSpan && openSpan.topic === topic) {
      this.db.prepare(`
        UPDATE topic_spans SET end_seq = ?
        WHERE session_id = ? AND start_seq = ?
      `).run(seq, sessionId, openSpan.start_seq);
      return { ...openSpan, end_seq: seq };
    }

    const newStartSeq = openSpan ? openSpan.end_seq + 1 : seq;
    const newEndSeq = Math.max(newStartSeq, seq);
    this.db.prepare(`
      INSERT INTO topic_spans (session_id, topic, start_seq, end_seq)
      VALUES (?, ?, ?, ?)
    `).run(sessionId, topic, newStartSeq, newEndSeq);

    return { session_id: sessionId, topic, start_seq: newStartSeq, end_seq: newEndSeq };
  }

  public getTopicSpans(sessionId: string): TopicSpan[] {
    return this.db.prepare("SELECT * FROM topic_spans WHERE session_id = ? ORDER BY start_seq ASC").all(sessionId) as TopicSpan[];
  }

  // --- Session Decisions ---

  public recordDecision(sessionId: string, text: string, provenance: string): SessionDecision {
    const id = `dec-${Math.random().toString(36).substring(2, 10)}`;
    const recordedAt = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO session_decisions (id, session_id, decision_text, provenance, recorded_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, sessionId, text, provenance, recordedAt);
    return { id, session_id: sessionId, decision_text: text, provenance, recorded_at: recordedAt };
  }

  public getDecisions(sessionId: string): SessionDecision[] {
    return this.db.prepare("SELECT * FROM session_decisions WHERE session_id = ? ORDER BY recorded_at ASC").all(sessionId) as SessionDecision[];
  }

  // --- Unified Inbox (Queues & Handoffs) ---

  public enqueueInbox(item: {
    agentId: string;
    sessionId?: string | null;
    sourceAgent?: string | null;
    messageType: "steer" | "follow_up" | "handoff" | "secret_grant";
    payload: string;
  }): PiInboxItem {
    const messageId = `inbox-${Math.random().toString(36).substring(2, 10)}`;
    const nowMs = Date.now();
    this.db.prepare(`
      INSERT INTO pi_inbox (
        message_id, agent_id, session_id, source_agent, message_type,
        payload, seq, handled, claimed_at, delivered_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, NULL, 0, NULL, NULL, ?)
    `).run(messageId, item.agentId, item.sessionId || null, item.sourceAgent || "user", item.messageType, item.payload, nowMs);
    return this.getInboxItem(messageId)!;
  }

  public getInboxItem(messageId: string): PiInboxItem | null {
    const row = this.db.prepare("SELECT * FROM pi_inbox WHERE message_id = ?").get(messageId);
    return (row as PiInboxItem) || null;
  }

  public drainInbox(agentId: string, limit: number = 50): PiInboxItem[] {
    const nowMs = Date.now();
    // Claim at-most-once with conditional update
    const pending = this.db.prepare(`
      SELECT * FROM pi_inbox
      WHERE agent_id = ? AND handled = 0 AND claimed_at IS NULL
      ORDER BY created_at ASC LIMIT ?
    `).all(agentId, limit) as PiInboxItem[];

    for (const item of pending) {
      this.db.prepare(`
        UPDATE pi_inbox SET claimed_at = ?
        WHERE message_id = ? AND claimed_at IS NULL
      `).run(nowMs, item.message_id);
    }

    return pending;
  }

  public markInboxDelivered(messageId: string): void {
    const nowMs = Date.now();
    this.db.prepare(`
      UPDATE pi_inbox SET handled = 1, delivered_at = ?
      WHERE message_id = ?
    `).run(nowMs, messageId);
  }

  // --- Fleet Roster & Hierarchy ---

  public getFleet(): FleetBot[] {
    return this.db.prepare("SELECT * FROM fleet_roster ORDER BY bot_id ASC").all() as FleetBot[];
  }

  public getBot(botId: string): FleetBot | null {
    const row = this.db.prepare("SELECT * FROM fleet_roster WHERE bot_id = ?").get(botId);
    return (row as FleetBot) || null;
  }

  public createBot(bot: Omit<FleetBot, "created_at">): FleetBot {
    const createdAt = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO fleet_roster (
        bot_id, name, title, icon, color, role_class, created_by, created_at, config_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      bot.bot_id,
      bot.name,
      bot.title,
      bot.icon,
      bot.color,
      bot.role_class,
      bot.created_by,
      createdAt,
      bot.config_json
    );
    return this.getBot(bot.bot_id)!;
  }

  public deleteBot(botId: string): { success: boolean; error?: string; status?: number } {
    const existing = this.getBot(botId);
    if (!existing) {
      return { success: false, error: "Bot not found", status: 404 };
    }
    // Hierarchy enforcement: shipped bots return 409 Conflict
    if (existing.role_class === "shipped" || botId === "principal" || botId === "governor") {
      return { success: false, error: "Cannot modify or delete shipped system bots", status: 409 };
    }
    this.db.prepare("DELETE FROM fleet_roster WHERE bot_id = ?").run(botId);
    return { success: true };
  }

  public updateBotConfig(botId: string, updates: Record<string, any>): FleetBot | null {
    const existing = this.getBot(botId);
    if (!existing) return null;
    let config: Record<string, any> = {};
    try {
      config = JSON.parse(existing.config_json || "{}");
    } catch {}
    const newConfig = { ...config, ...updates };
    const newConfigJson = JSON.stringify(newConfig);

    const name = updates.name !== undefined ? updates.name : existing.name;
    const title = updates.title !== undefined ? updates.title : existing.title;
    const icon = updates.icon !== undefined ? updates.icon : existing.icon;
    const color = updates.color !== undefined ? updates.color : existing.color;

    this.db.prepare(`
      UPDATE fleet_roster
      SET config_json = ?, name = ?, title = ?, icon = ?, color = ?
      WHERE bot_id = ?
    `).run(newConfigJson, name, title, icon, color, botId);
    return this.getBot(botId);
  }

  // --- Tasks DAG & Sub-agents ---

  public createTask(task: {
    sessionId: string;
    parentTaskId?: string | null;
    taskType: string;
    inputPayload: string;
  }): PiTask {
    const taskId = `task-${Math.random().toString(36).substring(2, 10)}`;
    const nowMs = Date.now();
    this.db.prepare(`
      INSERT INTO pi_tasks (
        task_id, session_id, parent_task_id, task_type, status,
        input_payload, output_payload, error_message, wake_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'running', ?, NULL, NULL, NULL, ?, ?)
    `).run(taskId, task.sessionId, task.parentTaskId || null, task.taskType, task.inputPayload, nowMs, nowMs);
    return this.getTask(taskId)!;
  }

  public getTask(taskId: string): PiTask | null {
    const row = this.db.prepare("SELECT * FROM pi_tasks WHERE task_id = ?").get(taskId);
    return (row as PiTask) || null;
  }

  public updateTaskStatus(taskId: string, status: PiTask["status"], output?: string, error?: string): void {
    const nowMs = Date.now();
    this.db.prepare(`
      UPDATE pi_tasks
      SET status = ?, output_payload = ?, error_message = ?, updated_at = ?
      WHERE task_id = ?
    `).run(status, output || null, error || null, nowMs, taskId);
  }

  public listActiveSubagents(): PiTask[] {
    return this.db.prepare(`
      SELECT * FROM pi_tasks
      WHERE parent_task_id IS NOT NULL AND status IN ('running', 'pending', 'paused')
      ORDER BY created_at DESC
    `).all() as PiTask[];
  }

  // --- Multi-Agent Groups ---

  public listGroups(): PiGroup[] {
    const rows = this.db.prepare("SELECT * FROM pi_groups ORDER BY created_at DESC").all() as any[];
    return rows.map((g: any) => this.mapGroupRow(g));
  }

  public getGroup(groupId: string): PiGroup | null {
    const row = this.db.prepare("SELECT * FROM pi_groups WHERE group_id = ?").get(groupId) as any;
    if (!row) return null;
    return this.mapGroupRow(row);
  }

  public createGroup(
    groupId: string,
    orgId: string,
    name: string,
    createdBy: string = "user",
    members: string[] = [],
    computerAgent: string = "principal"
  ): PiGroup {
    const nowMs = Date.now();
    const membersJson = JSON.stringify(Array.isArray(members) ? members : []);
    this.db.prepare(`
      INSERT INTO pi_groups (
        group_id, org_id, name, created_by, created_at, members, computer_agent, round, transcript, session_lens
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, '[]', '{}')
    `).run(groupId, orgId, name, createdBy, nowMs, membersJson, computerAgent || "principal");
    return this.getGroup(groupId)!;
  }

  public deleteGroup(groupId: string): boolean {
    this.db.prepare("DELETE FROM group_messages WHERE group_id = ?").run(groupId);
    const res = this.db.prepare("DELETE FROM pi_groups WHERE group_id = ?").run(groupId);
    return res.changes > 0;
  }

  public appendGroupTurn(groupId: string, turnEntry: any): PiGroup | null {
    const group = this.getGroup(groupId);
    if (!group) return null;
    const nextRound = (group.round || 0) + 1;
    const updatedTranscript = [...(group.transcript || []), turnEntry];
    this.db.prepare(`
      UPDATE pi_groups
      SET round = ?, transcript = ?
      WHERE group_id = ?
    `).run(nextRound, JSON.stringify(updatedTranscript), groupId);
    return this.getGroup(groupId);
  }

  private mapGroupRow(g: any): PiGroup {
    let members: string[] = [];
    try { members = typeof g.members === "string" ? JSON.parse(g.members) : (g.members || []); } catch {}
    let transcript: any[] = [];
    try { transcript = typeof g.transcript === "string" ? JSON.parse(g.transcript) : (g.transcript || []); } catch {}
    let sessionLens: Record<string, number> = {};
    try { sessionLens = typeof g.session_lens === "string" ? JSON.parse(g.session_lens) : (g.session_lens || {}); } catch {}
    return {
      id: g.group_id,
      group_id: g.group_id,
      org_id: g.org_id,
      name: g.name,
      created_by: g.created_by,
      created_at: g.created_at,
      createdAt: new Date(g.created_at).toISOString(),
      members,
      computerAgent: g.computer_agent || "principal",
      round: g.round || 0,
      transcript,
      sessionLens,
    };
  }

  public appendGroupMessage(groupId: string, senderId: string, content: string): void {
    const id = `gmsg-${Math.random().toString(36).substring(2, 10)}`;
    const nowMs = Date.now();
    this.db.prepare(`
      INSERT INTO group_messages (id, group_id, sender_id, content, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, groupId, senderId, content, nowMs);
  }

  public getGroupMessages(groupId: string): any[] {
    return this.db.prepare("SELECT * FROM group_messages WHERE group_id = ? ORDER BY created_at ASC").all(groupId) as any[];
  }

  // --- Bot Proposals (Persistent) ---

  public listBotProposals(): BotProposal[] {
    return this.db.prepare("SELECT * FROM bot_proposals ORDER BY created_at DESC").all() as BotProposal[];
  }

  public getBotProposal(id: string): BotProposal | null {
    const row = this.db.prepare("SELECT * FROM bot_proposals WHERE id = ?").get(id);
    return (row as BotProposal) || null;
  }

  public createBotProposal(p: {
    id: string;
    name: string;
    role?: string;
    description?: string;
    proposed_by?: string;
    status?: "proposed" | "approved" | "rejected" | "registered";
  }): BotProposal {
    const createdAt = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO bot_proposals (id, name, role, description, proposed_by, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      p.id,
      p.name,
      p.role || "",
      p.description || "",
      p.proposed_by || "user",
      p.status || "proposed",
      createdAt
    );
    return this.getBotProposal(p.id)!;
  }

  public updateBotProposalStatus(id: string, status: string): BotProposal | null {
    this.db.prepare("UPDATE bot_proposals SET status = ? WHERE id = ?").run(status, id);
    return this.getBotProposal(id);
  }

  public deleteBotProposal(id: string): boolean {
    const res = this.db.prepare("DELETE FROM bot_proposals WHERE id = ?").run(id);
    return res.changes > 0;
  }

  // --- Bot Routines ---

  public listRoutines(botId: string): BotRoutine[] {
    const rows = this.db.prepare("SELECT * FROM bot_routines WHERE bot_id = ? ORDER BY created_at ASC").all(botId) as any[];
    return rows.map((r: any) => ({
      id: r.id,
      botId: r.bot_id,
      title: r.title,
      schedule: r.schedule,
      enabled: Boolean(r.enabled),
      lastRun: r.last_run,
      prompt: r.prompt,
    }));
  }

  public getRoutine(id: string): BotRoutine | null {
    const r = this.db.prepare("SELECT * FROM bot_routines WHERE id = ?").get(id) as any;
    if (!r) return null;
    return {
      id: r.id,
      botId: r.bot_id,
      title: r.title,
      schedule: r.schedule,
      enabled: Boolean(r.enabled),
      lastRun: r.last_run,
      prompt: r.prompt,
    };
  }

  public createRoutine(r: {
    id: string;
    botId: string;
    title: string;
    schedule: string;
    enabled?: boolean;
    lastRun?: string;
    prompt?: string;
  }): BotRoutine {
    const nowMs = Date.now();
    this.db.prepare(`
      INSERT INTO bot_routines (id, bot_id, title, schedule, enabled, last_run, prompt, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      r.id,
      r.botId,
      r.title,
      r.schedule,
      r.enabled !== false ? 1 : 0,
      r.lastRun || "Never",
      r.prompt || "",
      nowMs,
      nowMs
    );
    return this.getRoutine(r.id)!;
  }

  public updateRoutine(id: string, updates: Record<string, any>): BotRoutine | null {
    const existing = this.getRoutine(id);
    if (!existing) return null;
    const nowMs = Date.now();
    const title = updates.title !== undefined ? updates.title : existing.title;
    const schedule = updates.schedule !== undefined ? updates.schedule : existing.schedule;
    const enabled = updates.enabled !== undefined ? (updates.enabled ? 1 : 0) : (existing.enabled ? 1 : 0);
    const lastRun = updates.lastRun !== undefined ? updates.lastRun : existing.lastRun;
    const prompt = updates.prompt !== undefined ? updates.prompt : existing.prompt;

    this.db.prepare(`
      UPDATE bot_routines
      SET title = ?, schedule = ?, enabled = ?, last_run = ?, prompt = ?, updated_at = ?
      WHERE id = ?
    `).run(title, schedule, enabled, lastRun, prompt, nowMs, id);
    return this.getRoutine(id);
  }

  public deleteRoutine(id: string): boolean {
    const res = this.db.prepare("DELETE FROM bot_routines WHERE id = ?").run(id);
    return res.changes > 0;
  }

  public listRoutineRuns(botId: string): BotRoutineRun[] {
    return this.db.prepare("SELECT * FROM bot_routine_runs WHERE bot_id = ? ORDER BY started_at DESC").all(botId) as BotRoutineRun[];
  }

  // --- Bot Memories & Knowledge Base Docs ---

  public listBotMemories(botId: string): BotMemoryItem[] {
    return this.db.prepare("SELECT * FROM bot_memories WHERE bot_id = ? ORDER BY created_at DESC").all(botId) as BotMemoryItem[];
  }

  public addBotMemory(botId: string, item: { id?: string; content: string; category?: string }): BotMemoryItem {
    const id = item.id || `mem-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const nowMs = Date.now();
    this.db.prepare(`
      INSERT INTO bot_memories (id, bot_id, content, category, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, botId, item.content, item.category || "general", nowMs);
    return { id, bot_id: botId, content: item.content, category: item.category || "general", created_at: nowMs };
  }

  public listBotKbDocs(botId: string): BotKbDoc[] {
    return this.db.prepare("SELECT * FROM bot_kb_docs WHERE bot_id = ? ORDER BY created_at DESC").all(botId) as BotKbDoc[];
  }

  public addBotKbDoc(botId: string, doc: { id?: string; title: string; content: string }): BotKbDoc {
    const id = doc.id || `kb-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const nowMs = Date.now();
    this.db.prepare(`
      INSERT INTO bot_kb_docs (id, bot_id, title, content, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, botId, doc.title, doc.content, nowMs);
    return { id, bot_id: botId, title: doc.title, content: doc.content, created_at: nowMs };
  }

  // --- Growth Audit Ledger ---

  public recordGrowthAudit(entry: {
    actor: string;
    targetBot: string;
    action: string;
    diff: any;
    rollbackToken?: string;
  }): any {
    const id = `audit-${Math.random().toString(36).substring(2, 10)}`;
    const timestamp = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO growth_audit_ledger (
        id, timestamp, actor, target_bot, action, diff_json, rollback_token
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      timestamp,
      entry.actor,
      entry.targetBot,
      entry.action,
      JSON.stringify(entry.diff),
      entry.rollbackToken || `rb-${Math.random().toString(36).substring(2, 8)}`
    );
    return this.db.prepare("SELECT * FROM growth_audit_ledger WHERE id = ?").get(id);
  }

  public listGrowthAudits(): any[] {
    return this.db.prepare("SELECT * FROM growth_audit_ledger ORDER BY timestamp DESC").all() as any[];
  }

  // --- Harness Learned Skills & Curator Support ---
  public listLearnedSkills(orgId: string = "balacode"): any[] {
    return this.db.prepare("SELECT * FROM harness_learned_skills WHERE org_id = ? ORDER BY created_at DESC").all(orgId) as any[];
  }

  public saveLearnedSkill(skill: {
    skillId?: string;
    orgId?: string;
    name: string;
    description?: string;
    content?: string;
    category?: string;
    source?: string;
    state?: string;
    pinned?: boolean;
    promoted?: boolean;
  }): any {
    const id = skill.skillId || `skill-${Math.random().toString(36).substring(2, 10)}`;
    const now = Date.now();
    this.db.prepare(`
      INSERT INTO harness_learned_skills (
        skill_id, org_id, name, description, content, category, source, state, pinned, promoted, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(skill_id) DO UPDATE SET
        description = excluded.description,
        content = excluded.content,
        state = excluded.state,
        pinned = excluded.pinned,
        promoted = excluded.promoted,
        updated_at = excluded.updated_at
    `).run(
      id,
      skill.orgId || "balacode",
      skill.name,
      skill.description || "",
      skill.content || "",
      skill.category || "learned",
      skill.source || "curator",
      skill.state || "approved",
      skill.pinned ? 1 : 0,
      skill.promoted ? 1 : 0,
      now,
      now
    );
    return this.db.prepare("SELECT * FROM harness_learned_skills WHERE skill_id = ?").get(id);
  }

  public pinSkill(name: string, pinned: boolean, orgId: string = "balacode"): boolean {
    const res = this.db.prepare(`
      UPDATE harness_learned_skills SET pinned = ?, updated_at = ? WHERE name = ? AND org_id = ?
    `).run(pinned ? 1 : 0, Date.now(), name, orgId);
    return res.changes > 0;
  }

  public promoteSkill(name: string, orgId: string = "balacode"): boolean {
    const res = this.db.prepare(`
      UPDATE harness_learned_skills SET promoted = 1, updated_at = ? WHERE name = ? AND org_id = ?
    `).run(Date.now(), name, orgId);
    return res.changes > 0;
  }

  public listHarnessProposals(filter?: { botId?: string; state?: string }): any[] {
    let sql = "SELECT * FROM harness_proposals WHERE 1=1";
    const params: any[] = [];
    if (filter?.botId) {
      sql += " AND bot_id = ?";
      params.push(filter.botId);
    }
    if (filter?.state) {
      sql += " AND state = ?";
      params.push(filter.state);
    }
    sql += " ORDER BY created_at DESC";
    return this.db.prepare(sql).all(...params) as any[];
  }

  public createHarnessProposal(p: {
    proposalId?: string;
    orgId?: string;
    botId: string;
    kind?: string;
    title: string;
    description?: string;
    diffJson?: string;
    riskTier?: string;
  }): any {
    const id = p.proposalId || `prop-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const now = Date.now();
    this.db.prepare(`
      INSERT INTO harness_proposals (
        proposal_id, org_id, bot_id, kind, title, description, diff_json, state, risk_tier, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
    `).run(
      id,
      p.orgId || "balacode",
      p.botId,
      p.kind || "skill",
      p.title,
      p.description || "",
      p.diffJson || "{}",
      p.riskTier || "medium",
      now
    );
    return this.db.prepare("SELECT * FROM harness_proposals WHERE proposal_id = ?").get(id);
  }

  public decideHarnessProposal(id: string, state: "approved" | "rejected", actor: string): any {
    const now = Date.now();
    this.db.prepare(`
      UPDATE harness_proposals SET state = ?, decided_by = ?, decided_at = ? WHERE proposal_id = ?
    `).run(state, actor, now, id);
    return this.db.prepare("SELECT * FROM harness_proposals WHERE proposal_id = ?").get(id);
  }

  private isOpen: boolean = true;

  public close(): void {
    if (this.db && this.isOpen) {
      try {
        this.db.close();
      } catch {
        // already closed
      }
      this.isOpen = false;
    }
  }
}
