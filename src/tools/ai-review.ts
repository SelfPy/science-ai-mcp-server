/**
 * ai_review_paper — POST /api/review/claude
 *
 * Single AI-reviewer-agent peer-review call. Text-only for MVP (vision /
 * figure-image review deferred). The MCP boundary doesn't stream — we
 * return the final normalised review JSON in one chunk.
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
    .enum(["methodology", "language", "figures", "plagiarism", "literature"])
    .optional()
    .describe(
      "Which specialist reviewer agent to run. Drives the calibration RAG corpus " +
        "and the system prompt; defaults to a generic reviewer when omitted.",
    ),
};

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
        "Run one of the specialist reviewer agents (methodology, language, figures, " +
        "plagiarism, or literature) on a prepared agent prompt and return the " +
        "structured editorial decision: score (1-10), verdict (Accept / Minor " +
        "Revision / Major Revision / Reject), summary, strengths, concerns, " +
        "detailed multi-section review, confidence band, and questions for the " +
        "authors. Uses Science AI Journal credits. For the full 5-agent + " +
        "synthesis flow, prefer the web UI at scienceaijournal.com/ai-review.",
      inputSchema: inputShape,
    },
    async (args) => {
      const result = await request<AiReviewResponse>({
        method: "POST",
        path: "/api/review/claude",
        body: { prompt: args.prompt, agentType: args.agentType },
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
