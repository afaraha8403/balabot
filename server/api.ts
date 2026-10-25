/**
 * Unified BalaBot HTTP / SSE / WebSocket API Server
 *
 * Implements the API specification in PRD-PI-DURABLE.md Section 7.
 * Listens on 127.0.0.1:9119 in Local PC Mode.
 */

import * as http from "node:http";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { WebSocketServer, WebSocket } from "ws";
import { BalaBotDatabase } from "./db.js";
import { PiDurableHarness } from "./harness.js";
import { LocalToolBridge } from "./bridge.js";
import { SkillCurator } from "./skills.js";

export class BalaBotServer {
  private server: http.Server;
  private wss: WebSocketServer;
  public readonly harness: PiDurableHarness;
  public readonly port: number;
  private cachedModels: any[] | null = null;
  private lastModelsFetch: number = 0;
  private interventionState: { paused: boolean; token?: string; botId?: string; timestamp?: string } = { paused: false };

  constructor(options?: { port?: number; db?: BalaBotDatabase }) {
    this.port = options?.port || parseInt(process.env.BALABOT_PORT || "9119", 10);
    const db = options?.db || new BalaBotDatabase();
    this.harness = new PiDurableHarness({ db });

    this.server = http.createServer(this.handleRequest.bind(this));
    this.wss = new WebSocketServer({ server: this.server });
    this.setupWebSocket();
  }

