/**
 * start_writer_pipeline + get_writer_pipeline_status — /api/writer/pipeline
 *
 * The Article Writer pipeline is long-running (minutes per step), so we
 * expose it as TWO MCP tools — the LLM-host orchestrates polling. Same
 * route, different HTTP methods:
 *
 *   POST  /api/writer/pipeline             → enqueues a job, returns jobId
 *   GET   /api/writer/pipeline?sessionId=…&section=… → latest job for the (session, section)
 *
 * The MCP wrapper exposes status under a different name so callers can
 * tell start vs poll apart.
 *
 * ACCESS: the Article Writer is editor-gated (WRITER_EDITOR_EMAILS — see
 * journal/src/lib/writer-gate.ts). The middleware answers 404 on every
 * /api/writer/* path unless the request carries a SIGNED-IN BROWSER SESSION
 * whose email is on the list — and an API key is not a session. So during the
 * private beta every API-key call gets the 404, an editor's key included
 * (verified 2026-09-27; until then both descriptions said the 404 was only
 * for accounts without access). Both tools say so up front; http.ts turns the
 * 404 into a readable message.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { request } from "../http.js";

const SECTIONS = [
  "step_7_5",
  "introduction",
  "methodology",
  "results",
  "discussion",
  "references",
  "abstract",
] as const;

const startShape = {
  sessionId: z
    .string()
    .min(1)
    .max(200)
    .describe(
      "WriterSession id you already own. Create one via the web UI at /writer first; the MCP server does not own the session-creation flow today.",
    ),
  section: z
    .enum(SECTIONS)
    .optional()
    .describe(
      "Which section to run. Default 'step_7_5' (the code-search → adapt → verify → simulate chain).",
    ),
  language: z
    .string()
    .max(40)
    .optional()
    .describe("Simulation language override (python | r | matlab | ...)."),
  force: z
    .boolean()
    .optional()
    .describe(
      "If true, abort any existing queued/running job for this (sessionId, section) and enqueue fresh.",
    ),
};

const statusShape = {
  sessionId: z.string().min(1).max(200),
  section: z.enum(SECTIONS).optional(),
};

interface StartResponse {
  ok: boolean;
  jobId?: string;
  alreadyQueued?: boolean;
  error?: string;
}

interface StatusJob {
  id: string;
  section: string;
  status: string;
  stage?: string | null;
  stageIdx?: number | null;
  totalStages?: number | null;
  progressPct?: number | null;
  progressNote?: string | null;
  hallucination?: string | null;
  error?: string | null;
  results?: unknown;
  config?: Record<string, unknown>;
  queuedAt?: string;
  startedAt?: string | null;
  finishedAt?: string | null;
}

interface StatusResponse {
  ok: boolean;
  job: StatusJob | null;
  error?: string;
}

export function registerArticleWriter(server: McpServer): void {
  server.registerTool(
    "start_writer_pipeline",
    {
      title: "Start Article Writer Pipeline",
      description:
        "Not available with an API key during the Article Writer's private beta: " +
        "the server answers every API-key call to this tool with 404. Once the " +
        "writer is public: enqueue a writer-pipeline job for an existing WriterSession. " +
        "Returns immediately with a jobId; the orchestrator-worker claims " +
        "it within ~5 seconds. Default section is step_7_5 — the auto-chain " +
        "that replaces the three buttons in Step 7.5. Use " +
        "`get_writer_pipeline_status` to poll until status is 'done', 'failed', " +
        "or 'aborted'. Writer steps are billed in Science AI Journal credits.",
      inputSchema: startShape,
    },
    async (args) => {
      const body: Record<string, unknown> = {
        sessionId: args.sessionId,
        section: args.section ?? "step_7_5",
        force: args.force ?? false,
      };
      if (args.language) {
        body.config = { language: args.language };
      }
      const r = await request<StartResponse>({
        method: "POST",
        path: "/api/writer/pipeline",
        body,
      });
      if (!r.ok) {
        return {
          content: [
            {
              type: "text",
              text: `Failed to enqueue: ${r.error ?? "(no error message)"}`,
            },
          ],
          isError: true,
        };
      }
      const tail = r.alreadyQueued
        ? " (already queued; pass force=true to supersede)"
        : "";
      return {
        content: [
          {
            type: "text",
            text: `Writer job enqueued: jobId=${r.jobId}${tail}\nPoll with get_writer_pipeline_status({ sessionId: "${args.sessionId}", section: "${args.section ?? "step_7_5"}" }).`,
          },
        ],
      };
    },
  );

  server.registerTool(
    "get_writer_pipeline_status",
    {
      title: "Get Article Writer Pipeline Status",
      description:
        "Not available with an API key during the Article Writer's private beta " +
        "(the server answers every API-key call with 404). Once the writer is " +
        "public: return the latest writer-pipeline job for a (sessionId, section). " +
        "Use after `start_writer_pipeline` and poll every 5-10 seconds. " +
        "Terminal statuses: 'done', 'failed', 'aborted'.",
      inputSchema: statusShape,
    },
    async (args) => {
      const r = await request<StatusResponse>({
        method: "GET",
        path: "/api/writer/pipeline",
        query: {
          sessionId: args.sessionId,
          section: args.section ?? "step_7_5",
        },
      });
      if (!r.ok) {
        return {
          content: [
            {
              type: "text",
              text: `Status fetch failed: ${r.error ?? "(no error message)"}`,
            },
          ],
          isError: true,
        };
      }
      if (!r.job) {
        return {
          content: [
            {
              type: "text",
              text: "No job found for this (sessionId, section). Did you call start_writer_pipeline first?",
            },
          ],
        };
      }
      const j = r.job;
      const lines: string[] = [];
      lines.push(`Writer pipeline job ${j.id}`);
      lines.push(`  Section: ${j.section}`);
      lines.push(`  Status:  ${j.status}${j.stage ? ` (stage: ${j.stage})` : ""}`);
      if (typeof j.progressPct === "number") {
        const stageProgress =
          j.stageIdx != null && j.totalStages != null
            ? ` — stage ${j.stageIdx}/${j.totalStages}`
            : "";
        lines.push(`  Progress: ${j.progressPct}%${stageProgress}`);
      }
      if (j.progressNote) lines.push(`  Note: ${j.progressNote}`);
      if (j.hallucination) lines.push(`  Hallucination flag: ${j.hallucination}`);
      if (j.error) lines.push(`  Error: ${j.error}`);
      if (j.queuedAt) lines.push(`  Queued: ${j.queuedAt}`);
      if (j.finishedAt) lines.push(`  Finished: ${j.finishedAt}`);
      return { content: [{ type: "text", text: lines.join("\n") }] };
    },
  );
}
