/**
 * What a 401 from scienceaijournal.com means — two different gates answer it.
 *
 * NO IMPORTS, on purpose: journal/src/lib/__tests__/mcp-honesty-0927c.test.ts
 * runs this file directly.
 *
 *  1. The EDGE gate (journal/src/middleware.ts). It cannot look a key up, so
 *     it lets a request carrying a well-formed `Bearer saij_…` header through
 *     only on the endpoints listed in MCP_ELIGIBLE_PATHS, and answers every
 *     other protected endpoint with
 *       { "error": { "code": "UNAUTHORIZED", "message": "Authentication required", … } }
 *     for ANY key, valid or not. Since 2026-09-27 that is what
 *     pre_check_paper (/api/scorer) and recommend_journals
 *     (/api/journal-recommender) get: the server does not accept API keys on
 *     those two endpoints yet. Up to 0.1.3 this package told that user their
 *     key was "missing, revoked, or expired" — it was not.
 *  2. The ROUTE, after the edge let the request through: it verified the key
 *     and rejected it. Those bodies carry `error` as a plain string
 *     ("unauthorized", "Sign in to use this tool."). That one IS a bad key.
 *
 * Nothing is charged on either 401: the edge answers before the route runs,
 * and every metered route rejects a caller before its charge.
 */

/** The shape the edge gate checks (middleware.ts BEARER_TOKEN_REGEX, minus "Bearer "). */
const KEY_SHAPE = /^saij_[A-Za-z0-9_-]{20,32}$/;

/** Endpoints a tool calls → where the same tool runs in the web app today. */
export const WEB_APP_FOR_ENDPOINT: Record<string, { tool: string; name: string; path: string }> = {
  "/api/scorer": { tool: "pre_check_paper", name: "Pre-Check", path: "/scorer" },
  "/api/journal-recommender": {
    tool: "recommend_journals",
    name: "the Journal Finder",
    path: "/journal-recommender",
  },
};

/** True when the body is the edge gate's own 401 (error is an object with code UNAUTHORIZED). */
export function isEdgeUnauthorized(bodyText: string): boolean {
  try {
    const body = JSON.parse(bodyText) as { error?: unknown };
    const err = body && typeof body === "object" ? body.error : undefined;
    return !!err && typeof err === "object" && (err as { code?: unknown }).code === "UNAUTHORIZED";
  } catch {
    return false;
  }
}

export function describeUnauthorized(
  pathname: string,
  bodyText: string,
  baseUrl: string,
  apiKey: string,
): string {
  const keysPage = `${baseUrl}/settings?section=api-keys`;
  if (isEdgeUnauthorized(bodyText)) {
    if (!KEY_SHAPE.test(apiKey)) {
      return (
        "401 Unauthorized — SCIENCE_AI_API_KEY is not a complete key (expected saij_ followed by " +
        `22 characters). Copy it again, or generate a fresh one at ${keysPage}`
      );
    }
    const web = WEB_APP_FOR_ENDPOINT[pathname];
    if (web) {
      return (
        `401 — ${web.tool} is not available through MCP yet: the server turns every API key away on ` +
        `${pathname} today, so this says nothing about your key, and nothing was charged. ` +
        `Use ${web.name} in the web app instead: ${baseUrl}${web.path}`
      );
    }
    return (
      `401 — the server does not accept API keys on ${pathname} yet, so this tool is not available ` +
      "through MCP. Every key gets this answer there, so it says nothing about yours; nothing was charged."
    );
  }
  return (
    "401 Unauthorized — your SCIENCE_AI_API_KEY is missing, revoked, or expired, or it is limited to other tools. " +
    `Generate a fresh key at ${keysPage}`
  );
}

