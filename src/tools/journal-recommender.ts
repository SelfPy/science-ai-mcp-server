/**
 * recommend_journals — POST /api/journal-recommender
 *
 * Returns ranked target journals from a 17,500-venue index with tier,
 * quartile, publisher, access status, 2-year citedness, predatory flag,
 * responding times and similar papers per recommendation. The answer is
 * formatted by ../format/journal-recommender.ts, which reads the route's real
 * shape (oaStatus, refunded, inputQuality, isBreadth — 0.1.3 read the legacy
 * openAccess boolean, labelled citedness "IF≈", and threw on a reply without
 * a recommendations array).
 *
 * REACHABLE WITH AN ORDINARY API KEY ONLY ONCE THE SERVER OPENS IT. The edge
 * admits /api/journal-recommender (since 2026-10-19, for partner keys), but
 * the route turns every wildcard key (every MCP user's) away with a 401 in
 * the edge's own shape, charging nothing, until the server release that
 * follows the publication of 0.1.4 (journal/src/lib/partners/scopes.ts
 * explicitScopeRequired; tools-truth-0927.test.ts enforces the order). The
 * order exists because 0.1.3's description gave this tool a zero price; once
 * the server opens the endpoint it refuses those older packages with a 426
 * (no charge).
 *
 * METERED: the route charges SERVICE_COSTS.recommender
 * (15 credits) per call to the API key's account —
 * journal/src/app/api/journal-recommender/route.ts →
 * chargeToolOrReject(caller, "recommender"), refunded when nothing matches.
 * This package cannot import the app's journal/src/lib/credits-constants.ts,
 * so the number is typed in the description below;
 * journal/src/lib/__tests__/marketing-price-claims.test.ts fails if it
 * drifts. Until 0.1.4 this said "Free" and "~1,200-venue"; the venue count is
 * FACTS.venueCount in journal/src/lib/seo/constants.ts.
 *
 * An API-key call is always its own purchase: the web app's bundles and its
 * Journal Finder lock (preview rows, one unlock per manuscript) belong to
 * signed-in browser sessions and are not applied to a key, in either position
 * of the server's JOURNAL_FINDER_LOCK lever. No accuracy figure is typed in
 * the description (the measurement is being redone); it says what the list
 * is instead: candidates to check, not a prediction.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { formatRecommendations } from "../format/journal-recommender.js";
import { request } from "../http.js";

const filtersShape = z
  .object({
    excludePredatory: z.boolean().optional(),
    openAccessOnly: z.boolean().optional(),
    minTier: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
    excludePreprints: z.boolean().optional(),
    respondingTimeOnly: z
      .boolean()
      .optional()
      .describe("Keep only venues with a known responding-time metric (any stage)."),
    maxRespondingDays: z
      .number()
      .int()
      .min(1)
      .max(1095)
      .optional()
      .describe(
        "Keep only venues whose canonical responding time (earliest reported " +
          "stage: first decision → acceptance → publication) is ≤ N days.",
      ),
  })
  .optional()
  .describe(
    "Optional filter object. excludePredatory drops Beall's-archive matches; " +
      "openAccessOnly keeps only OA journals; minTier sets a Tier 1/2/3 floor; " +
      "respondingTimeOnly/maxRespondingDays gate on journal turnaround data.",
  );

const inputShape = {
  title: z
    .string()
    .min(1)
    .max(600)
    .describe("Paper title (required unless booleanQuery is supplied)."),
  abstract: z
    .string()
    .max(20_000)
    .describe("Paper abstract (required, can be empty string)."),
  fullText: z
    .string()
    .max(200_000)
    .optional()
    .describe("Optional full manuscript text for higher-signal matching."),
  keywords: z
    .string()
    .max(600)
    .optional()
    .describe("Optional author keywords; comma-separated. High-signal topic input."),
  field: z
    .string()
    .max(200)
    .optional()
    .describe("Detected research field for a topical boost (optional)."),
  booleanQuery: z
    .string()
    .max(2000)
    .optional()
    .describe(
      'Optional Elicit-style Boolean query (Phase 0 / J0). Example: ' +
        '`("angle rigidity" OR "3D localization") AND wireless`. When ' +
        'supplied, bypasses bag-of-words token extraction and feeds the ' +
        'lowered FTS5 string directly. Parse failures return HTTP 400 ' +
        'with the character position of the error.',
    ),
  filters: filtersShape,
  sort: z
    .enum([
      // Full server VALID_SORTS vocabulary (previously this enum listed
      // sorts the server rejected and omitted ones it accepted — J-RT fix).
      "best", "byTier", "sjrHi", "sjrLo", "quartileHi", "quartileLo",
      "citednessHi", "citednessLo", "hIndex", "az", "recent", "oaFirst",
      "byIndex", "highestIf", "fastest", "mostAccepting",
    ])
    .optional()
    .describe(
      'Sort mode. "best" (default) maximises relevance; "fastest" orders by ' +
        "responding time (earliest reported stage, shortest first, unknowns " +
        'last); "mostAccepting" by publisher-stated acceptance rate; ' +
        '"highestIf"/"citednessHi" by 2-year mean citedness; plus SJR/' +
        "quartile/h-index/recency/OA/index-membership orders.",
    ),
  maxResults: z
    .number()
    .int()
    .min(1)
    .max(25)
    .optional()
    .describe("How many recommendations to return. Default 10, cap 25."),
  acknowledgeLowEnglish: z
    .boolean()
    .optional()
    .describe(
      "The journal index is English-language: a text that does not look like English is refused " +
        "with HTTP 422 and not charged. Set to true to run it anyway (charged as usual; expect rough matches).",
    ),
};

export function registerJournalRecommender(server: McpServer): void {
  server.registerTool(
    "recommend_journals",
    {
      title: "Recommend Target Journals",
      description:
        "Recommend ranked target journals for a paper from a 17,500-venue " +
        "index. Each result includes a letter grade (A-F), a match percentage, " +
        "tier (1-3), Scimago quartile, publisher, access (open, hybrid or " +
        "subscription), OpenAlex 2-year mean citedness (an open proxy, not the " +
        "Journal Impact Factor), a predatory-journal flag, responding times where " +
        "the venue reports them, and up to 2 similar papers from the venue that " +
        "our library holds. Runs on FTS5 + topic profiles, no LLM call. Costs 15 " +
        "Science AI Journal credits per call, charged to the API key's account; an " +
        "account without enough credits gets HTTP 402 and is not charged, and a " +
        "call that matches no journal is refunded. The list is a ranked shortlist " +
        "of candidates to check against each journal's aims and scope, not a " +
        "prediction of acceptance: present it that way. Calls are rate-limited per " +
        "API key; a refused call (401, 402, 403, 422, 429) is not charged and the " +
        "error says what to do. If the server answers that this " +
        "tool is not available through MCP yet, nothing was charged: use the Journal " +
        "Finder in the web app at scienceaijournal.com/journal-recommender instead. " +
        "Use when the user asks 'where should I submit this paper' or wants to " +
        "compare target venues before deciding.",
      inputSchema: inputShape,
    },
    async (args) => {
      const result = await request<unknown>({
        method: "POST",
        path: "/api/journal-recommender",
        body: {
          title: args.title,
          abstract: args.abstract,
          fullText: args.fullText,
          keywords: args.keywords,
          field: args.field,
          booleanQuery: args.booleanQuery,
          filters: args.filters,
          sort: args.sort,
          maxResults: args.maxResults,
          acknowledgeLowEnglish: args.acknowledgeLowEnglish,
        },
      });
      return { content: [{ type: "text", text: formatRecommendations(result) }] };
    },
  );
}
