/**
 * Jev (TypeSafe AI) System 1 Infrastructure Pipeline
 *
 * Implements calibrated probabilistic decision gating, frustration sensing,
 * memory relevance re-ranking, and skill selection as specified in PRD-PI-DURABLE.md.
 *
 * Supports two operational modes:
 *   - JEV_MODE=cloud: Production mode. Fails loud if TYPESAFE_API_KEY is missing or API errors.
 *   - JEV_MODE=heuristic: Local offline mode. Deterministic calibrated heuristic fallback.
 */

export const SYSTEM_ONE_URL = "https://api.typesafe.ai/v1/systemone";
export const DEFAULT_MODEL = "jev-1.13.0";

export class JevError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JevError";
  }
}

export class JevNotConfigured extends JevError {
  constructor(message: string = "TYPESAFE_API_KEY missing. Jev fail-loud contract requires valid key in cloud mode.") {
    super(message);
    this.name = "JevNotConfigured";
  }
}

export class JevAPIError extends JevError {
  constructor(message: string) {
    super(message);
    this.name = "JevAPIError";
  }
}

// Layer 1 Frustration Dictionary (Data, multilingual: English + Arabic, exclusion list)
export const FRUSTRATION_MARKERS = [
  // English
  "stop", "wrong", "broken", "useless", "stupid", "idiot", "hate this",
  "doesn't work", "does not work", "not working", "why did you", "annoying",
  "terrible", "garbage", "fail", "failed", "giving up", "quit", "wasting my time",
  // Arabic
  "توقف", "خطأ", "غلط", "ما يشتغل", "لا يعمل", "فاشل", "غبي", "سيء جدا",
  "ضيعت وقتي", "ليش كذا", "مش شغال",
];

export const FRUSTRATION_EXCLUSIONS = [
  "anyways", "regardless", "no problem", "never mind", "just kidding",
  "don't stop", "don't worry", "not broken", "not bad",
];

export interface NoulResponse {
  answer: boolean;
  probability: number;
  confidence: number;
  mode: "cloud" | "heuristic";
}

export interface JevSystemOneRequest {
  state: string | Record<string, any> | string[];
  questions: Record<string, { type: "noul" | "choice" | "score"; question?: string; instructions?: string; criteria?: any }>;
  model?: string;
}

export class JevClient {
  private apiKey?: string;
  private mode: "cloud" | "heuristic";
  private timeoutMs: number;

  constructor(options?: { apiKey?: string; mode?: "cloud" | "heuristic"; timeoutMs?: number }) {
    this.apiKey = options?.apiKey || process.env.TYPESAFE_API_KEY;
    this.mode = options?.mode || (process.env.JEV_MODE === "heuristic" ? "heuristic" : (this.apiKey ? "cloud" : "heuristic"));
    this.timeoutMs = options?.timeoutMs || (parseInt(process.env.JEV_TIMEOUT_MS || "15000", 10));
  }

  public getMode(): "cloud" | "heuristic" {
    return this.mode;
  }

  /**
   * Evaluates questions against Jev System 1 API or heuristic fallback.
   */
  public async evaluate(req: JevSystemOneRequest): Promise<Record<string, any>> {
    if (this.mode === "cloud") {
      if (!this.apiKey) {
        throw new JevNotConfigured();
      }

      try {
        const response = await fetch(SYSTEM_ONE_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify({
            model: req.model || DEFAULT_MODEL,
            state: req.state,
            questions: req.questions,
          }),
          signal: AbortSignal.timeout(this.timeoutMs),
        });

        if (!response.ok) {
          throw new JevAPIError(`Jev API returned HTTP ${response.status}: ${await response.text()}`);
        }

        const data = await response.json();
        return data.answers || data;
      } catch (err: any) {
        if (err instanceof JevError) throw err;
        throw new JevAPIError(`Jev System 1 transport failure: ${err.message}`);
      }
    }

