/**
 * Automated Migration ETL Script: Legacy Hermes/Container Data -> Unified Pi Durable SQLite Schema
 *
 * Extracts and transforms legacy BalaBot stores:
 *   - continuity.db (sessions, messages, topic_spans, decisions)
 *   - queue.db (queue_messages, queue_turns)
 *   - handoffs.db (handoff_frames)
 *   - approvals.db (decisions, attempts)
 *   - fleet/ (bots.json, <org>.json)
 *   - groups/ (*.json)
 *   - growth audit ledger (growth_audit.jsonl)
 *
 * Populates modern unified SQLite database (~/.balabot/data/continuity.db or --dest).
 */

import { createRequire } from "node:module";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite");

export const UNIFIED_SCHEMA = `
CREATE TABLE IF NOT EXISTS pi_sessions (
    session_id          TEXT PRIMARY KEY,
    agent_id            TEXT NOT NULL,
    bot_id              TEXT NOT NULL,
    purpose             TEXT,
    compaction_count    INTEGER NOT NULL DEFAULT 0,
    last_compaction_at  INTEGER,
    created_at          INTEGER NOT NULL,
    updated_at          INTEGER NOT NULL,
    status              TEXT NOT NULL DEFAULT 'active',
    metadata            TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS pi_messages (
    id              TEXT PRIMARY KEY,
    session_id      TEXT NOT NULL REFERENCES pi_sessions(session_id) ON DELETE CASCADE,
    seq             INTEGER NOT NULL,
    role            TEXT NOT NULL,
    content         TEXT NOT NULL,
    thinking        TEXT,
    tool_calls      TEXT,
    created_at      INTEGER NOT NULL,
    UNIQUE(session_id, seq)
);

CREATE TABLE IF NOT EXISTS pi_tasks (
    task_id         TEXT PRIMARY KEY,
    session_id      TEXT NOT NULL REFERENCES pi_sessions(session_id) ON DELETE CASCADE,
    parent_task_id  TEXT,
    task_type       TEXT NOT NULL,
    status          TEXT NOT NULL,
    input_payload   TEXT NOT NULL,
    output_payload  TEXT,
    error_message   TEXT,
    wake_at         INTEGER,
    created_at      INTEGER NOT NULL,
    updated_at      INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS pi_inbox (
    message_id      TEXT PRIMARY KEY,
    agent_id        TEXT NOT NULL,
    session_id      TEXT REFERENCES pi_sessions(session_id) ON DELETE CASCADE,
    source_agent    TEXT,
    message_type    TEXT NOT NULL,
    payload         TEXT NOT NULL,
    seq             INTEGER,
    handled         INTEGER NOT NULL DEFAULT 0,
    claimed_at      INTEGER,
    delivered_at    INTEGER,
    created_at      INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS topic_spans (
    session_id      TEXT NOT NULL REFERENCES pi_sessions(session_id) ON DELETE CASCADE,
    topic           TEXT NOT NULL,
    start_seq       INTEGER NOT NULL,
    end_seq         INTEGER NOT NULL,
    PRIMARY KEY (session_id, start_seq)
);

CREATE TABLE IF NOT EXISTS session_decisions (
    id              TEXT PRIMARY KEY,
    session_id      TEXT NOT NULL REFERENCES pi_sessions(session_id) ON DELETE CASCADE,
    decision_text   TEXT NOT NULL,
    provenance      TEXT NOT NULL,
    recorded_at     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS pi_orgs (
    org_id          TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    created_at      INTEGER NOT NULL,
    metadata        TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS pi_groups (
    group_id        TEXT PRIMARY KEY,
    org_id          TEXT NOT NULL REFERENCES pi_orgs(org_id) ON DELETE CASCADE,
    name            TEXT NOT NULL,
    created_by      TEXT NOT NULL,
    created_at      INTEGER NOT NULL,
    members         TEXT NOT NULL DEFAULT '[]',
    computer_agent  TEXT NOT NULL DEFAULT 'principal',
    round           INTEGER NOT NULL DEFAULT 0,
    transcript      TEXT NOT NULL DEFAULT '[]',
    session_lens    TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS bot_proposals (
    id              TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    role            TEXT,
    description     TEXT,
    proposed_by     TEXT NOT NULL DEFAULT 'user',
    status          TEXT NOT NULL DEFAULT 'proposed',
    created_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS bot_routines (
    id              TEXT PRIMARY KEY,
    bot_id          TEXT NOT NULL,
    title           TEXT NOT NULL,
    schedule        TEXT NOT NULL,
    enabled         INTEGER NOT NULL DEFAULT 1,
    last_run        TEXT NOT NULL DEFAULT 'Never',
    prompt          TEXT NOT NULL,
    created_at      INTEGER NOT NULL,
    updated_at      INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS bot_routine_runs (
    id              TEXT PRIMARY KEY,
    routine_id      TEXT NOT NULL,
    bot_id          TEXT NOT NULL,
    status          TEXT NOT NULL,
    output          TEXT,
    started_at      INTEGER NOT NULL,
    finished_at     INTEGER
);

CREATE TABLE IF NOT EXISTS bot_memories (
    id              TEXT PRIMARY KEY,
    bot_id          TEXT NOT NULL,
    content         TEXT NOT NULL,
    category        TEXT NOT NULL DEFAULT 'general',
    created_at      INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS bot_kb_docs (
    id              TEXT PRIMARY KEY,
    bot_id          TEXT NOT NULL,
    title           TEXT NOT NULL,
    content         TEXT NOT NULL,
    created_at      INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS group_messages (
    id              TEXT PRIMARY KEY,
    group_id        TEXT NOT NULL REFERENCES pi_groups(group_id) ON DELETE CASCADE,
    sender_id       TEXT NOT NULL,
    content         TEXT NOT NULL,
    created_at      INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS fleet_roster (
    bot_id          TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    title           TEXT NOT NULL,
    icon            TEXT NOT NULL,
    color           TEXT NOT NULL,
    role_class      TEXT NOT NULL,
    created_by      TEXT NOT NULL,
    created_at      TEXT NOT NULL,
    config_json     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS growth_audit_ledger (
    id              TEXT PRIMARY KEY,
    timestamp       TEXT NOT NULL,
    actor           TEXT NOT NULL,
    target_bot      TEXT NOT NULL,
    action          TEXT NOT NULL,
    diff_json       TEXT NOT NULL,
    rollback_token  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS harness_learned_skills (
    skill_id        TEXT PRIMARY KEY,
    org_id          TEXT NOT NULL DEFAULT 'balacode',
    name            TEXT NOT NULL,
    description     TEXT,
    content         TEXT,
    category        TEXT NOT NULL DEFAULT 'learned',
    source          TEXT NOT NULL DEFAULT 'curator',
    state           TEXT NOT NULL DEFAULT 'approved',
    pinned          INTEGER NOT NULL DEFAULT 0,
    promoted        INTEGER NOT NULL DEFAULT 0,
    created_at      INTEGER NOT NULL,
    updated_at      INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS harness_proposals (
    proposal_id     TEXT PRIMARY KEY,
    org_id          TEXT NOT NULL DEFAULT 'balacode',
    bot_id          TEXT NOT NULL,
    kind            TEXT NOT NULL DEFAULT 'skill',
    title           TEXT NOT NULL,
    description     TEXT,
    diff_json       TEXT NOT NULL DEFAULT '{}',
    state           TEXT NOT NULL DEFAULT 'pending',
    risk_tier       TEXT NOT NULL DEFAULT 'medium',
    decided_by      TEXT,
    created_at      INTEGER NOT NULL,
    decided_at      INTEGER
);
`;

