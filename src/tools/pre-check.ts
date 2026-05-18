/**
 * pre_check_paper — POST /api/scorer
 *
 * Tier 1-5 acceptance probability from title + abstract. Local FTS5
 * BM25 against the 33k-paper library + tier-density aggregation. Zero
 * LLM cost, sub-second response.
 *
 * The route is anonymous on the server side, but we still attach the
 * Bearer token so the activity log can attribute the call to the
 * user's account (and so future per-account rate limits work).
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { request } from "../http.js";

const inputShape = {
  title: z.string().min(1).max(600).describe("Paper title (required)."),
  abstract: z
    .string()
    .min(1)
    .max(20_000)
    .describe("Paper abstract (required)."),
  keywords: z
    .string()
    .max(600)
    .optional()
    .describe("Optional author-supplied keywords; comma-separated."),
  fullText: z
    .string()
    .max(200_000)
    .optional()
    .describe(
      "Optional full manuscript text. Pass when available; results are more accurate.",
    ),
  abstractOnly: z
    .boolean()
    .optional()
    .describe(
      "Set to false to score against fullText. Default true. Ignored when fullText is absent.",
    ),
};

interface ScorerResponse {
  field?: string;
  tier1?: number;
  tier2?: number;
  tier3?: number;
  confidence?: number;
  [k: string]: unknown;
}

export function registerPreCheck(server: McpServer): void {
  server.registerTool(
    "pre_check_paper",
    {
      title: "Pre-Check Paper",
      description:
        "Run a free, zero-LLM-cost pre-submission scoring of an academic paper. " +
        "Returns predicted publication tier (Tier 1, 2, or 3 probability), the " +
        "detected research field, and a confidence band. Backed by a local 33,000-paper " +
        "library via FTS5 BM25. Use this when the user wants a fast sanity-check on " +
        "whether a paper is ready to submit, or which tier of journal to target. " +
        "Sub-second response. Free.",
      inputSchema: inputShape,
    },
    async (args) => {
      const result = await request<ScorerResponse>({
        method: "POST",
        path: "/api/scorer",
        body: {
          title: args.title,
          abstract: args.abstract,
          keywords: args.keywords,
          fullText: args.fullText,
          abstractOnly: args.abstractOnly,
        },
      });
      return {
        content: [
          {
            type: "text",
            text: formatScorerResult(result),
          },
        ],
      };
    },
  );
}

function formatScorerResult(r: ScorerResponse): string {
  const field = r.field ?? "(unknown)";
  const pct = (v: unknown): string =>
    typeof v === "number" ? `${Math.round(v * 100)}%` : "—";
  const tier1 = pct(r.tier1);
  const tier2 = pct(r.tier2);
  const tier3 = pct(r.tier3);
  const conf =
    typeof r.confidence === "number"
      ? `${Math.round(r.confidence * 100)}%`
      : "—";
  return (
    `Pre-Check result\n` +
    `  Detected field: ${field}\n` +
    `  Tier 1 probability: ${tier1}\n` +
    `  Tier 2 probability: ${tier2}\n` +
    `  Tier 3 probability: ${tier3}\n` +
    `  Confidence: ${conf}\n`
  );
}
