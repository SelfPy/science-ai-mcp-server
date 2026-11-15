/**
 * check_duplicate_publication — POST /api/prior-publication
 *
 * Cross-references title + abstract (and optionally DOI) against
 * CrossRef, PubMed, arXiv, bioRxiv, medRxiv, Europe PMC and Unpaywall
 * (FACTS.priorPubSources, verified against the live endpoint) + the local
 * library. Returns a status, confidence, and a human-readable message.
 *
 * FREE via this route: /api/prior-publication has no credit charge
 * (journal/src/app/api/prior-publication/route.ts). The 7.9M library size is
 * libraryPapersLabel in journal/src/lib/seo/constants.ts.
 *
 * Description rewritten 2026-09-27 against checkPriorPublication()
 * (journal/src/lib/reviewers/prior-publication.ts). It promised a
 * "salami-slicing check" (the check matches ONE title + abstract against
 * published records; it never compares a manuscript with the author's other
 * papers for overlapping results), "~30 seconds" (every source runs in
 * parallel under a 12 s per-source timeout, TIMEOUT_MS), and three verdicts
 * (the status union also has preprint_found — a match that is a preprint, not
 * a journal article — and unable_to_check). It also said nothing of the
 * route's rate limit (journal/src/lib/prior-pub-rate-limit.ts). Unpaywall is
 * DOI-only (checkUnpaywall answers "requires a DOI" without a lookup when
 * none is passed), so the description ties it to the `doi` input.
 * Review pass (same day): each of those six external sources SEARCHES by
 * title — the abstract only confirms a close match or feeds the confidence
 * score (PubMed ignores it) — so the description says "by title", not "by
 * title and abstract" (the local library does also match on the abstract;
 * the description does not say otherwise). And the
 * message does not always name its source (CrossRef's preprint message does
 * not; the tool prints `message`, not `source`), so it no longer promises to.
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
        "Pre-submission duplicate-publication check: has this paper already " +
        "been published? Checks 7 external sources — CrossRef, PubMed, arXiv, " +
        "bioRxiv, medRxiv and Europe PMC by title (an abstract, when given, " +
        "is used to confirm close matches), and Unpaywall by DOI (so only when " +
        "you pass one) — plus a 7.9M-paper local library, all queried in " +
        "parallel with a 12-second cap per source. Returns a status — " +
        "likely_published, preprint_found (the match is a preprint, not a " +
        "journal article), uncertain (a possible match), not_found, or " +
        "unable_to_check (no source could be reached) — with a message and, " +
        "on a match, a link and a confidence score where the source gives " +
        "one. A not_found that could not reach some sources says which. " +
        "Free — spends no credits. Rate-limited per account (an API key " +
        "counts against its account); a 429 says when to retry. Use before " +
        "submission to catch an accidental duplicate or to see whether a " +
        "preprint has since been formally published.",
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
