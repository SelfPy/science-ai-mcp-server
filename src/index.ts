#!/usr/bin/env node
/**
 * science-ai-mcp-server — stdio entrypoint.
 *
 * Spawned as a subprocess by Claude Desktop / Cursor / Cline. Communicates
 * over JSON-RPC on stdin/stdout (the stdio transport). One process per
 * MCP host; configuration comes from env vars set in the host's
 * mcp config file (see /developers/mcp on scienceaijournal.com).
 *
 * Failures during config load print to stderr so the host surfaces them
 * to the user; the process exits 1 so the host knows the server is dead.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { getConfig } from "./config.js";
import { registerAllTools } from "./tools/index.js";
import { VERSION } from "./version.js";

async function main(): Promise<void> {
  // Validate config first. Throws with a helpful message if SCIENCE_AI_API_KEY
  // is missing or malformed — the host surfaces stderr to the user.
  try {
    getConfig();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[science-ai-mcp-server] startup failed:\n${msg}\n`);
    process.exit(1);
  }

  const server = new McpServer({
    name: "science-ai-journal",
    version: VERSION,
  });

  registerAllTools(server);

  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Stdio servers run until the host disconnects. The SDK handles SIGINT
  // / pipe-close cleanly, so no extra signal wiring needed here.
}

main().catch((err) => {
  const msg = err instanceof Error ? err.stack || err.message : String(err);
  process.stderr.write(`[science-ai-mcp-server] crashed:\n${msg}\n`);
  process.exit(1);
});
