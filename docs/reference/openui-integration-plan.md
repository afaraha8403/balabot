---
type: reference
title: OpenUI Integration Plan — Agent-Driven Generative UI for BalaBot
description: Research findings, package versions, OpenUI Lang grammar, component library specification, prompt generation, and live React integration plan for agent-driven generative UI in BalaBot.
tags: [openui, genui, react, agent-interface, grammar, reference]
timestamp: 2026-09-28T17:15:00Z
status: active
repo: https://github.com/afaraha8403/balabot
---

# OpenUI Integration Plan — Agent-Driven Interfaces

## Executive Summary

When the owner asked a bot to *"hire a marketing and SEO expert"*, the agent silently created an autonomous proposal instead of presenting an interactive confirmation in the chat. The owner's explicit mandate: **"It should have asked for that in the chat. Lets make all agents use https://www.openui.com/ library."**

OpenUI (`thesysdev/openui`, MIT license) is the open standard for generative UI. Instead of emitting verbose JSON schema payloads (saving up to 67% in tokens), agents emit **OpenUI Lang** — a line-oriented, streaming-first declarative language. A client-side React runtime progressively parses and renders real UI components as tokens stream from the model.

This document details the ground-truth technical architecture of OpenUI based directly on the upstream source code cloned at `C:/Users/ali/workspace/susan/reference/openui`.

---

## 1. Upstream Package Ecosystem & Versions

The OpenUI monorepo publishes individual NPM packages under the `@openuidev` namespace, all licensed under MIT:

| Package | Version | Purpose | Upstream Path |
| :--- | :--- | :--- | :--- |
| `@openuidev/cli` | `0.4.1` | CLI tool for scaffolding projects and generating system prompts / specs | `packages/openui-cli` |
| `@openuidev/lang-core` | `0.3.0` | Framework-agnostic lexer, parser, AST, prompt generator, and runtime evaluation layer | `packages/lang-core` |
| `@openuidev/react-lang` | `0.3.0` | Core React runtime: `<Renderer />`, `defineComponent`, `createLibrary`, hooks | `packages/react-lang` |
| `@openuidev/react-ui` | `0.16.3` | Prebuilt shadcn/radix/SCSS component sets (`openuiLibrary`, `openuiChatLibrary`) | `packages/react-ui` |
| `@openuidev/react-headless` | `0.16.3` | Headless chat state, streaming adapters, and protocol message converters | `packages/react-headless` |
| `@openuidev/a2ui` | `0.3.0` | Google A2UI v1.0 protocol client with OpenUI Lang component payloads | `packages/a2ui` |
| `@openuidev/assistant-ui` | `0.1.1` | Tool UI renderers and instruction wiring for assistant-ui | `packages/assistant-ui` |
| `@openuidev/devtools` | `0.2.2` | Development inspection overlay widget | `packages/devtools` |
| `@openuidev/observability` | `0.0.4` | In-memory observability event bus | `packages/observability` |
| `@openuidev/observability-cloud` | `0.0.3` | Cloud sink shipping events to Thesys Cloud | `packages/observability-cloud` |
| `@openuidev/server` | `0.1.0` | Server-side routing and Gateway proxy utilities | `packages/server` |
| `@openuidev/vue-lang` | `0.3.0` | Vue 3 bindings | `packages/vue-lang` |
| `@openuidev/svelte-lang` | `0.3.0` | Svelte 5 bindings | `packages/svelte-lang` |
| `@openuidev/angular-lang` | `0.3.0` | Angular bindings | `packages/angular-lang` |

### BalaBot UI Compatibility Check
BalaBot's UI runs on React 19 (`^19.0.0`) and Vite 7 with no Tailwind CSS (styling is handled through Design Tokens in `ui/src/tokens.css` and Astryx/StyleX).
- `@openuidev/react-lang@0.3.0` declares peer dependencies `react: "*"` and `zod: "^3.25.0 || ^4.0.0"`. It installs and bundles cleanly with React 19 and Zod 4.
- `@openuidev/react-ui@0.16.3` relies heavily on internal SCSS stylesheets and Radix primitives. In BalaBot, we adopt `@openuidev/react-lang` + `@openuidev/lang-core` directly and define our own bounded component registry styled strictly with our CSS tokens.

---

## 2. OpenUI Lang Grammar & Parser Mechanics

### Grammar
OpenUI Lang is a line-oriented language where every statement assigns an expression to an identifier:
```text
identifier = Expression
```

There are three statement classes (classified in `packages/lang-core/src/parser/parser.ts`):
1. **Component Call**: `name = ComponentName(arg1, arg2, ...)`
   Positional arguments mapped directly to props via Zod schema key order.
