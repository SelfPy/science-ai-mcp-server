/**
 * Barrel: register every tool against an McpServer.
 *
 * Adding a tool? Drop a new file alongside, export a `registerXxx(server)`
 * function, and import + call it here. Keep the call list alphabetised by
 * tool slug so it's easy to scan against the /developers/mcp catalogue.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerArticleWriter } from "./article-writer.js";
import { registerDuplicatePublication } from "./duplicate-publication.js";
import { registerHakemReview } from "./hakem-review.js";
import { registerJournalRecommender } from "./journal-recommender.js";
import { registerPreCheck } from "./pre-check.js";
import { registerResearchGaps } from "./research-gaps.js";

export function registerAllTools(server: McpServer): void {
  registerArticleWriter(server); // exposes start_ + get_writer_pipeline_status
  registerDuplicatePublication(server);
  registerHakemReview(server);
  registerJournalRecommender(server);
  registerPreCheck(server);
  registerResearchGaps(server);
}