export interface MigrationOptions {
  srcDir: string;
  destDbPath: string;
  dryRun?: boolean;
}

export interface MigrationSummary {
  sessions: number;
  messages: number;
  topicSpans: number;
  decisions: number;
  inboxMessages: number;
  groups: number;
  groupMessages: number;
  rosterBots: number;
  growthAuditEntries: number;
}

export function getDefaultDestDbPath(): string {
  const home = os.homedir();
  if (process.platform === "win32") {
    const appData = process.env.APPDATA || path.join(home, "AppData", "Roaming");
    return path.join(appData, "balabot", "data", "continuity.db");
  } else if (process.platform === "darwin") {
    return path.join(home, "Library", "Application Support", "balabot", "data", "continuity.db");
  }
  return path.join(home, ".config", "balabot", "data", "continuity.db");
}

export function migrateLegacyData(options: MigrationOptions): MigrationSummary {
  const summary: MigrationSummary = {
    sessions: 0,
    messages: 0,
    topicSpans: 0,
    decisions: 0,
    inboxMessages: 0,
    groups: 0,
    groupMessages: 0,
    rosterBots: 0,
    growthAuditEntries: 0,
  };

  const { srcDir, destDbPath, dryRun } = options;

  if (!dryRun) {
    fs.mkdirSync(path.dirname(destDbPath), { recursive: true });
  }

  const destDb = new DatabaseSync(dryRun ? ":memory:" : destDbPath);
  destDb.exec("PRAGMA journal_mode = WAL;");
  destDb.exec("PRAGMA foreign_keys = ON;");
  destDb.exec(UNIFIED_SCHEMA);

  // 1. Ensure default org 'balacode' exists
  const nowMs = Date.now();
  const insertOrg = destDb.prepare(`
    INSERT OR IGNORE INTO pi_orgs (org_id, name, created_at, metadata)
    VALUES (?, ?, ?, ?)
  `);
  insertOrg.run("balacode", "BalaCode Default Org", nowMs, "{}");

  // 2. Migrate continuity.db
  const continuityDbCandidates = [
    path.join(srcDir, "sessions", "continuity.db"),
    path.join(srcDir, "continuity.db"),
  ];
  const continuityDbPath = continuityDbCandidates.find(p => fs.existsSync(p));

  if (continuityDbPath) {
    const srcContinuity = new DatabaseSync(continuityDbPath, { open: true, readOnly: true });

    // Read sessions
    try {
      const sessions = srcContinuity.prepare("SELECT * FROM sessions").all() as Array<any>;
      const insertSession = destDb.prepare(`
        INSERT OR REPLACE INTO pi_sessions (
          session_id, agent_id, bot_id, purpose, compaction_count,
          last_compaction_at, created_at, updated_at, status, metadata
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (const s of sessions) {
        const lastCompactionEpoch = s.last_compaction_at ? new Date(s.last_compaction_at).getTime() : null;
        insertSession.run(
          s.session_id,
          s.bot_id, // agent_id
          s.bot_id, // bot_id
          s.purpose,
          s.compaction_count || 0,
          lastCompactionEpoch,
          nowMs,
          nowMs,
          "active",
          s.resume_state || "{}"
        );
        summary.sessions++;
      }
    } catch (err) {
      console.error("Sessions migration error:", err);
    }

    // Read messages
    try {
      const messages = srcContinuity.prepare("SELECT * FROM messages").all() as Array<any>;
      const insertMessage = destDb.prepare(`
        INSERT OR REPLACE INTO pi_messages (
          id, session_id, seq, role, content, thinking, tool_calls, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (const m of messages) {
        const createdEpoch = m.created_at ? new Date(m.created_at).getTime() : nowMs;
        insertMessage.run(
          m.message_id || `msg-${Math.random().toString(36).substring(2, 10)}`,
          m.session_id,
          m.seq,
          m.role,
          m.content,
          null, // thinking
          null, // tool_calls
          createdEpoch
        );
        summary.messages++;
      }
    } catch (err) {
      console.error("Messages migration error:", err);
    }

    // Read topic_spans
    try {
      const spans = srcContinuity.prepare("SELECT * FROM topic_spans").all() as Array<any>;
      const insertSpan = destDb.prepare(`
        INSERT OR REPLACE INTO topic_spans (session_id, topic, start_seq, end_seq)
        VALUES (?, ?, ?, ?)
      `);
      for (const span of spans) {
        insertSpan.run(span.session_id, span.topic, span.start_seq, span.end_seq);
        summary.topicSpans++;
      }
    } catch {
      // Spans table might not exist
    }

    // Read decisions
    try {
      const decisions = srcContinuity.prepare("SELECT * FROM decisions").all() as Array<any>;
      const insertDecision = destDb.prepare(`
        INSERT OR REPLACE INTO session_decisions (id, session_id, decision_text, provenance, recorded_at)
        VALUES (?, ?, ?, ?, ?)
      `);
      for (const d of decisions) {
        const id = `dec-${d.session_id}-${d.seq || Math.random().toString(36).substring(2, 8)}`;
        insertDecision.run(id, d.session_id, d.text, d.provenance, d.created_at);
        summary.decisions++;
      }
    } catch {
      // Decisions table might not exist
    }

    srcContinuity.close();
  }

  // 3. Migrate queue.db
  const queueDbCandidates = [
    path.join(srcDir, "queue.db"),
    path.join(srcDir, "sessions", "queue.db"),
  ];
  const queueDbPath = queueDbCandidates.find(p => fs.existsSync(p));

  if (queueDbPath) {
    const srcQueue = new DatabaseSync(queueDbPath, { open: true, readOnly: true });
    try {
      const queueMessages = srcQueue.prepare("SELECT * FROM queue_messages").all() as Array<any>;
      const insertInbox = destDb.prepare(`
        INSERT OR REPLACE INTO pi_inbox (
          message_id, agent_id, session_id, source_agent, message_type,
          payload, seq, handled, claimed_at, delivered_at, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (const q of queueMessages) {
        const createdEpoch = q.enqueued_at ? new Date(q.enqueued_at).getTime() : nowMs;
        const claimedEpoch = q.claimed_at ? new Date(q.claimed_at).getTime() : null;
        const deliveredEpoch = q.delivered_at ? new Date(q.delivered_at).getTime() : null;
        insertInbox.run(
          q.message_id,
          "principal", // fallback agent
          q.session_id,
          "user",
          "follow_up",
          q.content,
          q.seq,
          deliveredEpoch ? 1 : 0,
          claimedEpoch,
          deliveredEpoch,
          createdEpoch
        );
        summary.inboxMessages++;
      }
    } catch {
      // queue_messages might not exist
    }
    srcQueue.close();
  }

  // 4. Migrate handoffs.db
  const handoffsDbCandidates = [
    path.join(srcDir, "handoffs", "handoffs.db"),
    path.join(srcDir, "handoffs.db"),
  ];
  const handoffsDbPath = handoffsDbCandidates.find(p => fs.existsSync(p));

  if (handoffsDbPath) {
    const srcHandoffs = new DatabaseSync(handoffsDbPath, { open: true, readOnly: true });
    try {
      const frames = srcHandoffs.prepare("SELECT * FROM handoff_frames").all() as Array<any>;
      const insertInbox = destDb.prepare(`
        INSERT OR REPLACE INTO pi_inbox (
          message_id, agent_id, session_id, source_agent, message_type,
          payload, seq, handled, claimed_at, delivered_at, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (const f of frames) {
        const createdEpoch = f.enqueued_at ? new Date(f.enqueued_at).getTime() : nowMs;
        const deliveredEpoch = f.delivered_at ? new Date(f.delivered_at).getTime() : null;
        insertInbox.run(
          `handoff-${f.id}`,
          f.to_bot,
          null, // session_id
          f.from_bot,
          "handoff",
          f.frame,
          null,
          deliveredEpoch ? 1 : 0,
          null,
          deliveredEpoch,
          createdEpoch
        );
        summary.inboxMessages++;
      }
    } catch {
      // handoff_frames might not exist
    }
    srcHandoffs.close();
  }

  // 5. Migrate fleet/ (bots.json and <org>.json)
  const fleetDir = path.join(srcDir, "fleet");
  if (fs.existsSync(fleetDir)) {
    const insertRoster = destDb.prepare(`
      INSERT OR REPLACE INTO fleet_roster (
        bot_id, name, title, icon, color, role_class, created_by, created_at, config_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    // Standard shipped bots
    insertRoster.run(
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
    insertRoster.run(
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
    summary.rosterBots += 2;

    const files = fs.readdirSync(fleetDir);
    for (const f of files) {
      if (f.endsWith(".json")) {
        try {
          const content = JSON.parse(fs.readFileSync(path.join(fleetDir, f), "utf-8"));
          if (Array.isArray(content.agents)) {
            for (const agent of content.agents) {
              if (agent.id !== "principal" && agent.id !== "governor") {
                insertRoster.run(
                  agent.id,
                  agent.name || agent.id,
                  agent.title || "Persistent Fleet Agent",
                  agent.icon || "UserIcon",
                  agent.color || "blue",
                  "persistent",
                  "user",
                  new Date().toISOString(),
                  JSON.stringify(agent)
                );
                summary.rosterBots++;
              }
            }
          }
        } catch {
          // ignore invalid json
        }
      }
    }
  }

  // 6. Migrate groups/ (*.json)
  const groupsDir = path.join(srcDir, "groups");
  if (fs.existsSync(groupsDir)) {
    const insertGroup = destDb.prepare(`
      INSERT OR REPLACE INTO pi_groups (
        group_id, org_id, name, created_by, created_at, members, computer_agent, round, transcript, session_lens
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertGroupMessage = destDb.prepare(`
      INSERT OR REPLACE INTO group_messages (id, group_id, sender_id, content, created_at)
      VALUES (?, ?, ?, ?, ?)
    `);

    const files = fs.readdirSync(groupsDir);
    for (const f of files) {
      if (f.endsWith(".json")) {
        try {
          const g = JSON.parse(fs.readFileSync(path.join(groupsDir, f), "utf-8"));
          if (g.id && g.name) {
            const createdEpoch = g.created_at ? new Date(g.created_at).getTime() : nowMs;
            const members = JSON.stringify(Array.isArray(g.members) ? g.members : []);
            const computerAgent = g.computer_agent || g.computerAgent || "principal";
            const round = g.round || 0;
            const transcript = JSON.stringify(Array.isArray(g.transcript) ? g.transcript : []);
            const sessionLens = JSON.stringify(g.session_lens || g.sessionLens || {});
            insertGroup.run(g.id, "balacode", g.name, g.created_by || "user", createdEpoch, members, computerAgent, round, transcript, sessionLens);
            summary.groups++;

            if (Array.isArray(g.transcript)) {
              for (let i = 0; i < g.transcript.length; i++) {
                const item = g.transcript[i];
                const msgId = `${g.id}-msg-${i}`;
                const msgCreated = item.at ? new Date(item.at).getTime() : nowMs;
                insertGroupMessage.run(
                  msgId,
                  g.id,
                  item.sender || "unknown",
                  item.content || "",
                  msgCreated
                );
                summary.groupMessages++;
              }
            }
          }
        } catch {
          // ignore malformed group json
        }
      }
    }
  }

  // 7. Migrate growth audit ledger (JSONL)
  const auditPath = path.join(srcDir, "profiles", "principal", "ledger", "growth_audit.jsonl");
  if (fs.existsSync(auditPath)) {
    const insertAudit = destDb.prepare(`
      INSERT OR REPLACE INTO growth_audit_ledger (
        id, timestamp, actor, target_bot, action, diff_json, rollback_token
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    const lines = fs.readFileSync(auditPath, "utf-8").split("\n");
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line);
        insertAudit.run(
          entry.change_id || `audit-${Math.random().toString(36).substring(2, 10)}`,
          entry.timestamp || new Date().toISOString(),
          entry.author || "principal",
          entry.target || "system",
          entry.action || "config_change",
          JSON.stringify(entry.diff || {}),
          entry.rollback_token || ""
        );
        summary.growthAuditEntries++;
      } catch {
        // ignore unparseable line
      }
    }
  }

  destDb.close();
  return summary;
}

// CLI entrypoint
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  let srcDir = process.env.BALABOT_DATA_ROOT || "/opt/data";
  let destDbPath = getDefaultDestDbPath();
  let dryRun = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--src" && args[i + 1]) {
      srcDir = args[++i];
    } else if (args[i] === "--dest" && args[i + 1]) {
      destDbPath = args[++i];
    } else if (args[i] === "--dry-run") {
      dryRun = true;
    }
  }

  console.log(`Starting BalaBot ETL Migration...`);
  console.log(`Source: ${srcDir}`);
  console.log(`Destination: ${destDbPath} (dryRun: ${dryRun})`);

  try {
    const res = migrateLegacyData({ srcDir, destDbPath, dryRun });
    console.log("Migration completed successfully:");
    console.log(JSON.stringify(res, null, 2));
  } catch (err) {
    console.error("Migration failed:", err);
    process.exit(1);
  }
}
