/**
 * find_research_gaps — POST /api/research-gaps
 *
 * Returns synthesised research gaps + a field overview + most-cited +
 * most-recent papers around a query. Auth required (consumes credits;
 * rate-limited to 10/hr per IP).
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { request } from "../http.js";

const inputShape = {
  query: z
    .string()
    .min(10)
    .max(2000)
    .describe(
      "Research query (≥ 10 chars). Free-form prose or a title + abstract joined by newline.",
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
      "Optional departmentId to enable methodology-alignment hints (boosts gaps whose text matches your discipline's KPI / question vocabulary).",
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
  gaps: Gap[];
  fieldOverview?: { name?: string; description?: string } | null;
  mostCited: Paper[];
  mostRecent: Paper[];
}

export function registerResearchGaps(server: McpServer): void {
  server.registerTool(
    "find_research_gaps",
    {
      title: "Find Research Gaps",
      description:
        "Surface research gaps + the most-cited and most-recent papers around " +
        "a query. Returns cross-paper synthesis gaps first (LLM-derived, grounded " +
        "in ≥ 2 papers), then catalogue-level single-paper gaps. Plus a field " +
        "overview and ≤ 50 top-cited and ≤ 50 most-recent papers. Uses " +
        "Science AI Journal credits; rate-limited to 10 requests/hour per IP. " +
        "Use for early-stage research discovery, literature gap identification, " +
        "and proposal scoping.",
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

      const lines: string[] = [];
      const fo = result.fieldOverview;
      if (fo?.name) {
        lines.push(`Field: ${fo.name}`);
        if (fo.description) lines.push(`  ${fo.description}`);
        lines.push("");
      }
      lines.push(`## Research gaps (${result.gaps.length})`);
      for (let i = 0; i < result.gaps.length; i++) {
        const g = result.gaps[i];
        const prov = g.provenance ? ` [${g.provenance}]` : "";
        const topic = g.topic ? ` (topic: ${g.topic})` : "";
        const paper = g.paper ? ` — anchor: ${g.paper}` : "";
        lines.push(`  ${i + 1}. ${g.text}${prov}${topic}${paper}`);
      }
      lines.push("");
      lines.push(`## Most-cited (${result.mostCited.length})`);
      for (const p of result.mostCited.slice(0, 10)) {
        const yr = p.year ? ` (${p.year})` : "";
        const cit =
          typeof p.citations === "number" ? ` · ${p.citations} cit` : "";
        const venue = p.venue ? ` · ${p.venue}` : "";
        lines.push(`  - ${p.title}${yr}${cit}${venue}`);
      }
      lines.push("");
      lines.push(`## Most-recent (${result.mostRecent.length})`);
      for (const p of result.mostRecent.slice(0, 10)) {
        const yr = p.year ? ` (${p.year})` : "";
        const venue = p.venue ? ` · ${p.venue}` : "";
        lines.push(`  - ${p.title}${yr}${venue}`);
      }
      return { content: [{ type: "text", text: lines.join("\n") }] };
    },
  );
}
