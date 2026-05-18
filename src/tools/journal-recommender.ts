/**
 * recommend_journals — POST /api/journal-recommender
 *
 * Returns ranked target journals from a ~1,200-venue index with tier,
 * publisher, OA status, impact factor proxy, predatory flag, and
 * example similar papers per recommendation.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { request } from "../http.js";

const filtersShape = z
  .object({
    excludePredatory: z.boolean().optional(),
    openAccessOnly: z.boolean().optional(),
    minTier: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
    excludePreprints: z.boolean().optional(),
  })
  .optional()
  .describe(
    "Optional filter object. excludePredatory drops Beall's-archive matches; " +
      "openAccessOnly keeps only OA journals; minTier sets a Tier 1/2/3 floor.",
  );

const inputShape = {
  title: z
    .string()
    .min(1)
    .max(600)
    .describe("Paper title (required)."),
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
  filters: filtersShape,
  sort: z
    .enum(["best", "fastest", "highestIf", "mostAccepting"])
    .optional()
    .describe(
      'Sort mode. "best" (default) maximises relevance; "fastest" prefers fast-decision venues; ' +
        '"highestIf" sorts by 2-year mean citedness; "mostAccepting" prefers higher published-volume venues.',
    ),
  maxResults: z
    .number()
    .int()
    .min(1)
    .max(25)
    .optional()
    .describe("How many recommendations to return. Default 10, cap 25."),
};

interface Rec {
  canonical: string;
  scorePct: number;
  letterGrade: string;
  metadata: {
    tier?: number | null;
    publisher?: string | null;
    openAccess?: boolean;
    citedness2yr?: number | null;
    isPredatory?: boolean;
    homepageUrl?: string | null;
  };
  examplePapers?: Array<{
    title: string;
    year?: number;
    doi?: string;
  }>;
  topicOverlapTerms?: string[];
}

interface RecommendResponse {
  recommendations: Rec[];
  executionMs: number;
  corpusSize: number;
  indexJournalCount: number;
  indexGeneratedAt: string;
  ftsErrored?: boolean;
  tokensUsed?: string[];
}

export function registerJournalRecommender(server: McpServer): void {
  server.registerTool(
    "recommend_journals",
    {
      title: "Recommend Target Journals",
      description:
        "Recommend ranked target journals for a paper from a ~1,200-venue " +
        "index. Each result includes a letter grade (A-F), a match percentage, " +
        "tier (1-3), publisher, open-access status, 2-year mean citedness, " +
        "predatory-journal flag, and 2-3 example similar papers that landed " +
        "at that venue. Free — runs locally via FTS5 + topic-RAG, no LLM call. " +
        "Use when the user asks 'where should I submit this paper' or wants " +
        "to compare target venues before deciding.",
      inputSchema: inputShape,
    },
    async (args) => {
      const result = await request<RecommendResponse>({
        method: "POST",
        path: "/api/journal-recommender",
        body: {
          title: args.title,
          abstract: args.abstract,
          fullText: args.fullText,
          keywords: args.keywords,
          field: args.field,
          filters: args.filters,
          sort: args.sort,
          maxResults: args.maxResults,
        },
      });

      const lines: string[] = [];
      lines.push(
        `Journal recommendations (${result.recommendations.length} of ${result.indexJournalCount} indexed, ${result.executionMs}ms)`,
      );
      if (result.ftsErrored) {
        lines.push(
          "  [warning] full-text-search index errored — results are degraded.",
        );
      }
      lines.push("");
      for (let i = 0; i < result.recommendations.length; i++) {
        const r = result.recommendations[i];
        const m = r.metadata;
        const tier = m.tier ? `T${m.tier}` : "T?";
        const oa = m.openAccess ? "OA" : "—";
        const ifv =
          typeof m.citedness2yr === "number"
            ? `IF≈${m.citedness2yr.toFixed(1)}`
            : "IF—";
        const predatory = m.isPredatory ? " ⚠ predatory" : "";
        const overlap =
          r.topicOverlapTerms && r.topicOverlapTerms.length > 0
            ? `\n      topic overlap: ${r.topicOverlapTerms.slice(0, 5).join(", ")}`
            : "";
        lines.push(
          `  ${i + 1}. ${r.canonical}  —  ${r.scorePct}% (${r.letterGrade}) · ${tier} · ${oa} · ${ifv} · ${m.publisher ?? "?"}${predatory}${overlap}`,
        );
        if (r.examplePapers && r.examplePapers.length > 0) {
          for (const p of r.examplePapers.slice(0, 2)) {
            const y = p.year ? ` (${p.year})` : "";
            const doi = p.doi ? `  doi:${p.doi}` : "";
            lines.push(`        e.g. ${p.title}${y}${doi}`);
          }
        }
      }
      return { content: [{ type: "text", text: lines.join("\n") }] };
    },
  );
}
