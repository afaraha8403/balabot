/**
 * Pi Durable Agent Harness Engine
 *
 * Replaces the legacy Hermes gateway with transactional SQLite durability:
 *   - Pre-execution turn journaling (pi_sessions, pi_messages)
 *   - Provider-agnostic LLM model invocations
 *   - Private chain-of-thought / thinking stream extraction into pi_messages.thinking
 *   - Structured sub-agent concurrency in pi_tasks
 *   - Jev System 1 integration for decision gating and frustration detection
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { BalaBotDatabase, PiMessage, PiSession } from "./db.js";
import { JevClient } from "./jev.js";
import { LocalToolBridge } from "./bridge.js";
import { HarnessComponentAssembler } from "./components.js";
import { createModels, defaultProviderAuthContext } from "@earendil-works/pi-ai";
import { openrouterProvider } from "@earendil-works/pi-ai/providers/openrouter";
import { openaiProvider } from "@earendil-works/pi-ai/providers/openai";
import { anthropicProvider } from "@earendil-works/pi-ai/providers/anthropic";
import { googleProvider } from "@earendil-works/pi-ai/providers/google";
import { deepseekProvider } from "@earendil-works/pi-ai/providers/deepseek";
import { groqProvider } from "@earendil-works/pi-ai/providers/groq";

export interface StreamEvent {
  event: "text" | "thinking" | "tool_call" | "tool_result" | "intervention" | "openui" | "jev" | "done" | "error";
  data: any;
}

export interface ChatTurnOptions {
  sessionId: string;
  botId: string;
  userMessage: string;
  streamCallback?: (event: StreamEvent) => void;
  systemPrompt?: string;
  model?: string;
}

export class PiDurableHarness {
  public readonly db: BalaBotDatabase;
  public readonly jev: JevClient;
  public readonly bridge: LocalToolBridge;
  private models: any;

  constructor(options?: { db?: BalaBotDatabase; jev?: JevClient; bridge?: LocalToolBridge }) {
    this.db = options?.db || new BalaBotDatabase();
    this.jev = options?.jev || new JevClient();
    this.bridge = options?.bridge || new LocalToolBridge();
    this.initModels();
  }

  private initModels(): void {
    try {
      this.models = createModels({ authContext: defaultProviderAuthContext() });
      this.models.setProvider(openrouterProvider());
      this.models.setProvider(openaiProvider());
      this.models.setProvider(anthropicProvider());
      this.models.setProvider(googleProvider());
      this.models.setProvider(deepseekProvider());
      this.models.setProvider(groqProvider());
    } catch (err: any) {
      console.warn("Could not initialize pi-ai models catalog:", err.message);
    }
  }

  private getActiveModel(requestedModel?: string): any {
    if (!this.models) return null;

    const modelId = requestedModel || process.env.OPENROUTER_MODEL || process.env.BALABOT_MODEL || process.env.MODEL;

    // 1. OpenRouter (standard default for BalaBot)
    if (process.env.OPENROUTER_API_KEY) {
      const p = this.models.getProvider("openrouter");
      if (p) {
        const models = p.getModels ? p.getModels() : [];
        if (modelId) {
          const found = models.find((m: any) => m.id === modelId || m.id.endsWith(modelId) || m.id.includes(modelId));
          if (found) return found;
          // Dynamically support any OpenRouter model id passed by user
          return {
            type: "chat",
            id: modelId,
            name: modelId,
            api: "openai-completions",
            baseUrl: "https://openrouter.ai/api/v1",
            provider: "openrouter",
            reasoning: true,
            input: ["text", "image"],
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            contextWindow: 128000,
            maxTokens: 8192,
          };
        }
        return models.find((m: any) => m.id === (process.env.OPENROUTER_MODEL || "anthropic/claude-3.7-sonnet")) ||
               models.find((m: any) => m.id === "openai/gpt-4o") ||
               models[0];
      }
    }

    // 2. Anthropic
    if (process.env.ANTHROPIC_API_KEY) {
      const p = this.models.getProvider("anthropic");
      if (p) {
        const models = p.getModels ? p.getModels() : [];
        if (modelId) {
          const found = models.find((m: any) => m.id === modelId || m.id.includes(modelId));
          if (found) return found;
        }
        return models.find((m: any) => m.id.includes("claude-3-5-sonnet")) ||
               models.find((m: any) => m.id.includes("claude-3-5-haiku")) ||
               models[0];
      }
    }

    // 3. OpenAI
    if (process.env.OPENAI_API_KEY) {
      const p = this.models.getProvider("openai");
      if (p) {
        const models = p.getModels ? p.getModels() : [];
        if (modelId) {
          const found = models.find((m: any) => m.id === modelId);
          if (found) return found;
        }
        return models.find((m: any) => m.id === "gpt-4o") ||
               models.find((m: any) => m.id === "gpt-4o-mini") ||
               models[0];
      }
    }

    // 4. Google
    if (process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY) {
      const p = this.models.getProvider("google");
      if (p) {
        const models = p.getModels ? p.getModels() : [];
        return models.find((m: any) => m.id.includes("gemini-1.5-pro")) || models[0];
      }
    }

    return null;
  }

  public loadBotSoul(botId: string): { soul: string; agents: string; combined: string } {
    const soulPath = path.resolve(process.cwd(), "personas", botId, "SOUL.md");
    const agentsPath = path.resolve(process.cwd(), "personas", botId, "AGENTS.md");
    let soul = "";
    let agents = "";
    if (fs.existsSync(soulPath)) {
      soul = fs.readFileSync(soulPath, "utf-8");
    }
    if (fs.existsSync(agentsPath)) {
      agents = fs.readFileSync(agentsPath, "utf-8");
    }
    const combined = [soul, agents].filter(Boolean).join("\n\n---\n\n");
    return { soul, agents, combined };
  }

  /**
   * Executes a durable turn with atomic pre-execution journaling and crash recovery.
   */
  public async executeTurn(opts: ChatTurnOptions): Promise<{ assistantMessage: PiMessage; thinking: string; text: string }> {
    const { sessionId, botId, userMessage, streamCallback } = opts;

    // 1. Ensure session exists
    let session = this.db.getSession(sessionId);
    if (!session) {
      session = this.db.createSession(sessionId, botId);
    }

    // 2. Pre-execution Journaling: commit incoming user message to SQLite BEFORE model call
    const userMsg = this.db.appendMessage({
      sessionId,
      role: "user",
      content: userMessage,
    });

    // 3. Sensor Layer: Jev Frustration Scan
    const frustration = await this.jev.evaluateFrustration(userMessage);
    if (frustration.answer && frustration.probability >= 0.6) {
      this.db.recordGrowthAudit({
        actor: botId,
        targetBot: botId,
        action: "frustration_escalation",
        diff: { message_seq: userMsg.seq, probability: frustration.probability },
      });
      if (streamCallback) {
        streamCallback({
          event: "jev",
          data: { type: "frustration_signal", probability: frustration.probability, mode: frustration.mode },
        });
      }
    }

    // 4. Pre-execution Journaling for Assistant turn
    const bot = this.db.getBot(botId);
    const botName = bot ? bot.name : botId;
    let botConfig: any = {};
    if (bot?.config_json) {
      try { botConfig = JSON.parse(bot.config_json); } catch {}
    }

    // Assemble modular harness components (SOUL, System Prompt, Guardrails, Memory, Tool Guidance, Skills, Constitution)
    const assembler = new HarnessComponentAssembler(this.db);
    const assembledHarness = assembler.assemble({ botId, botName, sessionId, db: this.db });
    const systemPrompt = opts.systemPrompt || assembledHarness.combined;

    let fullThinking = "";
    let fullText = "";

    // Generate response via pi-ai frontier model or intelligent local soul engine with full tool loop
    const turnResult = await this.generateResponse({
      sessionId,
      userMessage,
      botId,
      botName,
      systemPrompt,
      requestedModel: opts.model || botConfig.model,
      streamCallback,
    });
    fullThinking = turnResult.thinking;
    fullText = turnResult.text;

    // 5. Decision Gate: evaluate if response establishes a binding decision
    const decisionGate = await this.jev.isDecisionWorthy(fullText);
    if (decisionGate.answer && decisionGate.probability >= 0.6) {
      this.db.recordDecision(sessionId, fullText, `bot:${botId}`);
      if (streamCallback) {
        streamCallback({
          event: "jev",
          data: { type: "binding_decision_recorded", probability: decisionGate.probability },
        });
      }
    }

    // 6. Commit final assistant message with chain-of-thought and tool loop trace to SQLite
    const assistantMsg = this.db.appendMessage({
      sessionId,
      role: "assistant",
      content: fullText,
      thinking: fullThinking || null,
      toolCalls: turnResult.toolCalls && turnResult.toolCalls.length > 0 ? JSON.stringify(turnResult.toolCalls) : null,
    });

    if (streamCallback) {
      streamCallback({ event: "done", data: { id: assistantMsg.id, seq: assistantMsg.seq, content: assistantMsg.content } });
    }

    return {
      assistantMessage: assistantMsg,
      thinking: fullThinking,
      text: fullText,
    };
  }

  /**
   * Generates assistant response via iterative tool loop and streaming completions.
   */
  private async generateResponse(opts: {
    sessionId: string;
    userMessage: string;
    botId: string;
    botName: string;
    systemPrompt: string;
    requestedModel?: string;
    streamCallback?: (event: StreamEvent) => void;
  }): Promise<{ text: string; thinking: string; toolCalls?: any[] }> {
    const { sessionId, userMessage, botId, botName, systemPrompt, requestedModel, streamCallback } = opts;
    const lower = userMessage.toLowerCase().trim();

    const HARNESS_TOOLS = [
      {
        type: "function",
        function: {
          name: "read_file",
          description: "Read contents of a file within the workspace jail",
          parameters: {
            type: "object",
            properties: {
              path: { type: "string", description: "Relative file path" },
            },
            required: ["path"],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "write_file",
          description: "Write content to a file in the workspace jail",
          parameters: {
            type: "object",
            properties: {
              path: { type: "string", description: "Relative file path" },
              content: { type: "string", description: "File content to write" },
            },
            required: ["path", "content"],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "exec_command",
          description: "Execute a command with arguments inside the jailed workspace (NEVER THE HOST desktop law strictly enforced)",
          parameters: {
            type: "object",
            properties: {
              executable: { type: "string", description: "Executable name" },
              args: { type: "array", items: { type: "string" }, description: "Arguments" },
            },
            required: ["executable"],
          },
        },
      },
    ];

    const recordedToolCalls: any[] = [];
    const targetModel = requestedModel || process.env.OPENROUTER_MODEL || "anthropic/claude-3.7-sonnet";
    let lastModelError: { provider: string; message: string } | null = null;

    // 1. Tool Loop with OpenRouter frontier model streaming if OPENROUTER_API_KEY is configured
    if (process.env.OPENROUTER_API_KEY) {
      try {
        let history = this.db.getSessionMessages(sessionId).map(m => ({
          role: m.role as "user" | "assistant" | "system" | "tool",
          content: m.content || "",
        }));

        let loopCount = 0;
        const maxLoops = 5;
        let accumulatedText = "";
        let accumulatedThinking = "";

        while (loopCount < maxLoops) {
          loopCount++;
          const reqMessages = [
            ...(systemPrompt ? [{ role: "system", content: systemPrompt }] : []),
            ...history,
          ];

          const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              model: targetModel,
              stream: true,
              messages: reqMessages,
              tools: HARNESS_TOOLS,
            }),
          });

          if (!res.ok) {
            let errText = "";
            try {
              const errJson = await res.json();
              errText = errJson?.error?.message || JSON.stringify(errJson);
            } catch {
              errText = await res.text().catch(() => res.statusText);
            }
            throw new Error(errText || `HTTP ${res.status}`);
          }

          if (!res.body) {
            throw new Error("Empty response body from OpenRouter");
          }

          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";
          let currentTurnText = "";
          let currentTurnThinking = "";
          const pendingToolCalls: Array<{ id: string; name: string; arguments: string }> = [];

          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() || "";
            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed.startsWith("data:") || trimmed.includes("[DONE]")) continue;
              const jsonStr = trimmed.slice(5).trim();
              if (!jsonStr) continue;
              try {
                const parsed = JSON.parse(jsonStr);
                const delta = parsed.choices?.[0]?.delta;
                if (!delta) continue;
                if (delta.reasoning_content || delta.reasoning) {
                  const r = delta.reasoning_content || (typeof delta.reasoning === "string" ? delta.reasoning : "");
                  if (r) {
                    currentTurnThinking += r;
                    accumulatedThinking += r;
                    if (streamCallback) streamCallback({ event: "thinking", data: r });
                  }
                }
                if (delta.content) {
                  currentTurnText += delta.content;
                  accumulatedText += delta.content;
                  if (streamCallback) streamCallback({ event: "text", data: delta.content });
                }
                if (delta.tool_calls) {
                  for (const tc of delta.tool_calls) {
                    const idx = tc.index ?? 0;
                    if (!pendingToolCalls[idx]) {
                      pendingToolCalls[idx] = { id: tc.id || `call_${Date.now()}_${idx}`, name: tc.function?.name || "", arguments: "" };
                    }
                    if (tc.function?.name) pendingToolCalls[idx].name = tc.function.name;
                    if (tc.function?.arguments) pendingToolCalls[idx].arguments += tc.function.arguments;
                  }
                }
              } catch {}
            }
          }

          const validToolCalls = pendingToolCalls.filter(tc => Boolean(tc && tc.name));
          if (validToolCalls.length === 0) {
            // No tool calls requested, normal response completion
            break;
          }

          // Push model turn with tool calls into history
          history.push({
            role: "assistant",
            content: currentTurnText,
            // @ts-ignore
            tool_calls: validToolCalls.map(tc => ({
              id: tc.id,
              type: "function",
              function: { name: tc.name, arguments: tc.arguments },
            })),
          });

          // Execute each tool in the tool loop
          for (const tc of validToolCalls) {
            let parsedArgs: any = {};
            try { parsedArgs = JSON.parse(tc.arguments || "{}"); } catch {}

            if (streamCallback) {
              streamCallback({
                event: "tool_call",
                data: { id: tc.id, name: tc.name, args: parsedArgs },
              });
            }

            let resultStr = "";
            try {
              if (tc.name === "read_file") {
                const out = await this.bridge.executeAction({ action: "read_file", path: parsedArgs.path });
                resultStr = out.stdout || "File read successfully";
              } else if (tc.name === "write_file") {
                await this.bridge.executeAction({ action: "write_file", path: parsedArgs.path, content: parsedArgs.content });
                resultStr = `File ${parsedArgs.path} written successfully.`;
              } else if (tc.name === "exec_command") {
                const out = await this.bridge.executeAction({
                  action: "run_command",
                  executable: parsedArgs.executable,
                  args: parsedArgs.args || [],
                });
                resultStr = out.stdout || out.stderr || `Command executed with exit code ${out.exit_code}`;
              } else {
                resultStr = `Tool ${tc.name} executed.`;
              }
            } catch (err: any) {
              resultStr = `Tool error: ${err.message}`;
            }

            if (streamCallback) {
              streamCallback({
                event: "tool_result",
                data: { id: tc.id, name: tc.name, result: resultStr },
              });
            }

            recordedToolCalls.push({ id: tc.id, name: tc.name, args: parsedArgs, result: resultStr });

            // Push tool output into conversation history for the next loop turn
            history.push({
              role: "tool",
              content: resultStr,
              // @ts-ignore
              tool_call_id: tc.id,
            });
          }
        }

        if (accumulatedText.trim()) {
          return { text: accumulatedText, thinking: accumulatedThinking, toolCalls: recordedToolCalls };
        }
      } catch (err: any) {
        lastModelError = { provider: "openrouter", message: err.message };
        console.warn(`OpenRouter tool loop error (${targetModel}): ${err.message}. Trying pi-ai fallback.`);
      }
    }

    // 2. Try real live model invocation via @earendil-works/pi-ai if a provider is configured
    const activeModel = this.getActiveModel(requestedModel);
    if (activeModel) {
      try {
        const history = this.db.getSessionMessages(sessionId).map(m => ({
          role: m.role as "user" | "assistant" | "system",
          content: m.content,
        }));

        let streamThinking = "";
        let streamText = "";

        const stream = this.models.streamSimple(activeModel, {
          systemPrompt,
          messages: history,
        });

        for await (const evt of stream) {
          if (evt.type === "thinking_delta") {
            streamThinking += evt.delta;
            if (streamCallback) streamCallback({ event: "thinking", data: evt.delta });
          } else if (evt.type === "text_delta") {
            streamText += evt.delta;
            if (streamCallback) streamCallback({ event: "text", data: evt.delta });
          } else if (evt.type === "error") {
            if (!streamText) {
              throw new Error(evt.error?.errorMessage || "Model stream error");
            }
          }
        }

        if (streamText) {
          return { text: streamText, thinking: streamThinking };
        }
      } catch (err: any) {
        lastModelError = { provider: activeModel.provider || "openrouter", message: err.message };
        console.warn(`pi-ai model stream failed (${activeModel.id}): ${err.stack || err.message}.`);
      }
    }

    // Model failure honesty (BB-002): If an API key was configured but the model call failed, return explicit model error!
    if (lastModelError) {
      const errorMsg = `[Model Error: ${lastModelError.provider} - ${lastModelError.message}]`;
      const thinking = `Model provider ${lastModelError.provider} failed: ${lastModelError.message}`;
      if (streamCallback) {
        streamCallback({ event: "thinking", data: thinking });
        const chunks = errorMsg.match(/.{1,25}/g) || [errorMsg];
        for (const chunk of chunks) {
          streamCallback({ event: "text", data: chunk });
        }
      }
      return { text: errorMsg, thinking, toolCalls: recordedToolCalls };
    }

    // 3. Intelligent local engine adhering to agent souls, rules, and live SQLite state
    let thinking = "";
    let text = "";
    const hasConfiguredKey = Boolean(process.env.OPENROUTER_API_KEY || process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY || process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY);

    // A. Bot hiring / proposal -> Emit OpenUI Lang interactive card
    if (lower.includes("hire") || lower.includes("create bot") || lower.includes("propose bot")) {
      thinking = `User is requesting agent creation. In accordance with the consent ladder and OpenUI Generative UI rules, I must emit a HireAgentCard rather than monologuing or creating persistent resources silently.`;
      text = `I have generated a proposal card to hire this new agent. Please review the role specification and confirm below:\n\n` +
        `\`\`\`openui-lang\n` +
        `root = HireAgentCard("Research & Systems Specialist", "researcher-bot", "Autonomous technical deep research and verification specialist.", "Research, Coding, System Architecture")\n` +
        `\`\`\``;
    }
    // B. Human Intervention required -> Emit intervention event
    else if (lower.includes("captcha") || lower.includes("2fa") || lower.includes("intervention")) {
      thinking = `Agent has encountered a human-in-the-loop challenge requiring take-over. Suspending current turn and dispatching intervention token.`;
      const resumeToken = `token_${Math.random().toString(36).substring(2, 10)}`;
      text = `I encountered an authentication gate that requires human take-over. Please resolve it in the pane above and click resume.`;
      if (streamCallback) {
        streamCallback({
          event: "intervention",
          data: {
            bot: botName,
            reason: "Cloudflare Turnstile verification challenge",
            resume_token: resumeToken,
            status: "pending",
          },
        });
      }
    }
    // C. Governor persona response: meticulous, quiet, exact, OKF decision records
    else if (botId === "governor") {
      thinking = `Evaluating query through Governor persona (SOUL.md): single source of truth, OKF decision ledger keeper, citing decisions with strict provenance.`;
      const decisions = this.db.getDecisions(sessionId);
      if (lower.includes("decision") || lower.includes("ledger") || lower.includes("records")) {
        if (decisions.length > 0) {
          text = `Recorded decisions for session ${sessionId}:\n` +
            decisions.map(d => `- [${d.recorded_at}] "${d.decision_text}" (provenance: ${d.provenance})`).join("\n") +
            `\n\nAll decisions are maintained in Open Knowledge Format (OKF v0.2).`;
        } else {
          text = `No formal decisions have been recorded for this session yet. The OKF ledger is listening and ready to record binding agreements.`;
        }
      } else if (lower === "hey" || lower === "hi" || lower === "hello" || lower.includes("you around")) {
        text = `Hey. Decision ledger is up to date in OKF. Let me know if you need to review recorded decisions or audit contradiction flags.`;
      } else {
        const offlineNotice = !hasConfiguredKey
          ? `\n\n[Notice: Running in offline local mode. To connect live frontier models (Claude 3.7, GPT-4o, etc.), set OPENROUTER_API_KEY, ANTHROPIC_API_KEY, or OPENAI_API_KEY in your .env file.]`
          : "";
        text = `Governor here. I track the single source of truth for BalaBot in OKF v0.2. Every persistent decision is recorded with its actor, session, and timestamp.${offlineNotice}`;
      }
    }
    // D. Principal persona response: calm, technical, precise, system operator, texting register
    else if (botId === "principal") {
      thinking = `Evaluating query through Principal persona (SOUL.md): system operator, calm and precise, colleague texting register, enforcing hierarchy (User > Principal > Governor > Persistent Agents > Sub-agents).`;
      if (lower === "hey" || lower === "hi" || lower === "hello" || lower.includes("you around") || lower === "yo") {
        text = `Hey. Everything is up and running clean on the local Pi Durable engine. What's on your mind?`;
      } else if (lower.includes("who are you") || lower.includes("role") || lower.includes("hierarchy") || lower.includes("what do you do")) {
        text = `I'm the Principal, system operator for BalaBot. I keep the fleet running, watch recovery, and manage agent growth under your direction (User > Principal > Governor > Persistent Agents > Sub-agents). Governor keeps the shared decision ledger. What do you need?`;
      } else if (lower.includes("status") || lower.includes("health") || lower.includes("fleet") || lower.includes("agent")) {
        const fleet = this.db.getFleet();
        const sessions = this.db.listSessions();
        text = `System status: Operational.\n` +
          `- Engine: @earendil-works/pi-durable on 127.0.0.1:9119 (zero Docker)\n` +
          `- Fleet: ${fleet.length} bots rostered (${fleet.map(b => b.name).join(", ")})\n` +
          `- Durability: ${sessions.length} SQLite sessions persisted in ${this.db.dbPath}\n` +
          `- Jev System 1: ${this.jev.mode} mode\n` +
          `- Tool Bridge: Local workspace jailing active`;
      } else if (lower.includes("database") || lower.includes("sqlite") || lower.includes("store")) {
        text = `Unified relational store is active at ${this.db.dbPath}. Schema manages pi_sessions, pi_messages, pi_tasks, pi_inbox, topic_spans, session_decisions, and fleet_roster with pre-execution journaling for zero-loss recovery.`;
      } else {
        const principalNotice = !hasConfiguredKey
          ? `\n\n*(To chat with full unconstrained generative intelligence using Claude 3.7 Sonnet, GPT-4o, or DeepSeek, simply add your OPENROUTER_API_KEY, ANTHROPIC_API_KEY, or OPENAI_API_KEY to your .env file)*.`
          : "";
        text = `I copy: "${userMessage}".\n\n` +
          `I am operating as Principal (BalaBot System Operator) on the local Pi Durable engine. I can manage the agent fleet, inspect database state, file hiring proposals, or run workspace diagnostics.${principalNotice}`;
      }
    }
    // E. General fallback for custom bots
    else {
      thinking = `Analyzing query: "${userMessage}". Formulating structured response under Pi Durable architecture. Ensuring verified state and complete ground truth.`;
      const generalNotice = !hasConfiguredKey
        ? `\n\n*(To enable frontier model completions, set OPENROUTER_API_KEY, ANTHROPIC_API_KEY, or OPENAI_API_KEY in .env)*`
        : "";
      text = `Hello from ${botName}. I am running natively on the Pi Durable engine with zero Docker dependencies and transactional SQLite durability. How can I assist you today?${generalNotice}`;
    }

    // Stream out tokens
    if (streamCallback) {
      // 1. Stream thinking
      const thinkingChunks = thinking.match(/.{1,20}/g) || [thinking];
      for (const chunk of thinkingChunks) {
        streamCallback({ event: "thinking", data: chunk });
      }

      // 2. Stream content text
      const textChunks = text.match(/.{1,25}/g) || [text];
      for (const chunk of textChunks) {
        streamCallback({ event: "text", data: chunk });
      }
    }

    return { text, thinking, toolCalls: recordedToolCalls };
  }
}
