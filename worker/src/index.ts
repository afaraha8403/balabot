/**
 * Cloudflare Worker: Multi-Tenant Agent Pi Host (PiHarness on Durable Objects)
 *
 * Implements the edge architecture specified in PRD-PI-DURABLE.md Section 2.2 and Section 4.
 * Each agent is isolated by composite key: ${tenant_id}:${org_id}:${bot_id}
 * Persists to zero-latency co-located SQLite (this.sql) with pi_* schema.
 */

import { DurableObject } from "cloudflare:workers";
import { UNIFIED_SCHEMA } from "../../scripts/migrate_legacy_data.js";

export interface Env {
  BalaBotAgent: DurableObjectNamespace<BalaBotAgent>;
  AI?: any;
  TYPESAFE_API_KEY?: string;
  JEV_MODE?: string;
}

export class BalaBotAgent extends DurableObject<Env> {
  private sql: any;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // Durable Object co-located SQLite
    this.sql = (this.ctx.storage as any).sql;
    this.initDatabase();
  }

  private initDatabase(): void {
    if (this.sql) {
      // Execute unified schema
      const statements = UNIFIED_SCHEMA.split(";")
        .map(s => s.trim())
        .filter(s => s.length > 0);
      for (const stmt of statements) {
        this.sql.exec(stmt);
      }
    }
  }

  /**
   * Durable Object Alarm handler for scheduled routines & Pi wake() scheduler.
   */
  async alarm(): Promise<void> {
    console.log(`[BalaBotAgent Alarm] Waking up for scheduled tasks or routine execution.`);
    // Inspect pending tasks in pi_tasks where wake_at <= now
    const nowMs = Date.now();
    if (this.sql) {
      const cursor = this.sql.exec(
        "SELECT * FROM pi_tasks WHERE status = 'pending' AND wake_at IS NOT NULL AND wake_at <= ?",
        nowMs
      );
      for (const task of cursor) {
        console.log(`[Alarm Processing Task] ID: ${task.task_id}, Type: ${task.task_type}`);
        this.sql.exec(
          "UPDATE pi_tasks SET status = 'completed', updated_at = ? WHERE task_id = ?",
          nowMs,
          task.task_id
        );
      }
    }
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // 1. Healthcheck
    if (url.pathname === "/healthz") {
      return new Response(
        JSON.stringify({
          status: "ok",
          engine: "pi-durable",
          host: "cloudflare-workers",
          mode: "cloudflare",
          partition: this.ctx.id.toString(),
        }),
        { headers: { "Content-Type": "application/json" } }
      );
    }

    // 2. Transcripts & Messages query
    if (url.pathname === "/api/messages" && request.method === "GET") {
      const sessionId = url.searchParams.get("session_id");
      if (!sessionId || !this.sql) {
        return new Response(JSON.stringify({ messages: [] }), { headers: { "Content-Type": "application/json" } });
      }
      const cursor = this.sql.exec("SELECT * FROM pi_messages WHERE session_id = ? ORDER BY seq ASC", sessionId);
      const messages = Array.from(cursor);
      return new Response(JSON.stringify({ messages }), { headers: { "Content-Type": "application/json" } });
    }

    // 3. Streaming Chat turn
    if (url.pathname === "/api/chat" && request.method === "POST") {
      const body: any = await request.json().catch(() => ({}));
      const sessionId = body.session_id || `sess-${Date.now()}`;
      const userContent = body.content || body.message || "";
      const nowMs = Date.now();

      // Pre-execution Journaling in DO SQLite
      if (this.sql) {
        this.sql.exec(
          "INSERT OR IGNORE INTO pi_sessions (session_id, agent_id, bot_id, created_at, updated_at) VALUES (?, 'agent', 'bot', ?, ?)",
          sessionId,
          nowMs,
          nowMs
        );
        this.sql.exec(
          "INSERT INTO pi_messages (id, session_id, seq, role, content, created_at) VALUES (?, ?, (SELECT COALESCE(MAX(seq), 0) + 1 FROM pi_messages WHERE session_id = ?), 'user', ?, ?)",
          `msg-${nowMs}`,
          sessionId,
          sessionId,
          userContent,
          nowMs
        );
      }

      // Return SSE stream
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        start(controller) {
          const thinkingPayload = {
            choices: [{ delta: { reasoning_content: "Processing request in Cloudflare Edge Durable Object..." } }],
          };
          const textPayload = {
            choices: [{ delta: { content: `Hello from BalaBot on Cloudflare Edge! Persistent state committed to this.sql.` } }],
          };

          controller.enqueue(encoder.encode(`event: thinking\ndata: ${JSON.stringify(thinkingPayload)}\n\n`));
          controller.enqueue(encoder.encode(`event: text\ndata: ${JSON.stringify(textPayload)}\n\n`));
          controller.enqueue(encoder.encode(`event: final\ndata: {"status":"complete"}\n\n`));
          controller.close();
        },
      });

      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          "Connection": "keep-alive",
        },
      });
    }

    return new Response(JSON.stringify({ error: "Route not found" }), { status: 404 });
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Multi-tenant partition key: ${tenant_id}:${org_id}:${bot_id}
    const tenantId = request.headers.get("x-tenant-id") || "default";
    const orgId = request.headers.get("x-org-id") || "balacode";
    const botId = url.searchParams.get("bot_id") || "principal";
    const partitionKey = `${tenantId}:${orgId}:${botId}`;

    const id = env.BalaBotAgent.idFromName(partitionKey);
    const agentStub = env.BalaBotAgent.get(id);

    return agentStub.fetch(request);
  },
};