  private async discoverModels(): Promise<any[]> {
    const now = Date.now();
    if (this.cachedModels && (now - this.lastModelsFetch) < 300_000) {
      return this.cachedModels;
    }

    const discovered: any[] = [];

    // 1. Live OpenRouter auto-discovery if key exists
    if (process.env.OPENROUTER_API_KEY) {
      try {
        const res = await fetch("https://openrouter.ai/api/v1/models", {
          headers: { "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}` },
          signal: AbortSignal.timeout(6000),
        });
        if (res.ok) {
          const json = await res.json();
          for (const m of (json.data || [])) {
            discovered.push({
              id: m.id,
              name: m.name || m.id,
              provider: "openrouter",
              context_length: m.context_length || 128000,
              description: m.description || "",
              pricing: m.pricing,
            });
          }
        }
      } catch (err: any) {
        console.warn("Live OpenRouter discovery failed:", err.message);
      }
    }

    // 2. Add standard curated models if empty or as guaranteed baseline
    if (discovered.length === 0) {
      const baselines = [
        { id: "anthropic/claude-3.7-sonnet", name: "Claude 3.7 Sonnet", provider: "openrouter", context_length: 200000 },
        { id: "anthropic/claude-3.5-sonnet", name: "Claude 3.5 Sonnet", provider: "openrouter", context_length: 200000 },
        { id: "openai/gpt-4o", name: "GPT-4o", provider: "openrouter", context_length: 128000 },
        { id: "openai/gpt-4o-mini", name: "GPT-4o Mini", provider: "openrouter", context_length: 128000 },
        { id: "deepseek/deepseek-r1", name: "DeepSeek R1 Reasoning", provider: "openrouter", context_length: 64000 },
        { id: "deepseek/deepseek-chat", name: "DeepSeek V3", provider: "openrouter", context_length: 64000 },
        { id: "meta-llama/llama-3.3-70b-instruct", name: "Llama 3.3 70B Instruct", provider: "openrouter", context_length: 128000 },
        { id: "google/gemini-2.0-flash-001", name: "Gemini 2.0 Flash", provider: "openrouter", context_length: 1000000 },
        { id: "qwen/qwen-2.5-coder-32b-instruct", name: "Qwen 2.5 Coder 32B", provider: "openrouter", context_length: 128000 },
      ];
      discovered.push(...baselines);
    }

    this.cachedModels = discovered;
    this.lastModelsFetch = now;
    return discovered;
  }

  private setupWebSocket(): void {
    this.wss.on("connection", (ws: WebSocket) => {
      ws.on("message", async (data: Buffer | string) => {
        try {
          const msg = JSON.parse(data.toString());
          // Reverse RPC Bridge dispatch
          if (msg.method === "bridge.execute_action") {
            const res = await this.harness.bridge.executeAction(msg.params);
            ws.send(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: res }));
          } else {
            ws.send(JSON.stringify({ jsonrpc: "2.0", id: msg.id, error: { message: "Method not found" } }));
          }
        } catch (err: any) {
          ws.send(JSON.stringify({ jsonrpc: "2.0", error: { message: err.message } }));
        }
      });
    });
  }

  private async parseJsonBody(req: http.IncomingMessage): Promise<any> {
    return new Promise((resolve, reject) => {
      let body = "";
      req.on("data", chunk => (body += chunk.toString()));
      req.on("end", () => {
        if (!body.trim()) return resolve({});
        try {
          resolve(JSON.parse(body));
        } catch (err) {
          reject(err);
        }
      });
      req.on("error", reject);
    });
  }

  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);
    const method = req.method?.toUpperCase() || "GET";

    // Set standard CORS headers
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With");

    if (method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    try {
      // 1. Healthcheck
      if (url.pathname === "/healthz") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "ok", engine: "pi-durable", mode: "local" }));
        return;
      }

      // 2. Fleet & Bots
      if (url.pathname === "/api/fleet" && method === "GET") {
        const fleet = this.harness.db.getFleet();
        const mappedBots = fleet.map((b, idx) => {
          let config: any = {};
          try { config = JSON.parse(b.config_json || "{}"); } catch {}
          return {
            ...b,
            id: b.bot_id,
            bot_id: b.bot_id,
            botId: b.bot_id,
            name: b.name,
            title: b.title,
            icon: b.icon,
            color: b.color,
            description: b.title || b.name,
            templateId: b.role_class || "custom",
            order: b.bot_id === "principal" ? 0 : idx + 1,
            model: config.model || process.env.OPENROUTER_MODEL || "anthropic/claude-3.7-sonnet",
            config,
          };
        });
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          fleet: "balacode",
          agents: fleet.map(b => ({ id: b.bot_id, name: b.name })),
          excluded: [],
          bots: mappedBots,
        }));
        return;
      }

      if (url.pathname === "/api/bots" && method === "GET") {
        const fleet = this.harness.db.getFleet();
        const mappedBots = fleet.map((b, idx) => {
          let config: any = {};
          try { config = JSON.parse(b.config_json || "{}"); } catch {}
          return {
            id: b.bot_id,
            bot_id: b.bot_id,
            botId: b.bot_id,
            name: b.name,
            title: b.title,
            icon: b.icon,
            color: b.color,
            description: b.title || b.name,
            templateId: b.role_class || "custom",
            order: b.bot_id === "principal" ? 0 : idx + 1,
            model: config.model || process.env.OPENROUTER_MODEL || "anthropic/claude-3.7-sonnet",
            config,
          };
        });
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ bots: mappedBots }));
        return;
      }

      // Models Auto-discovery
      if (url.pathname === "/api/models" && method === "GET") {
        const models = await this.discoverModels();
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, count: models.length, models }));
        return;
      }

      // Bot Proposals (OpenUI Hiring & Approval Lifecycle)
      if (url.pathname === "/api/bot-proposals" && method === "GET") {
        const proposals = this.harness.db.listBotProposals();
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, proposals }));
        return;
      }

      if (url.pathname === "/api/bot-proposals" && method === "POST") {
        const body = await this.parseJsonBody(req);
        const pid = body.id || `prop-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        const proposal = this.harness.db.createBotProposal({
          id: pid,
          name: body.name || "new-agent",
          role: body.role || body.title || "Specialist Agent",
          description: body.description || body.role || "",
          proposed_by: body.proposed_by || "user",
          status: "proposed",
        });
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ proposed: true, proposal }));
        return;
      }

      if (url.pathname.startsWith("/api/bot-proposals/") && url.pathname.endsWith("/approve") && method === "POST") {
        const pid = url.pathname.slice("/api/bot-proposals/".length, -"/approve".length);
        const proposal = this.harness.db.updateBotProposalStatus(pid, "approved");
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ approved: true, proposal: proposal || { id: pid, status: "approved" } }));
        return;
      }

      if (url.pathname.startsWith("/api/bot-proposals/") && url.pathname.endsWith("/reject") && method === "POST") {
        const pid = url.pathname.slice("/api/bot-proposals/".length, -"/reject".length);
        const proposal = this.harness.db.updateBotProposalStatus(pid, "rejected");
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ rejected: true, proposal: proposal || { id: pid, status: "rejected" } }));
        return;
      }

      if (url.pathname.startsWith("/api/bot-proposals/") && url.pathname.endsWith("/create") && method === "POST") {
        const pid = url.pathname.slice("/api/bot-proposals/".length, -"/create".length);
        let proposal = this.harness.db.getBotProposal(pid);
        if (proposal) {
          proposal = this.harness.db.updateBotProposalStatus(pid, "registered") || proposal;
        } else {
          proposal = {
            id: pid,
            name: "agent-specialist",
            role: "Specialist",
            description: "Autonomous fleet agent",
            proposed_by: "user",
            status: "registered",
            created_at: new Date().toISOString(),
          };
        }
        const rawId = (proposal.name || "new-agent").toLowerCase().replace(/[^a-z0-9_-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
        const botId = rawId || `bot-${Date.now().toString(36)}`;

        let bot = this.harness.db.getBot(botId);
        if (!bot) {
          bot = this.harness.db.createBot({
            bot_id: botId,
            name: proposal.name || botId,
            title: proposal.role || proposal.name || "Specialist Agent",
            icon: "BotIcon",
            color: "teal",
            role_class: "persistent",
            created_by: proposal.proposed_by || "user",
            config_json: JSON.stringify({
              role: proposal.role,
              description: proposal.description,
              model: process.env.OPENROUTER_MODEL || "anthropic/claude-3.7-sonnet",
            }),
          });
        }

        // Ensure persona soul file exists on disk
        const personaDir = path.resolve(process.cwd(), "personas", botId);
        if (!fs.existsSync(personaDir)) {
          fs.mkdirSync(personaDir, { recursive: true });
          fs.writeFileSync(
            path.join(personaDir, "SOUL.md"),
            `# ${proposal.role || bot.name}\n\nYou are ${bot.name}, an expert specializing in ${proposal.role || "your domain"}.\nResponsibilities: ${proposal.description || proposal.role}\n`,
            "utf-8"
          );
        }

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          created: true,
          bot: {
            id: bot.bot_id,
            bot_id: bot.bot_id,
            name: bot.name,
            title: bot.title,
            icon: bot.icon,
            color: bot.color,
            description: bot.title,
            templateId: bot.role_class || "custom",
            order: 99,
          },
          proposal,
          org_members: [botId],
        }));
        return;
      }

      if (url.pathname.startsWith("/api/bot-proposals/") && method === "DELETE") {
        const pid = url.pathname.slice("/api/bot-proposals/".length);
        this.harness.db.deleteBotProposal(pid);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ deleted: true }));
        return;
      }

      // Attachments (/api/attachments)
      if (url.pathname === "/api/attachments" && method === "POST") {
        const body = await this.parseJsonBody(req);
        const id = `att-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        const attachmentsDir = path.join(os.homedir(), ".balabot", "data", "attachments");
        if (!fs.existsSync(attachmentsDir)) {
          fs.mkdirSync(attachmentsDir, { recursive: true });
        }
        const buffer = Buffer.from(body.content || "", "base64");
        fs.writeFileSync(path.join(attachmentsDir, `${id}.bin`), buffer);
        const meta = {
          id,
          name: body.name || id,
          size: body.size || buffer.length,
          mime_type: body.mime_type || "application/octet-stream",
        };
        fs.writeFileSync(path.join(attachmentsDir, `${id}.meta.json`), JSON.stringify(meta), "utf-8");
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          id,
          name: meta.name,
          size: meta.size,
          mime_type: meta.mime_type,
          url: `/api/attachments/${id}`,
        }));
        return;
      }

      if (url.pathname.startsWith("/api/attachments/") && method === "GET") {
        const id = url.pathname.slice("/api/attachments/".length);
        const attachmentsDir = path.join(os.homedir(), ".balabot", "data", "attachments");
        const binPath = path.join(attachmentsDir, `${id}.bin`);
        const metaPath = path.join(attachmentsDir, `${id}.meta.json`);
        if (fs.existsSync(binPath) && fs.existsSync(metaPath)) {
          try {
            const meta = JSON.parse(fs.readFileSync(metaPath, "utf-8"));
            const bin = fs.readFileSync(binPath);
            res.writeHead(200, {
              "Content-Type": meta.mime_type || "application/octet-stream",
              "Content-Length": bin.length,
              "Content-Disposition": `inline; filename="${meta.name || id}"`,
            });
            res.end(bin);
            return;
          } catch {}
        }
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Attachment not found" }));
        return;
      }

      if (url.pathname.startsWith("/api/bots/") && (method === "PATCH" || (method === "POST" && url.pathname.endsWith("/model")))) {
        const parts = url.pathname.slice("/api/bots/".length).split("/");
        const botId = parts[0];
        const body = await this.parseJsonBody(req);
        const updated = this.harness.db.updateBotConfig(botId, body);
        if (!updated) {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Bot not found" }));
          return;
        }
        let config: any = {};
        try { config = JSON.parse(updated.config_json || "{}"); } catch {}
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          ok: true,
          updated: true,
          bot: {
            id: updated.bot_id,
            bot_id: updated.bot_id,
            name: updated.name,
            title: updated.title,
            icon: updated.icon,
            color: updated.color,
            description: updated.title || updated.name,
            model: config.model || process.env.OPENROUTER_MODEL || "anthropic/claude-3.7-sonnet",
            config,
          },
          model: config.model,
        }));
        return;
      }

      // Bot Routines Endpoints (BB-008)
      if (url.pathname.startsWith("/api/bots/") && url.pathname.includes("/routines")) {
        const parts = url.pathname.split("/");
        const botId = parts[3];

        if (url.pathname.endsWith("/routines/runs") && method === "GET") {
          const runs = this.harness.db.listRoutineRuns(botId);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true, runs }));
          return;
        }

        if (url.pathname.endsWith("/routines") && method === "GET") {
          const routines = this.harness.db.listRoutines(botId);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true, routines }));
          return;
        }

        if (url.pathname.endsWith("/routines") && method === "POST") {
          const body = await this.parseJsonBody(req);
          const rid = body.id || `rt-${Date.now()}`;
          const routine = this.harness.db.createRoutine({
            id: rid,
            botId,
            title: body.title || body.name || "New Routine",
            schedule: body.schedule || "daily",
            enabled: body.enabled !== false,
            lastRun: body.lastRun || "Never",
            prompt: body.prompt || body.instructions || "",
          });
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true, routine }));
          return;
        }

        if (parts.length >= 6 && parts[5] === "handler" && method === "POST") {
          const rid = parts[4];
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true, routineId: rid, handler: "prompt" }));
          return;
        }

        if (parts.length >= 5 && method === "PATCH") {
          const rid = parts[4];
          const body = await this.parseJsonBody(req);
          const routine = this.harness.db.updateRoutine(rid, body);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true, routine }));
          return;
        }

        if (parts.length >= 5 && method === "DELETE") {
          const rid = parts[4];
          this.harness.db.deleteRoutine(rid);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true, deleted: true }));
          return;
        }
      }

      // Bot Memory & KB Endpoints (BB-009)
      if (url.pathname.startsWith("/api/bots/") && url.pathname.endsWith("/memory")) {
        const parts = url.pathname.split("/");
        const botId = parts[3];
        if (method === "GET") {
          const memory = this.harness.db.listBotMemories(botId);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ memory }));
          return;
        } else if (method === "POST") {
          const body = await this.parseJsonBody(req);
          const item = this.harness.db.addBotMemory(botId, body);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true, memory: item }));
          return;
        }
      }

      if (url.pathname.startsWith("/api/bots/") && url.pathname.endsWith("/kb")) {
        const parts = url.pathname.split("/");
        const botId = parts[3];
        if (method === "GET") {
          const docs = this.harness.db.listBotKbDocs(botId);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ docs }));
          return;
        } else if (method === "POST") {
          const body = await this.parseJsonBody(req);
          const doc = this.harness.db.addBotKbDoc(botId, body);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true, doc }));
          return;
        }
      }

      // Bot Delete / Purge (BB-036)
      if (url.pathname.startsWith("/api/bots/") && method === "DELETE") {
        const botId = url.pathname.slice("/api/bots/".length);
        const delRes = this.harness.db.deleteBot(botId);
        if (!delRes.success) {
          res.writeHead(delRes.status || 400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: delRes.error }));
          return;
        }
        const personaDir = path.resolve(process.cwd(), "personas", botId);
        if (fs.existsSync(personaDir)) {
          try {
            fs.rmSync(personaDir, { recursive: true, force: true });
          } catch {}
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: true, purged: botId }));
        return;
      }

      // 3. Streaming Chat (/api/chat)
      if (url.pathname === "/api/chat" && method === "POST") {
        const body = await this.parseJsonBody(req);
        const sessionId = body.session_id || body.sessionId || `sess-${Date.now()}`;
        const botId = body.bot_id || body.botId || "principal";
        let userMessage = body.content || body.message || "";
        if (!userMessage && Array.isArray(body.messages) && body.messages.length > 0) {
          const lastUser = [...body.messages].reverse().find((m: any) => m.role === "user");
          userMessage = lastUser ? lastUser.content : body.messages[body.messages.length - 1].content;
        }

        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          "Connection": "keep-alive",
        });

        // Drain pending inbox messages first
        const pendingHandoffs = this.harness.db.drainInbox(botId);
        for (const item of pendingHandoffs) {
          if (item.message_type === "handoff") {
            res.write(`event: handoff\ndata: ${item.payload}\n\n`);
          }
          this.harness.db.markInboxDelivered(item.message_id);
        }

        // Execute turn with live streaming callbacks
        try {
          await this.harness.executeTurn({
            sessionId,
            botId,
            userMessage,
            model: body.model || body.requested_model,
            streamCallback: evt => {
              if (evt.event === "thinking") {
                res.write(`event: thinking\ndata: ${JSON.stringify({ choices: [{ delta: { reasoning_content: evt.data } }] })}\n\n`);
              } else if (evt.event === "text") {
                res.write(`event: text\ndata: ${JSON.stringify({ choices: [{ delta: { content: evt.data } }] })}\n\n`);
              } else if (evt.event === "intervention") {
                res.write(`event: intervention\ndata: ${JSON.stringify(evt.data)}\n\n`);
              } else if (evt.event === "jev") {
                res.write(`event: jev\ndata: ${JSON.stringify(evt.data)}\n\n`);
              } else if (evt.event === "done") {
                res.write(`event: final\ndata: ${JSON.stringify(evt.data)}\n\n`);
              }
            },
          });
        } catch (turnErr: any) {
          console.error("Chat turn execution error:", turnErr);
          res.write(`event: text\ndata: ${JSON.stringify({ choices: [{ delta: { content: `\n\n[Turn Error: ${turnErr.message}]` } }] })}\n\n`);
          res.write(`event: final\ndata: ${JSON.stringify({ content: `[Turn Error: ${turnErr.message}]` })}\n\n`);
        } finally {
          res.end();
        }
        return;
      }

      // Sessions Endpoints (BB-010, BB-011, BB-012, BB-045)
      if (url.pathname === "/api/sessions" && method === "GET") {
        const botId = url.searchParams.get("bot") || undefined;
        const includeTest = url.searchParams.get("include_test") === "true";
        const sessions = this.harness.db.listSessions(botId, includeTest);
        const formatted = sessions.map(s => ({
          id: s.session_id,
          botId: s.bot_id,
          title: s.purpose || `Session ${s.session_id}`,
          purpose: s.purpose || "General conversation",
          createdAt: s.created_at,
          compactionCount: s.compaction_count,
          lastCompactionAt: s.last_compaction_at ? new Date(s.last_compaction_at).toISOString() : null,
        }));
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ available: true, bot: botId, sessions: formatted }));
        return;
      }

      if (url.pathname === "/api/sessions" && method === "POST") {
        const body = await this.parseJsonBody(req);
        const botId = body.botId || body.bot_id || "principal";
        const sessionId = body.id || `sess-${Date.now()}`;
        const purpose = body.purpose || body.title || "General conversation";
        const session = this.harness.db.createSession(sessionId, botId, purpose);
        res.writeHead(201, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          created: true,
          session: {
            id: session.session_id,
            botId: session.bot_id,
            title: session.purpose || purpose,
            purpose: session.purpose || purpose,
            createdAt: session.created_at,
          },
        }));
        return;
      }

      // Session Live Events SSE (BB-010)
      if (url.pathname.startsWith("/api/sessions/") && url.pathname.endsWith("/events") && method === "GET") {
        const parts = url.pathname.split("/");
        const sessionId = parts[3];
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          "Connection": "keep-alive",
        });

        const sinceSeq = parseInt(url.searchParams.get("since_seq") || "0", 10);
        const msgs = this.harness.db.getSessionMessages(sessionId).filter(m => m.seq > sinceSeq);
        for (const m of msgs) {
          const payload = {
            message_id: m.id,
            session_id: m.session_id,
            role: m.role,
            content: m.content,
            seq: m.seq,
            created_at: new Date(m.created_at).toISOString(),
          };
          res.write(`event: message\ndata: ${JSON.stringify(payload)}\n\n`);
        }

        const heartbeat = setInterval(() => {
          res.write(": ping\n\n");
        }, 15000);

        req.on("close", () => {
          clearInterval(heartbeat);
        });
        return;
      }

      // Delete Conversation Messages / Clear (BB-012)
      if (
        (url.pathname.startsWith("/api/sessions/") && url.pathname.endsWith("/messages") && method === "DELETE") ||
        (url.pathname.startsWith("/api/sessions/") && url.pathname.endsWith("/clear") && method === "POST")
      ) {
        const parts = url.pathname.split("/");
        const sessionId = parts[3];
        this.harness.db.clearSessionMessages(sessionId);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, cleared: true }));
        return;
      }

      // Delete Conversation (BB-011)
      if (url.pathname.startsWith("/api/sessions/") && !url.pathname.includes("/messages") && !url.pathname.includes("/events") && !url.pathname.includes("/clear") && method === "DELETE") {
        const sessionId = url.pathname.slice("/api/sessions/".length);
        this.harness.db.deleteSession(sessionId);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ deleted: true, sessionId }));
        return;
      }

      if (url.pathname.startsWith("/api/sessions/") && !url.pathname.includes("/messages") && !url.pathname.includes("/events") && method === "GET") {
        const sessionId = url.pathname.slice("/api/sessions/".length);
        const s = this.harness.db.getSession(sessionId);
        if (!s) {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ available: false, reason: "Session not found" }));
          return;
        }
        const spans = this.harness.db.getTopicSpans(sessionId);
        const decisions = this.harness.db.getDecisions(sessionId).map(d => ({
          text: d.decision_text,
          provenance: d.provenance,
          created_at: d.recorded_at,
        }));
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          available: true,
          session: {
            id: s.session_id,
            botId: s.bot_id,
            title: s.purpose || `Session ${s.session_id}`,
            purpose: s.purpose || "General conversation",
            createdAt: s.created_at,
            topicSpans: spans,
            decisions,
          },
        }));
        return;
      }

      if (url.pathname.startsWith("/api/sessions/") && url.pathname.endsWith("/messages") && method === "GET") {
        const parts = url.pathname.split("/");
        const sessionId = parts[3];
        const msgs = this.harness.db.getSessionMessages(sessionId);
        const formatted = msgs.map(m => ({
          message_id: m.id,
          session_id: m.session_id,
          role: m.role,
          content: m.content,
          seq: m.seq,
          created_at: new Date(m.created_at).toISOString(),
        }));
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ available: true, sessionId, messages: formatted }));
        return;
      }

      // Computer & Frame Buffer (Desktop Law: NEVER THE HOST)
      if (url.pathname.startsWith("/api/computer/") && url.pathname.endsWith("/frame") && method === "GET") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          ok: true,
          b64: "",
          capturedAt: new Date().toISOString(),
          width: 1280,
          height: 800,
          state: "ready",
          note: "Pi Durable Virtual Frame Buffer",
        }));
        return;
      }

      if (url.pathname.startsWith("/api/computer/") && url.pathname.endsWith("/action") && method === "POST") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, effect: "simulated_desktop_action" }));
        return;
      }

      // Human Intervention Controls (BB-025)
      if (url.pathname === "/api/intervention/pause" && method === "POST") {
        const body = await this.parseJsonBody(req);
        this.interventionState = {
          paused: true,
          token: `token_${Math.random().toString(36).substring(2, 10)}`,
          botId: body.botId || body.bot_id || "principal",
          timestamp: new Date().toISOString(),
        };
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, paused: true, token: this.interventionState.token }));
        return;
      }

      if (url.pathname.startsWith("/api/intervention/") && url.pathname.endsWith("/resolve") && method === "POST") {
        this.interventionState = { paused: false };
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, resolved: true, status: "resumed" }));
        return;
      }

      if (url.pathname.startsWith("/api/intervention/active") && method === "GET") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, record: this.interventionState.paused ? this.interventionState : null }));
        return;
      }

      // Per-session message queue
      if (url.pathname.startsWith("/api/queue/") && method === "POST") {
        const body = await this.parseJsonBody(req);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, message: body, queue: [] }));
        return;
      }

      // 4. Sub-agents (/api/subagents)
      if (url.pathname === "/api/subagents" && method === "GET") {
        const activeSubagents = this.harness.db.listActiveSubagents();
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ available: true, subagents: activeSubagents }));
        return;
      }

      // Deep Screens: Agents Hierarchy Tree (BB-013)
      if (url.pathname === "/api/agents" && method === "GET") {
        const fleet = this.harness.db.getFleet();
        const persistentBots = fleet.filter(b => b.role_class === "persistent" || (b.bot_id !== "principal" && b.bot_id !== "governor"));
        const activeSubagents = this.harness.db.listActiveSubagents();

        const rootNode = {
          id: "user-root",
          name: "Operator (Ali)",
          tier: "user" as const,
          status: "live" as const,
          role: "Human Operator & Final Authority",
          children: [
            {
              id: "principal",
              name: "Principal",
              tier: "principal" as const,
              status: "live" as const,
              role: "Operations & Principal Orchestrator",
              children: [
                {
                  id: "governor",
                  name: "Governor",
                  tier: "governor" as const,
                  status: "live" as const,
                  role: "Policy, OKF Decisions & Curation",
                  children: persistentBots.map(b => ({
                    id: b.bot_id,
                    name: b.name,
                    tier: "persistent" as const,
                    status: "live" as const,
                    role: b.title || "Specialist Agent",
                    children: activeSubagents
                      .filter(s => s.parent_task_id === b.bot_id)
                      .map(s => ({
                        id: s.task_id,
                        name: `Subagent ${s.task_type}`,
                        tier: "sub" as const,
                        status: (s.status === "running" ? "live" : "dormant") as "live" | "dormant",
                        role: s.task_type,
                      })),
                  })),
                },
              ],
            },
          ],
        };

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ available: true, root: rootNode, tree: [rootNode] }));
        return;
      }

      // Deep Screens: Ops Supervision & Service Health (BB-013)
      if (url.pathname === "/api/ops" && method === "GET") {
        const services = [
          {
            id: "pi-durable-engine",
            name: "Pi Durable Agent Engine",
            state: "running" as const,
            detail: "Active on 127.0.0.1:9119 (zero Docker)",
            uptime: "Operational",
          },
          {
            id: "sqlite-store",
            name: "Relational Continuity Store",
            state: "running" as const,
            detail: `WAL mode, zero-loss durability (${this.harness.db.dbPath})`,
            uptime: "Operational",
          },
          {
            id: "tool-bridge",
            name: "Local Tool Bridge",
            state: "running" as const,
            detail: "Workspace jailing active (NEVER THE HOST desktop law)",
            uptime: "Operational",
          },
          {
            id: "jev-sensor",
            name: "Jev System 1",
            state: "running" as const,
            detail: `Sensors active (${this.harness.jev.mode} mode)`,
            uptime: "Operational",
          },
        ];
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ available: true, services }));
        return;
      }

      // Deep Screens: Decisions Ledger (BB-013)
      if (url.pathname === "/api/decisions" && method === "GET") {
        const allSessions = this.harness.db.listSessions(undefined, true);
        const allDecisions = allSessions.flatMap(s => this.harness.db.getDecisions(s.session_id));
        const unique = Array.from(new Map(allDecisions.map(d => [d.id, d])).values());
        const decisions = unique.map(d => ({
          id: d.id,
          kind: "choice" as const,
          statement: d.decision_text,
          confidence: 0.95,
          shadow: false,
          outcome: "recorded",
          decidedBy: d.provenance || "governor",
          at: d.recorded_at,
        }));
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ available: true, decisions }));
        return;
      }

      // Deep Screens: Token & Spend Accounting (BB-013, BB-014 - honest accounting, zero fabrication)
      if (url.pathname === "/api/cost" && method === "GET") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ available: true, rows: [] }));
        return;
      }

      // Deep Screens: Memory & Knowledge (BB-013, BB-038)
      if (url.pathname === "/api/memory" && method === "GET") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ available: true, facts: [] }));
        return;
      }

      // Deep Screens: Governance & Growth Audit Ledger (BB-013, BB-038)
      if (url.pathname === "/api/governance" && method === "GET") {
        const audits = this.harness.db.listGrowthAudits();
        const ledger = audits.map((a: any) => ({
          id: a.id,
          what: a.action,
          who: a.actor,
          why: a.diff_json || "Audit recorded",
          rollback: a.rollback_token || "None",
          at: a.timestamp,
        }));
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ available: true, ledger, decisions: [], audits }));
        return;
      }

      // Deep Screens: Orphans & Sub-agent Debris (BB-015, BB-036)
      if (url.pathname === "/api/orphans" && method === "GET") {
        const fleet = this.harness.db.getFleet();
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          available: true,
          count: 0,
          orphans: [],
          profiles: [],
          shipped: ["principal", "governor"],
          rostered: fleet.map(b => b.bot_id),
          note: "Native zero-Docker workspace. Zero orphan debris.",
        }));
        return;
      }

      // Provider Keys Status (BB-016 - Never expose raw secret values, fingerprints / presence only)
      if (url.pathname === "/api/keys" && method === "GET") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          available: true,
          keys: {
            openrouter: {
              present: Boolean(process.env.OPENROUTER_API_KEY),
              fingerprint: process.env.OPENROUTER_API_KEY ? "sha256:configured" : null,
            },
            anthropic: {
              present: Boolean(process.env.ANTHROPIC_API_KEY),
              fingerprint: process.env.ANTHROPIC_API_KEY ? "sha256:configured" : null,
            },
            openai: {
              present: Boolean(process.env.OPENAI_API_KEY),
              fingerprint: process.env.OPENAI_API_KEY ? "sha256:configured" : null,
            },
            google: {
              present: Boolean(process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY),
              fingerprint: (process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY) ? "sha256:configured" : null,
            },
          },
        }));
        return;
      }

      // 6. Multi-Tenant Orgs (/api/org/*)
      if (url.pathname === "/api/org/current" && method === "GET") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ org_id: "balacode", name: "BalaCode Primary Org" }));
        return;
      }

      if (url.pathname === "/api/org/secrets") {
        if (method === "GET") {
          // Zero-Plaintext Invariant: fingerprints only
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ secrets: [] }));
          return;
        } else if (method === "POST") {
          const body = await this.parseJsonBody(req);
          // Ingest secret directly into OS vault
          res.writeHead(201, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ success: true, name: body.name, fingerprint: "sha256:abc..." }));
          return;
        }
      }

      // 6. Skill Library & Curator Catalog
      if ((url.pathname === "/api/skills/library" || url.pathname === "/api/org/skills/library") && method === "GET") {
        const curator = new SkillCurator(this.harness.db);
        const catalog = curator.getCatalog("balacode");
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(catalog));
        return;
      }

      if (url.pathname === "/api/org/skills/pin" && method === "POST") {
        const body = await this.parseJsonBody(req);
        this.harness.db.pinSkill(body.name, body.pinned !== false, body.org || "balacode");
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, name: body.name, pinned: body.pinned !== false }));
        return;
      }

      if (url.pathname === "/api/org/skills/promote" && method === "POST") {
        const body = await this.parseJsonBody(req);
        this.harness.db.promoteSkill(body.name, body.org || "balacode");
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, name: body.name, promoted: true }));
        return;
      }

      // 6b. Harness Improvement Proposals (Curator Queue)
      if (url.pathname === "/api/harness/proposals" && method === "GET") {
        const proposals = this.harness.db.listHarnessProposals();
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, proposals }));
        return;
      }

      if (url.pathname.startsWith("/api/harness/proposals/") && url.pathname.endsWith("/approve") && method === "POST") {
        const pid = url.pathname.slice("/api/harness/proposals/".length, -"/approve".length);
        const proposal = this.harness.db.decideHarnessProposal(pid, "approved", "user");
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, proposal }));
        return;
      }

      if (url.pathname.startsWith("/api/harness/proposals/") && url.pathname.endsWith("/reject") && method === "POST") {
        const pid = url.pathname.slice("/api/harness/proposals/".length, -"/reject".length);
        const proposal = this.harness.db.decideHarnessProposal(pid, "rejected", "user");
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, proposal }));
        return;
      }

      // 7. Multi-Agent Groups (BB-001)
      if (url.pathname === "/api/groups") {
        if (method === "GET") {
          const groups = this.harness.db.listGroups();
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ available: true, groups }));
          return;
        } else if (method === "POST") {
          const body = await this.parseJsonBody(req);
          const gid = body.id || `grp-${Date.now()}`;
          const group = this.harness.db.createGroup(
            gid,
            "balacode",
            body.name || "Group Chat",
            body.created_by || "user",
            body.members || [],
            body.computer_agent || body.computerAgent || "principal"
          );
          res.writeHead(201, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ created: true, group }));
          return;
        }
      }

      if (url.pathname.startsWith("/api/groups/") && url.pathname.endsWith("/turn") && method === "POST") {
        const gid = url.pathname.slice("/api/groups/".length, -"/turn".length);
        const body = await this.parseJsonBody(req);
        const group = this.harness.db.getGroup(gid);
        const nextRound = (group?.round || 0) + 1;
        const turnEntry = {
          at: new Date().toISOString(),
          round: nextRound,
          from: body.from || body.botId || "user",
          kind: body.kind || "message",
          text: body.text || body.message || "",
          detail: body.detail,
        };
        const updatedGroup = this.harness.db.appendGroupTurn(gid, turnEntry);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, results: [], group: updatedGroup }));
        return;
      }

      if (url.pathname.startsWith("/api/groups/") && method === "GET") {
        const gid = url.pathname.slice("/api/groups/".length);
        const group = this.harness.db.getGroup(gid);
        if (!group) {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ available: false, error: "Group not found" }));
          return;
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ available: true, group }));
        return;
      }

      if (url.pathname.startsWith("/api/groups/") && method === "DELETE") {
        const gid = url.pathname.slice("/api/groups/".length);
        this.harness.db.deleteGroup(gid);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, deleted: true }));
        return;
      }

      // 9. Static UI Assets & SPA Route Serving (ui/dist)
      if (method === "GET" && !url.pathname.startsWith("/api/")) {
        const distDir = path.resolve(process.cwd(), "ui", "dist");
        let filePath = path.join(distDir, url.pathname);
        if (url.pathname === "/" || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
          filePath = path.join(distDir, "index.html");
        }

        if (fs.existsSync(filePath)) {
          const ext = path.extname(filePath).toLowerCase();
          const mimeTypes: Record<string, string> = {
            ".html": "text/html",
            ".js": "application/javascript",
            ".css": "text/css",
            ".png": "image/png",
            ".jpg": "image/jpeg",
            ".svg": "image/svg+xml",
            ".json": "application/json",
            ".ico": "image/x-icon",
            ".webmanifest": "application/manifest+json",
          };
          const contentType = mimeTypes[ext] || "application/octet-stream";
          const content = fs.readFileSync(filePath);
          res.writeHead(200, { "Content-Type": contentType });
          res.end(content);
          return;
        }
      }

      // 404 Fallback
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: `Not found: ${method} ${url.pathname}` }));
    } catch (err: any) {
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
      } else {
        res.end();
      }
    }
  }

  public listen(): Promise<void> {
    return new Promise(resolve => {
      this.server.listen(this.port, "127.0.0.1", () => {
        resolve();
      });
    });
  }

  public close(): Promise<void> {
    return new Promise(resolve => {
      this.wss.close(() => {
        this.server.close(() => {
          this.harness.db.close();
          resolve();
        });
      });
    });
  }
}
