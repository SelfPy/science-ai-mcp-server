/**
 * Runtime configuration — read once at process start.
 *
 * stdio MCP servers run as long-lived subprocesses spawned by the host
 * client (Claude Desktop, Cursor, …). Env vars are baked in at spawn
 * time from the client's config file; we don't watch for changes.
 */

const DEFAULT_BASE_URL = "https://scienceaijournal.com";

export interface ServerConfig {
  apiKey: string;
  baseUrl: string;
  userAgent: string;
  /** Default request timeout in ms; per-tool overrides allowed. */
  requestTimeoutMs: number;
}

let cached: ServerConfig | null = null;

export function getConfig(): ServerConfig {
  if (cached) return cached;

  const apiKey = (process.env.SCIENCE_AI_API_KEY || "").trim();
  if (!apiKey) {
    // Fail loudly on stdout so the MCP host surfaces a useful error to the
    // user. Without an API key every tool call would just 401, which the
    // host UI tends to render as a generic "tool failed".
    throw new Error(
      "SCIENCE_AI_API_KEY is required.\n" +
        "Generate a key at https://scienceaijournal.com/settings?section=api-keys\n" +
        "and add it to your MCP client config under the `env` block:\n\n" +
        '  "env": { "SCIENCE_AI_API_KEY": "saij_…" }',
    );
  }
  if (!apiKey.startsWith("saij_")) {
    throw new Error(
      `SCIENCE_AI_API_KEY looks malformed (expected "saij_…" prefix). Got ${apiKey.slice(0, 8)}…`,
    );
  }

  const baseUrl =
    (process.env.SCIENCE_AI_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, "") ||
    DEFAULT_BASE_URL;

  const requestTimeoutMs = (() => {
    const raw = process.env.SCIENCE_AI_REQUEST_TIMEOUT_MS;
    if (!raw) return 120_000; // 2 min — covers HAKEM agent calls
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? Math.min(n, 600_000) : 120_000;
  })();

  cached = {
    apiKey,
    baseUrl,
    userAgent: `science-ai-mcp-server/0.1.0 (+${DEFAULT_BASE_URL}/developers/mcp)`,
    requestTimeoutMs,
  };
  return cached;
}
