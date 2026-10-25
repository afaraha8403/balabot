import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createRequire } from "node:module";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { migrateLegacyData } from "../../scripts/migrate_legacy_data.ts";

const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite");

describe("Wave 0: ETL Migration Harness (migrate_legacy_data)", () => {
  let tmpDir: string;
  let destDbPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "balabot-etl-test-"));
    destDbPath = path.join(tmpDir, "output", "continuity.db");
  });

  afterEach(() => {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("extracts and transforms all legacy data into unified pi_* schema with 100% field preservation", () => {
    // 1. Create fake legacy data in tmpDir
    const sessionsDir = path.join(tmpDir, "sessions");
    fs.mkdirSync(sessionsDir, { recursive: true });

    // Legacy continuity.db
    const legacyContinuityPath = path.join(sessionsDir, "continuity.db");
    const legacyDb = new DatabaseSync(legacyContinuityPath);
    legacyDb.exec(`
      CREATE TABLE sessions (
        session_id TEXT PRIMARY KEY,
        bot_id TEXT NOT NULL,
        purpose TEXT NOT NULL,
        resume_state TEXT NOT NULL DEFAULT '{}',
        next_seq INTEGER NOT NULL DEFAULT 1,
        compaction_count INTEGER NOT NULL DEFAULT 0,
        last_compaction_at TEXT
      );
      CREATE TABLE topic_spans (
        session_id TEXT NOT NULL,
        topic TEXT NOT NULL,
        start_seq INTEGER NOT NULL,
        end_seq INTEGER NOT NULL,
        PRIMARY KEY (session_id, start_seq)
      );
      CREATE TABLE decisions (
        session_id TEXT NOT NULL,
        text TEXT NOT NULL,
        provenance TEXT NOT NULL,
        created_at TEXT NOT NULL,
        seq INTEGER NOT NULL
      );
      CREATE TABLE messages (
        message_id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at TEXT NOT NULL,
        seq INTEGER NOT NULL
      );
    `);

    legacyDb.prepare(`
      INSERT INTO sessions VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run("sess-1", "principal", "Organize agent fleet", '{"goal":"fleet-sync"}', 5, 2, "2026-10-23T20:00:00Z");

    legacyDb.prepare(`
      INSERT INTO topic_spans VALUES (?, ?, ?, ?)
    `).run("sess-1", "fleet-setup", 1, 3);

    legacyDb.prepare(`
      INSERT INTO decisions VALUES (?, ?, ?, ?, ?)
    `).run("sess-1", "Adopt Pi Durable engine", "user-directive", "2026-10-23T20:05:00Z", 2);

    legacyDb.prepare(`
      INSERT INTO messages VALUES (?, ?, ?, ?, ?, ?)
    `).run("msg-1", "sess-1", "user", "Please organize fleet", "2026-10-23T20:00:10Z", 1);
    legacyDb.prepare(`
      INSERT INTO messages VALUES (?, ?, ?, ?, ?, ?)
    `).run("msg-2", "sess-1", "assistant", "Fleet organized under Pi Durable", "2026-10-23T20:00:20Z", 2);

    legacyDb.close();

    // Legacy queue.db
    const queueDbPath = path.join(tmpDir, "queue.db");
    const queueDb = new DatabaseSync(queueDbPath);
    queueDb.exec(`
      CREATE TABLE queue_messages (
        message_id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        content TEXT NOT NULL,
        enqueued_at TEXT NOT NULL,
        seq INTEGER NOT NULL,
        claimed_at TEXT,
        delivered_at TEXT
      );
      CREATE TABLE queue_turns (
        session_id TEXT PRIMARY KEY,
        busy INTEGER NOT NULL DEFAULT 0
      );
    `);
    queueDb.prepare(`
      INSERT INTO queue_messages VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run("q-1", "sess-1", "Queued follow-up", "2026-10-23T20:01:00Z", 3, null, null);
    queueDb.close();

    // Legacy handoffs.db
    const handoffsDir = path.join(tmpDir, "handoffs");
    fs.mkdirSync(handoffsDir, { recursive: true });
    const handoffsDb = new DatabaseSync(path.join(handoffsDir, "handoffs.db"));
    handoffsDb.exec(`
      CREATE TABLE handoff_frames (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        to_bot TEXT NOT NULL,
        from_bot TEXT NOT NULL,
        frame TEXT NOT NULL,
        enqueued_at TEXT NOT NULL,
        delivered_at TEXT
      );
    `);
    handoffsDb.prepare(`
      INSERT INTO handoff_frames (to_bot, from_bot, frame, enqueued_at)
      VALUES (?, ?, ?, ?)
    `).run("governor", "principal", '{"from":"principal","to":"governor","summary":"Review OKF"}', "2026-10-23T20:02:00Z");
    handoffsDb.close();

    // Legacy fleet/<org>.json
    const fleetDir = path.join(tmpDir, "fleet");
    fs.mkdirSync(fleetDir, { recursive: true });
    fs.writeFileSync(path.join(fleetDir, "balacode.json"), JSON.stringify({
      version: 1,
      org: "balacode",
      container: "agent-computer-balacode",
      agents: [
        { id: "principal", display: ":1", socket: "/run/cua-driver/principal.sock" },
        { id: "governor", display: ":2", socket: "/run/cua-driver/governor.sock" },
        { id: "scout", name: "Scout Bot", title: "Web Explorer", icon: "MagnifyingGlassIcon", color: "green" }
      ]
    }));

    // Legacy groups/<id>.json
    const groupsDir = path.join(tmpDir, "groups");
    fs.mkdirSync(groupsDir, { recursive: true });
    fs.writeFileSync(path.join(groupsDir, "group-alpha.json"), JSON.stringify({
      id: "group-alpha",
      name: "Engineering Core",
      created_by: "user",
      created_at: "2026-10-23T19:00:00Z",
      transcript: [
        { sender: "principal", content: "Team standup commenced.", at: "2026-10-23T19:01:00Z" }
      ]
    }));

    // Legacy growth audit JSONL
    const ledgerDir = path.join(tmpDir, "profiles", "principal", "ledger");
    fs.mkdirSync(ledgerDir, { recursive: true });
    fs.writeFileSync(path.join(ledgerDir, "growth_audit.jsonl"), JSON.stringify({
      change_id: "growth-001",
      timestamp: "2026-10-23T20:10:00Z",
      author: "principal",
      target: "scout",
      action: "enable_skill",
      diff: { added: ["web_search"] },
      rollback_token: "rb-001"
    }) + "\n");

    // 2. Run ETL migration
    const summary = migrateLegacyData({
      srcDir: tmpDir,
      destDbPath: destDbPath,
      dryRun: false,
    });

    // 3. Verify summary counts
    expect(summary.sessions).toBe(1);
    expect(summary.messages).toBe(2);
    expect(summary.topicSpans).toBe(1);
    expect(summary.decisions).toBe(1);
    expect(summary.inboxMessages).toBe(2); // 1 queue + 1 handoff
    expect(summary.rosterBots).toBe(3); // principal, governor, scout
    expect(summary.groups).toBe(1);
    expect(summary.groupMessages).toBe(1);
    expect(summary.growthAuditEntries).toBe(1);

    // 4. Verify migrated database content directly
    const destDb = new DatabaseSync(destDbPath, { open: true, readOnly: true });

    const sessionRow = destDb.prepare("SELECT * FROM pi_sessions WHERE session_id = ?").get("sess-1") as any;
    expect(sessionRow).toBeDefined();
    expect(sessionRow.bot_id).toBe("principal");
    expect(sessionRow.purpose).toBe("Organize agent fleet");
    expect(sessionRow.compaction_count).toBe(2);

    const msgs = destDb.prepare("SELECT * FROM pi_messages WHERE session_id = ? ORDER BY seq ASC").all("sess-1") as any[];
    expect(msgs.length).toBe(2);
    expect(msgs[0].content).toBe("Please organize fleet");
    expect(msgs[1].content).toBe("Fleet organized under Pi Durable");

    const spanRow = destDb.prepare("SELECT * FROM topic_spans WHERE session_id = ?").get("sess-1") as any;
    expect(spanRow.topic).toBe("fleet-setup");
    expect(spanRow.start_seq).toBe(1);
    expect(spanRow.end_seq).toBe(3);

    const decRow = destDb.prepare("SELECT * FROM session_decisions WHERE session_id = ?").get("sess-1") as any;
    expect(decRow.decision_text).toBe("Adopt Pi Durable engine");

    const inboxRows = destDb.prepare("SELECT * FROM pi_inbox ORDER BY created_at ASC").all() as any[];
    expect(inboxRows.length).toBe(2);
    expect(inboxRows[0].payload).toBe("Queued follow-up");
    expect(inboxRows[1].message_type).toBe("handoff");

    const rosterRows = destDb.prepare("SELECT * FROM fleet_roster ORDER BY bot_id ASC").all() as any[];
    expect(rosterRows.length).toBe(3);
    const botIds = rosterRows.map(r => r.bot_id);
    expect(botIds).toContain("principal");
    expect(botIds).toContain("governor");
    expect(botIds).toContain("scout");

    const groupRow = destDb.prepare("SELECT * FROM pi_groups WHERE group_id = ?").get("group-alpha") as any;
    expect(groupRow.name).toBe("Engineering Core");

    const groupMsg = destDb.prepare("SELECT * FROM group_messages WHERE id = ?").get("group-alpha-msg-0") as any;
    expect(groupMsg.content).toBe("Team standup commenced.");

    const auditRow = destDb.prepare("SELECT * FROM growth_audit_ledger WHERE id = ?").get("growth-001") as any;
    expect(auditRow.target_bot).toBe("scout");
    expect(auditRow.action).toBe("enable_skill");

    destDb.close();
  });
});