/**
 * Every other refusal the two metered, no-LLM tools can get (0.1.4). Each of
 * these is answered by the server BEFORE its charge, or is refunded by it, and
 * the message says which — an agent that only sees "HTTP 422" guesses.
 *
 *   403  the route's bot gate ("Automated access …"), or a scope refusal
 *        ({ error, scope }) — the server's own sentence is kept. On the two
 *        metered endpoints a key limited to OTHER tools never gets that 403:
 *        verifyApiKey (journal/src/lib/apikey.ts, apiKeyAllowedOnPath) turns
 *        it into no caller, so the route answers 401 "Sign in to use this
 *        tool." (describeUnauthorized above says so). The 403 branch stays as
 *        a guard should the server ever answer it;
 *   422  reason "non_english_input": the library and the journal index are
 *        English; `acknowledgeLowEnglish: true` runs it anyway;
 *   426  the server refuses a package older than the one that reads this
 *        endpoint's answer (0.1.3 printed no tier and called the tool free);
 *   429  the per-key limit ({ error, retryAfterSeconds }) or a per-IP limit;
 *   503  the library index is busy ({ busy: true, retryAfterS }).
 *
 * Returns null for a status it has nothing better to say about than
 * "HTTP <status> from <path>: <body>" — and for 403 / 422 / 503 on any
 * endpoint other than the two metered ones, where this file makes no claim
 * about what was charged.
 */
export function describeRefusal(
  status: number,
  pathname: string,
  bodyText: string,
  retryAfterHeader: string | null,
  baseUrl: string,
): string | null {
  let body: Record<string, unknown> | null = null;
  try {
    const parsed = JSON.parse(bodyText) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) body = parsed as Record<string, unknown>;
  } catch {
    /* not JSON: the callers fall back to the generic message */
  }
  const errObj =
    body && body.error && typeof body.error === "object" ? (body.error as Record<string, unknown>) : null;
  const serverText =
    body && typeof body.error === "string"
      ? body.error.trim()
      : errObj && typeof errObj.message === "string"
        ? errObj.message.trim()
        : "";
  const tool = WEB_APP_FOR_ENDPOINT[pathname]?.tool ?? "this tool";
  // "Nothing was charged" is only asserted for the two endpoints whose routes
  // were read for it (both refuse before their charge). For any other
  // endpoint this function adds no claim about charging.
  const knownUncharged = !!WEB_APP_FOR_ENDPOINT[pathname];

  if (status === 403) {
    if (!knownUncharged) return null;
    const scope = body && typeof body.scope === "string" ? body.scope : null;
    if (scope) {
      return (
        `403 — this API key does not carry the ${scope} scope, which ${tool} needs. Nothing was charged. ` +
        `Use a key that has it, or create one at ${baseUrl}/settings?section=api-keys`
      );
    }
    return serverText ? `403 — ${serverText} Nothing was charged.` : null;
  }
  if (status === 422 && knownUncharged && body && body.reason === "non_english_input") {
    return (
      "422 — the text does not look like English, and the library and journal index are English-language, " +
      "so the result would be unreliable. Nothing was charged. Pass an English title and abstract, or call " +
      `${tool} again with acknowledgeLowEnglish: true to run it anyway (that run is charged as usual).`
    );
  }
  if (status === 426) {
    return (
      `426 — ${serverText || "this endpoint needs a newer science-ai-mcp-server."} ` +
      "Nothing was charged. Restart the MCP client so it starts the current package " +
      "(npx -y science-ai-mcp-server@latest)."
    );
  }
  if (status === 429) {
    const fromBody = body && typeof body.retryAfterSeconds === "number" ? String(body.retryAfterSeconds) : null;
    const wait = retryAfterHeader || fromBody;
    return (
      `429 Rate Limit — ${serverText || "too many requests."} ` +
      (wait ? `Retry after ${wait}s.` : "Wait a minute and try again.") +
      (knownUncharged && !/charged/i.test(serverText) ? " A refused call is not charged." : "")
    );
  }
  if (status === 503 && knownUncharged && body && body.busy === true) {
    const fromBody = typeof body.retryAfterS === "number" ? String(body.retryAfterS) : null;
    const wait = retryAfterHeader || fromBody;
    return (
      "503 — the library index is busy right now, and nothing was charged. " +
      (wait ? `Retry after ${wait}s.` : "Retry in a few seconds.")
    );
  }
  return null;
}
