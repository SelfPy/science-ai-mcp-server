/**
 * check_duplicate_publication — POST /api/prior-publication
 *
 * Cross-references title + abstract (and optionally DOI) against
 * CrossRef + arXiv + medRxiv + bioRxiv + Unpaywall + the institutional
 * library. Returns a status, confidence, and a human-readable message.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { request } from "../http.js";

const inputShape = {
  title: z
    .string()
    .min(1)
    .max(600)
    .describe("Paper title (required)."),
  abstract: z
    .string()
    .max(20_000)
    .optional()
    .describe("Paper abstract — improves match accuracy."),
  doi: z
    .string()
    .max(200)
    .optional()
    .describe("Known DOI for the paper, if any."),
};

interface PriorPubResponse {
  status?: string;
  confidence?: number;
  message?: string;
  link?: string;
  [k: string]: unknown;
}

export function registerDuplicatePublication(server: McpServer): void {
  server.registerTool(
    "check_duplicate_publication",
    {
      title: "Check Duplicate Publication",
      description:
        "Pre-submission duplicate-publication and salami-slicing check. " +
        "Cross-references the title + abstract against CrossRef, arXiv, " +
        "medRxiv, bioRxiv, Unpaywall, and a 900k-paper institutional " +
        "library in ~30 seconds. Returns a status (likely_published, " +
        "uncertain, or not_found) with a confidence score and message. " +
        "Free. Use before submission to catch accidental duplicates or " +
        "to confirm a preprint hasn't been formally published yet.",
      inputSchema: inputShape,
    },
    async (args) => {
      const result = await request<PriorPubResponse>({
        method: "POST",
        path: "/api/prior-publication",
        body: {
          title: args.title,
          abstract: args.abstract,
          doi: args.doi,
        },
      });

      const lines: string[] = ["Duplicate publication check"];
      lines.push(`  Status: ${result.status ?? "(unknown)"}`);
      if (typeof result.confidence === "number") {
        lines.push(`  Confidence: ${Math.round(result.confidence * 100)}%`);
      }
      if (result.message) {
        lines.push(`  Detail: ${result.message}`);
      }
      if (result.link) {
        lines.push(`  Link: ${result.link}`);
      }
      return { content: [{ type: "text", text: lines.join("\n") }] };
    },
  );
}
