/**
 * pre_check_paper — POST /api/scorer
 *
 * Tier 1, 2 and 3 acceptance probabilities from title + abstract. Local FTS5
 * BM25 against the 7.9M-paper library + tier-density aggregation. No LLM call.
 *
 * REACHABLE WITH AN API KEY ONLY ONCE THE SERVER OPENS IT. /api/scorer joins
 * the app middleware's MCP_ELIGIBLE_PATHS in the server release that follows
 * the publication of 0.1.4 (journal/src/lib/mcp-package.ts
 * MCP_TOOL_READY_SINCE; tools-truth-0927.test.ts enforces the order). Before
 * that the edge answers every Bearer call with a 401 and nothing is charged,
 * and http.ts says so instead of blaming the key. The order exists because up
 * to 0.1.3 this tool read tier1-3 as numbers while the route returns "35%"
 * strings, and 0.1.3's description called the tool free; after the server
 * opens the endpoint it refuses those older packages with a 426 (no charge).
 *
 * METERED: the route charges SERVICE_COSTS.precheck
 * (15 credits) per run to the API key's account —
 * journal/src/app/api/scorer/route.ts → chargeToolOrReject(caller, "precheck").
 * This package cannot import the app's journal/src/lib/credits-constants.ts,
 * so the number is typed in the description below;
 * journal/src/lib/__tests__/marketing-price-claims.test.ts fails if it drifts
 * from that constant. The library size is libraryPapersLabel in
 * journal/src/lib/seo/constants.ts. The answer is formatted by
 * ../format/pre-check.ts.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getConfig } from "../config.js";
import { formatScorerResult } from "../format/pre-check.js";
import { request } from "../http.js";

const inputShape = {
  title: z.string().min(1).max(600).describe("Paper title (required unless booleanQuery is supplied)."),
  abstract: z
    .string()
    .min(1)
    .max(20_000)
    .describe("Paper abstract (required unless booleanQuery is supplied)."),
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
  booleanQuery: z
    .string()
    .max(2000)
    .optional()
    .describe(
      'Optional Elicit-style Boolean query (Phase 0 / P0a). Example: ' +
        '`("persistent homology" OR "algebraic topology") AND topological`. ' +
        'When supplied, bypasses bag-of-words token extraction and feeds ' +
        'the lowered FTS5 string directly. Parse failures return HTTP 400 ' +
        'with the character position of the error.',
    ),
  force: z
    .boolean()
    .optional()
    .describe(
      "Set to true to score a title + abstract this account already ran recently. Without it, " +
        "a repeat returns a pointer to the saved result and is not charged.",
    ),
  acknowledgeLowEnglish: z
    .boolean()
    .optional()
    .describe(
      "The library is English-language: a text that does not look like English is refused with " +
        "HTTP 422 and not charged. Set to true to run it anyway (charged as usual; expect a rough result).",
    ),
};

export function registerPreCheck(server: McpServer): void {
  server.registerTool(
    "pre_check_paper",
    {
      title: "Pre-Check Paper",
      description:
        "Pre-submission scoring of an academic paper from its title and abstract. " +
        "Returns Tier 1, Tier 2 and Tier 3 acceptance probabilities, the detected " +
        "research field, and how much evidence the estimate rests on (how many " +
        "similar papers were retrieved, and whether the result is provisional), " +
        "scored against a local 7.9M-paper library via FTS5 BM25 with no LLM call. " +
        "Use this when the user wants a fast readiness check before submitting, or " +
        "which tier of journal to target. Costs 15 Science AI Journal credits per " +
        "call, charged to the API key's account; an account without enough credits " +
        "gets HTTP 402 and is not charged, and a repeat of a recent run returns the " +
        "saved result's link without charging. The probabilities are estimates from " +
        "similar published papers, not a decision: present them as a rough guide. " +
        "Calls are rate-limited per API key; a refused call (401, 402, 422, 429, 503) " +
        "is not charged and the error says what to do. If the server answers that this " +
        "tool is not available through MCP yet, nothing was charged: run Pre-Check in " +
        "the web app at scienceaijournal.com/scorer instead.",
      inputSchema: inputShape,
    },
    async (args) => {
      const result = await request<unknown>({
        method: "POST",
        path: "/api/scorer",
        body: {
          title: args.title,
          abstract: args.abstract,
          keywords: args.keywords,
          fullText: args.fullText,
          abstractOnly: args.abstractOnly,
          booleanQuery: args.booleanQuery,
          force: args.force,
          acknowledgeLowEnglish: args.acknowledgeLowEnglish,
        },
      });
      return {
        content: [
          {
            type: "text",
            text: formatScorerResult(result, { baseUrl: getConfig().baseUrl }),
          },
        ],
      };
    },
  );
}