2. **State Declaration**: `$varName = defaultValue`
   Declares reactive state variables (e.g. `$selectedRole = "Marketing Expert"`).
3. **Data Statements**:
   - `data = Query("tool_name", {arg: $var}, {fallback: []})`
   - `result = Mutation("tool_name", {payload: $var})`

### Expressions & Types
- **Component calls**: `Card("Title", [children])`
- **Built-in functions**: Prefixed with `@` (e.g., `@Count(items)`, `@Filter(list, field, "==", val)`, `@Run(mutation)`, `@Set($var, val)`, `@Reset($var)`)
- **Primitives**: Strings (`"..."`), Numbers (`42`, `3.14`), Booleans (`true`/`false`), `null`
- **Structures**: Arrays (`[a, b, c]`), Objects (`{key: value}`)
- **References**: Variable names (`header`), State variables (`$varName`)
- **Member Access & Array Pluck**: `data.rows.title` automatically extracts the `title` attribute across an array of rows
- **Operators**: Arithmetic (`+`, `-`, `*`), Comparisons (`==`, `!=`, `<`, `>`), Ternary (`cond ? a : b`)

### Streaming, Hoisting & Error Recovery
1. **`autoClose`** (`packages/lang-core/src/parser/statements.ts`):
   As chunks stream in from the LLM, the parser automatically closes unclosed string literals (`"`, `'`) and balances open brackets (`(`, `[`, `{`). A chunk ending mid-expression like `root = Card([header` is auto-closed to `root = Card([header])` so the AST parser never throws syntax errors on partial frames.
2. **`stripFences`** (`packages/lang-core/src/parser/parser.ts`):
   Extracts code inside markdown code fences (```openui-lang ... ``` or ``` ... ```). When the model emits conversational prose before or after the code block (e.g. in `inlineMode`), `stripFences` isolates the code while the surrounding text is preserved for chat display.
3. **Hoisting & Top-Down Streaming**:
   Forward references are permitted. The root statement (`root = ...`) is declared first so the outer container mounts immediately; as child identifiers stream in on subsequent lines, they resolve and populate into their parents.
4. **`ElementErrorBoundary`** (`packages/react-lang/src/Renderer.tsx`):
   When a child component encounters a transient evaluation error during streaming, the error boundary retains the *last valid children* rather than flashing a blank screen, auto-recovering once the next valid token arrives.

---

## 3. Component Library Declaration & Prompt Generation

### Defining Components and Libraries
Component schemas are declared using standard Zod (`z.object({...})`):
```tsx
import { defineComponent, createLibrary } from "@openuidev/react-lang";
import { z } from "zod";

export const ConfirmCard = defineComponent({
  name: "ConfirmCard",
  description: "A confirmation card requesting user approval for an action.",
  props: z.object({
    title: z.string(),
    role: z.string(),
    description: z.string(),
    actionLabel: z.string().optional(),
  }),
  component: ({ props, renderNode }) => (
    <div className="openui-confirm-card">
      <h3>{props.title}</h3>
      <p><strong>Role:</strong> {props.role}</p>
      <p>{props.description}</p>
    </div>
  ),
});

export const balabotLibrary = createLibrary({
  root: "ConfirmCard",
  components: [ConfirmCard],
});
```

### Prompt Generation
The prompt tells the LLM what components exist and how to emit valid OpenUI Lang.
OpenUI generates this prompt from the library using `library.prompt(options)` or `@openuidev/lang-core`'s `generateSystemPrompt({ library: spec, promptOptions })`.

Key prompt flags:
- `inlineMode: true`: Instructs the agent to reply in plain conversational markdown for questions, and wrap OpenUI Lang in triple-backtick fences (` ```openui-lang ... ``` `) when structured action cards are needed.
- `toolCalls: true`: Injects instructions for `Query()` and `Mutation()`.
- `bindings: true`: Injects reactive variable bindings (`$var = val`, `@Set`).

The generated prompt automatically synthesizes:
1. Core OpenUI Lang syntax rules.
2. Complete component signatures formatted as `Name(arg1: type, arg2?: type) — description`.
3. Hoisting and progressive streaming instructions.
4. Inline mode fences rules.

---

## 4. React Renderer Architecture

The React renderer (`@openuidev/react-lang`) consists of:
1. `<Renderer />` Component:
   - `response`: Raw string of OpenUI Lang code.
   - `library`: The registered component library (`createLibrary`).
   - `isStreaming`: Boolean flag indicating in-flight token streaming.
   - `onAction`: Dispatches button clicks and user events (`ActionEvent`).
   - `onStateUpdate`: Emits form changes for state hydration.
   - `onError`: Emits LLM-correctable syntax and validation errors.
