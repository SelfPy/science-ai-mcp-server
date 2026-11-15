/**
 * ai_review_paper — POST /api/review/claude
 *
 * Single AI-reviewer-agent peer-review call. Text-only for MVP (vision /
 * figure-image review deferred). The MCP boundary doesn't stream — we
 * return the final normalised review JSON in one chunk.
 *
 * METERED per call: an API-key caller pays PER_CALL_COST (4 credits) per
 * request — journal/src/app/api/review/claude/route.ts, "Per-call credit gate
 * for Bearer (API-key) callers", ceil(SERVICE_COSTS.review / 8) so a full
 * 8-agent pass lands near the web price. The number is typed below because
 * this package cannot import the app; marketing-price-claims.test.ts pins it
 * to the route's constant.
 *
 * agentType selects the calibration corpus (RAG examples), not a system
 * prompt. The enum lists the live review engine's LLM agents
 * (components/hakem/ScienceAI.tsx AGENTS); "plagiarism" and "language" are
 * kept so 0.1.3 configs still validate, and "plagiarism" is sent as
 * "originality" — the engine's name for that reviewer (training-rag.ts
 * ROLE_TO_TYPE maps PLAGIARISM → originality).
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { request } from "../http.js";

const inputShape = {
  prompt: z
    .string()
    .min(100)
    .max(100_000)
    .describe(
      "Prepared agent prompt — usually the manuscript text plus any agent-specific framing. " +
        "The server wraps it in <manuscript> tags to defuse injection, prepends RAG examples " +
        "if agentType is supplied, and runs the chosen Claude model.",
    ),
  agentType: z
    .enum([
      "methodology",
      "formulas",
      "originality",
      "literature",
      "reproducibility",
      "clarity",
      "figures",
      "language",
      "plagiarism",
    ])
    .optional()
    .describe(
      "Which specialist reviewer to run. Selects the calibration examples drawn " +
        "from real peer reviews for that reviewer; defaults to a generic reviewer " +
        'when omitted. "plagiarism" is an alias for "originality".',
    ),
};

/** Legacy 0.1.3 name → the review engine's agent name. */
const AGENT_ALIASES: Record<string, string> = { plagiarism: "originality" };

interface AiReviewResponse {
  score?: number;
  verdict?: string;
  summary?: string;
  strengths?: string[];
  concerns?: string[];
  detailed_review?: string;
  score_justification?: string;
  confidence?: string;
  questions_for_authors?: string[];
  groundingReport?: unknown;
  [k: string]: unknown;
}

export function registerAiReview(server: McpServer): void {
  server.registerTool(
    "ai_review_paper",
    {
      title: "AI Multi-Agent Peer Review (single agent)",
      description:
        "Run one specialist reviewer agent (methodology, formulas, originality, " +
        "literature, reproducibility, clarity or figures) on a prepared agent " +
        "prompt and return the structured editorial decision: score (1-10), " +
        "verdict (Accept / Minor Revision / Major Revision / Reject), summary, " +
        "strengths, concerns, detailed multi-section review, confidence band, and " +
        "questions for the authors. Costs 4 Science AI Journal credits per call " +
        "(one call = one agent), charged to the API key's account; an account " +
        "without enough credits gets HTTP 402 and is not charged. For a whole " +
        "manuscript, AI Review in the web app at scienceaijournal.com/ai-review " +
        "runs all 9 specialist agents plus a synthesis in one pass.",
      inputSchema: inputShape,
    },
    async (args) => {
      const agentType = args.agentType
        ? AGENT_ALIASES[args.agentType] ?? args.agentType
        : undefined;
      const result = await request<AiReviewResponse>({
        method: "POST",
        path: "/api/review/claude",
        body: { prompt: args.prompt, agentType },
        // 90s server-side max + 30s margin for slow upstream proxies.
        timeoutMs: 120_000,
      });

      const lines: string[] = [];
      lines.push(`AI peer review (${args.agentType ?? "generic"})`);
      lines.push(
        `  Score: ${result.score ?? "?"}/10   Verdict: ${result.verdict ?? "?"}   Confidence: ${result.confidence ?? "?"}`,
      );
      if (result.summary) {
        lines.push("");
        lines.push(`Summary:\n  ${result.summary}`);
      }
      if (result.strengths?.length) {
        lines.push("");
        lines.push("Strengths:");
        for (const s of result.strengths) lines.push(`  + ${s}`);
      }
      if (result.concerns?.length) {
        lines.push("");
        lines.push("Concerns:");
        for (const c of result.concerns) lines.push(`  - ${c}`);
      }
      if (result.detailed_review) {
        lines.push("");
        lines.push("Detailed review:");
        lines.push(result.detailed_review);
      }
      if (result.questions_for_authors?.length) {
        lines.push("");
        lines.push("Questions for authors:");
        for (const q of result.questions_for_authors) lines.push(`  ? ${q}`);
      }
      return { content: [{ type: "text", text: lines.join("\n") }] };
    },
  );
}
