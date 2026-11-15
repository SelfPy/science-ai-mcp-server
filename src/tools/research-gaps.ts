/**
 * find_research_gaps — POST /api/research-gaps
 *
 * The FREE literature search (since 2026-09-23): a field overview plus the
 * papers the search found — the closest matches from the 7.9M-paper local
 * library, and the most-cited and most-recent work on the topic. It charges
 * nothing and makes no LLM call (journal/src/app/api/research-gaps/route.ts,
 * header note). Rate-limited to 10 searches/hour per IP.
 *
 * It returns NO research gaps: the route answers `gaps: []` with
 * `gapsLocked: true`. Gaps come from unlocking the topic in the web app, one
 * charge of SERVICE_COSTS.literature_table (50 credits) that also covers the
 * filled comparison table, a research proposal and one Pro Report run. This
 * package cannot import journal/src/lib/credits-constants.ts, so the number
 * is typed below; journal/src/lib/__tests__/marketing-price-claims.test.ts
 * fails if it drifts. Until 0.1.4 the description promised "cross-paper
 * synthesis gaps first (LLM-derived)" and said the search "uses credits" —
 * both false since the re-pricing.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { request } from "../http.js";

const UNLOCK_URL = "https://scienceaijournal.com/research-gaps";

const inputShape = {
  query: z
    .string()
    .min(4)
    .max(2000)
    .describe(
      "Research topic (≥ 4 chars). A full phrase finds sharper results than a single word; a title + abstract joined by a newline also works.",
    ),
  field: z
    .string()
    .max(80)
    .optional()
    .describe("Optional field bias (e.g. 'computer_science', 'biology')."),
  departmentId: z
    .string()
    .max(60)
    .optional()
    .describe(
      "Optional departmentId to enable methodology-alignment hints for your discipline's vocabulary.",
    ),
};

interface Gap {
  text: string;
  field?: string;
  provenance?: string;
  paper?: string;
  year?: number;
  type?: string;
  topic?: string;
  consensus?: string;
  evidenceStrength?: string;
  paperCount?: number;
  trend?: string;
}
interface Paper {
  title: string;
  year?: number;
  citations?: number;
  venue?: string;
  doi?: string;
  authors?: string[];
}
interface GapsResponse {
  gaps?: Gap[];
  /** True on every free search: the gaps are produced by the paid topic unlock. */
  gapsLocked?: boolean;
  fieldOverview?: { name?: string; description?: string } | null;
  /** Closest matches from the local library, relevance-ranked. */
  libraryPapers?: Paper[];
  mostCited?: Paper[];
  mostRecent?: Paper[];
}

export function registerResearchGaps(server: McpServer): void {
  server.registerTool(
    "find_research_gaps",
    {
      title: "Research Gaps: Free Literature Search",
      description:
        "Free literature search on a research topic — spends no credits and makes " +
        "no LLM call; rate-limited to 10 searches/hour per IP. Returns a field " +
        "overview and the papers the search found: the closest matches from a " +
        "7.9M-paper local library, plus the most-cited and most-recent work on the " +
        "topic. It does NOT return research gaps: the response carries gaps: [] and " +
        "gapsLocked: true. Gaps come from unlocking the topic in the web app at " +
        "scienceaijournal.com/research-gaps — one charge of 50 credits that also " +
        "includes the filled comparison table, a research proposal and one Pro " +
        "Report run. Use for early-stage literature discovery and proposal scoping.",
      inputSchema: inputShape,
    },
    async (args) => {
      const result = await request<GapsResponse>({
        method: "POST",
        path: "/api/research-gaps",
        body: {
          query: args.query,
          field: args.field,
          departmentId: args.departmentId,
        },
      });

      const gaps = result.gaps ?? [];
      const library = result.libraryPapers ?? [];
      const cited = result.mostCited ?? [];
      const recent = result.mostRecent ?? [];

      const lines: string[] = [];
      const fo = result.fieldOverview;
      if (fo?.name) {
        lines.push(`Field: ${fo.name}`);
        if (fo.description) lines.push(`  ${fo.description}`);
        lines.push("");
      }
      // Literature first, then the gaps — the order the web finder shows them.
      if (library.length > 0) {
        lines.push(`## Closest papers in the library (${library.length})`);
        for (const p of library.slice(0, 10)) lines.push(formatPaper(p));
        lines.push("");
      }
      lines.push(`## Most-cited (${cited.length})`);
      for (const p of cited.slice(0, 10)) lines.push(formatPaper(p));
      lines.push("");
      lines.push(`## Most-recent (${recent.length})`);
      for (const p of recent.slice(0, 10)) lines.push(formatPaper(p));
      lines.push("");
      if (gaps.length > 0) {
        lines.push(`## Research gaps (${gaps.length})`);
        for (let i = 0; i < gaps.length; i++) {
          const g = gaps[i];
          const prov = g.provenance ? ` [${g.provenance}]` : "";
          const topic = g.topic ? ` (topic: ${g.topic})` : "";
          const paper = g.paper ? ` — anchor: ${g.paper}` : "";
          lines.push(`  ${i + 1}. ${g.text}${prov}${topic}${paper}`);
        }
      } else if (result.gapsLocked) {
        // Say so explicitly: an empty list with no reason reads to an agent as
        // "this topic has no gaps", which is not what the zero means.
        lines.push("## Research gaps: locked");
        lines.push(
          `  This free search returns the literature only. To get the research gaps, unlock the topic at ${UNLOCK_URL} ` +
            "(one charge of 50 credits, which also includes the filled comparison table, a research proposal and one Pro Report run).",
        );
      } else {
        lines.push("## Research gaps (0)");
      }
      return { content: [{ type: "text", text: lines.join("\n") }] };
    },
  );
}

function formatPaper(p: Paper): string {
  const yr = p.year ? ` (${p.year})` : "";
  const cit = typeof p.citations === "number" && p.citations > 0 ? ` · ${p.citations} cit` : "";
  const venue = p.venue ? ` · ${p.venue}` : "";
  const doi = p.doi ? `  doi:${p.doi}` : "";
  return `  - ${p.title}${yr}${cit}${venue}${doi}`;
}