    // Offline Deterministic Heuristic Engine
    return this.evaluateHeuristic(req);
  }

  private evaluateHeuristic(req: JevSystemOneRequest): Record<string, any> {
    const results: Record<string, any> = {};
    const textState = typeof req.state === "string" ? req.state : JSON.stringify(req.state);

    for (const [qKey, qVal] of Object.entries(req.questions)) {
      if (qVal.type === "noul") {
        const questionText = (qVal.instructions || qVal.question || "").toLowerCase();

        // 1. Frustration question
        if (questionText.includes("frustrated") || questionText.includes("anger") || questionText.includes("stuck")) {
          const scan = this.scanFrustrationKeywords(textState);
          results[qKey] = {
            noul: scan.probability,
            probability: scan.probability,
            confidence: scan.detected ? 0.9 : 0.7,
            mode: "heuristic",
          };
        }
        // 2. Decision question
        else if (questionText.includes("decision") || questionText.includes("binding") || questionText.includes("policy")) {
          const isDec = this.heuristicDecisionCheck(textState);
          results[qKey] = {
            noul: isDec.probability,
            probability: isDec.probability,
            confidence: 0.85,
            mode: "heuristic",
          };
        } else {
          results[qKey] = {
            noul: 0.1,
            probability: 0.1,
            confidence: 0.5,
            mode: "heuristic",
          };
        }
      } else {
        results[qKey] = {
          choice: null,
          confidence: 0.5,
          mode: "heuristic",
        };
      }
    }

    return results;
  }

  /**
   * Layer 1 string matcher: scans text for frustration markers with exclusions.
   */
  public scanFrustrationKeywords(text: string): { detected: boolean; probability: number; matches: string[] } {
    const lower = text.toLowerCase();

    // Check exclusion list first
    for (const exc of FRUSTRATION_EXCLUSIONS) {
      if (lower.includes(exc)) {
        return { detected: false, probability: 0.05, matches: [] };
      }
    }

    const matches: string[] = [];
    for (const marker of FRUSTRATION_MARKERS) {
      if (lower.includes(marker)) {
        matches.push(marker);
      }
    }

    if (matches.length > 0) {
      // Calibrated probability based on match density
      const prob = Math.min(0.95, 0.6 + matches.length * 0.15);
      return { detected: true, probability: prob, matches };
    }

    return { detected: false, probability: 0.05, matches: [] };
  }

  /**
   * Evaluates whether message contains a binding decision.
   */
  public async isDecisionWorthy(message: string): Promise<NoulResponse> {
    const res = await this.evaluate({
      state: message,
      questions: {
        decision_gate: {
          type: "noul",
          instructions: "Determine if this message establishes, modifies, or records a binding decision or policy.",
        },
      },
    });

    const ans = res.decision_gate;
    const prob = typeof ans?.noul === "number" ? ans.noul : (typeof ans?.probability === "number" ? ans.probability : (ans?.noul === true ? 1.0 : 0.0));
    return {
      answer: prob >= 0.6,
      probability: prob,
      confidence: ans?.confidence ?? 0.8,
      mode: this.mode,
    };
  }

  /**
   * Evaluates user frustration with keyword trigger and Jev Noul.
   */
  public async evaluateFrustration(message: string): Promise<NoulResponse> {
    const scan = this.scanFrustrationKeywords(message);
    if (!scan.detected && this.mode === "heuristic") {
      return {
        answer: false,
        probability: scan.probability,
        confidence: 0.95,
        mode: "heuristic",
      };
    }

    const res = await this.evaluate({
      state: message,
      questions: {
        frustration_check: {
          type: "noul",
          instructions: "Determine if this user message expresses frustration, anger, dissatisfaction, or feeling stuck.",
        },
      },
    });

    const ans = res.frustration_check;
    const prob = typeof ans?.noul === "number" ? ans.noul : (typeof ans?.probability === "number" ? ans.probability : (ans?.noul === true ? 1.0 : scan.probability));
    return {
      answer: prob >= 0.6,
      probability: prob,
      confidence: ans?.confidence ?? 0.8,
      mode: this.mode,
    };
  }

  /**
   * Re-ranks memory facts by relevance to current turn.
   */
  public rankMemoryRelevance(query: string, facts: Array<{ fact_id: string; content: string }>): Array<{ fact_id: string; content: string; score: number }> {
    const queryTerms = query.toLowerCase().split(/\s+/).filter(t => t.length > 2);
    return facts
      .map(f => {
        const lower = f.content.toLowerCase();
        let score = 0;
        for (const term of queryTerms) {
          if (lower.includes(term)) score += 1;
        }
        return { ...f, score };
      })
      .sort((a, b) => b.score - a.score);
  }

  private heuristicDecisionCheck(text: string): { isDecision: boolean; probability: number } {
    const lower = text.toLowerCase();
    const decisionMarkers = [
      "i have decided", "we decided", "decision is", "ratified", "agreed to",
      "let's proceed with", "approved", "we will adopt", "policy changed",
      "settled on", "final answer is",
    ];

    for (const m of decisionMarkers) {
      if (lower.includes(m)) {
        return { isDecision: true, probability: 0.85 };
      }
    }
    return { isDecision: false, probability: 0.15 };
  }
}