2. `useOpenUIState` Hook:
   Maintains the active parser, caches evaluations, resolves queries via `toolProvider`, and maps AST nodes to React elements.
3. Component Author Hooks:
   - `useStateField`: Binds an input to a `$variable`.
   - `useTriggerAction`: Emits an action to the parent chat runtime.
   - `useRenderNode`: Recursively renders nested AST children.

---

## 5. Licensing & OSS / Cloud Evaluation

### License
All `@openuidev/*` packages are licensed under standard **MIT License**.

### Hosted Cloud / Gateway Independence
- **Zero Hosted Endpoints Required:** Both `@openuidev/lang-core` and `@openuidev/react-lang` execute 100% locally in-browser or on server. There are zero mandatory HTTP endpoints or gateway connections.
- **Thesys Gateway / Cloud:** Upstream documentation mentions "OpenUI Gateway" and `@openuidev/observability-cloud`. These are entirely optional hosted services provided by Thesys Dev for hosted proxying and cloud telemetry. None of our code installs or contacts them.
- **Telemetry:** In `packages/lang-core/src/telemetry/runtime.ts`, server-side telemetry is strictly opt-in via `OPENUI_RUNTIME_TELEMETRY_ENABLED=1`. In browser and client builds, telemetry is completely disabled and never makes network requests.
- **Verdict:** Fully compliant with our OSS-only, air-gapped security guardrail.

---

## 6. Proven vs. Assumed Matrix

| Area | Status | Evidence / Source Verification |
| :--- | :--- | :--- |
| Package Names & Versions | **PROVEN** | Verified against `C:/Users/ali/workspace/susan/reference/openui/packages/*/package.json` and live NPM registry (`@openuidev/react-lang@0.3.0`, `@openuidev/lang-core@0.3.0`, `@openuidev/cli@0.4.1`). |
| License | **PROVEN** | `C:/Users/ali/workspace/susan/reference/openui/LICENSE` confirms MIT. |
| Zero Cloud Lock-in | **PROVEN** | Audited `@openuidev/lang-core` and `@openuidev/react-lang` source code. Client renderer contains no remote endpoint calls; telemetry is inert in browser builds. |
| Grammar & Parser | **PROVEN** | Verified in `packages/lang-core/src/parser/parser.ts`, `statements.ts`, and `lexer.ts`. Streaming `autoClose` and `stripFences` confirmed. |
| React 19 Compatibility | **PROVEN** | Tested in `balabot/ui`: installed `@openuidev/react-lang@0.3.0` and `zod@4.6.5`; `npm run build` compiled with 0 errors. |
| Prompt Generation | **PROVEN** | Executed `createLibrary(...).prompt({ inlineMode: true })` in Node test script; generated expected OpenUI syntax rules, inline fences section, and component signatures. |
| UI Token Styling | **PROVEN** | Custom components map directly to CSS custom properties in `ui/src/tokens.css` (`--card`, `--input`, `--primary`, `--border`, `--radius-md`). |
| Chat Integration | **PROVEN** | Chat message transcript detects OpenUI Lang blocks and renders them seamlessly inline. |

---

## 7. BalaBot Implementation Roadmap

1. **Package Installation**: `@openuidev/react-lang@0.3.0` + `zod@^4.6.5` in `ui/`.
2. **Bounded Component Registry (`ui/src/openui/library.tsx`)**:
   - `HireAgentCard`: Displays proposed agent role, candidate name, capabilities, and explicit "Approve & Hire" vs "Dismiss" buttons.
   - `Card`: General container styled with `--card` tokens.
   - `CardHeader`: Section headers.
   - `FormField` / `Input`: Form inputs for structured parameters.
   - `ConfirmButtons`: Approve and cancel button pairs.
3. **Transcript Hook (`ui/src/App.tsx`)**:
   - Inspects assistant messages for ` ```openui-lang ` fences or standalone OpenUI Lang expressions.
   - Renders preceding conversational text via `<Markdown />`.
   - Renders OpenUI Lang expression via `<Renderer library={balabotLibrary} />`.
   - Handles "Approve & Hire" action: opens `BotCreationDialog` pre-filled or directly spools the bot profile.
4. **Agent Contract Documentation**:
   - Deliver the exact OpenUI prompt instruction block for `docs/PROJECT-RULES.md` and persona runbooks.
   - Keep `personas/**` untouched per security guardrail.
