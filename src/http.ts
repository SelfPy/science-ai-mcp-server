/**
 * Minimal HTTP client for talking to the Science AI Journal app.
 *
 * Adds the Bearer auth header on every request, applies a generous-but-
 * bounded timeout, normalises non-2xx responses into thrown Errors with
 * useful messages, and parses JSON responses.
 *
 * Kept dependency-free — Node 20+ ships a global fetch + AbortController,
 * which is everything we need.
 */

import { getConfig } from "./config.js";

export interface RequestOpts {
  method?: "GET" | "POST" | "DELETE";
  path: string;
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  /** Override the per-process default. */
  timeoutMs?: number;
}

export async function request<T = unknown>(opts: RequestOpts): Promise<T> {
  const cfg = getConfig();
  const url = new URL(opts.path, cfg.baseUrl);
  if (opts.query) {
    for (const [k, v] of Object.entries(opts.query)) {
      if (v === undefined) continue;
      url.searchParams.set(k, String(v));
    }
  }

  const controller = new AbortController();
  const timeoutMs = opts.timeoutMs ?? cfg.requestTimeoutMs;
  const t = setTimeout(() => controller.abort(), timeoutMs);

  let res: Response;
  try {
    res = await fetch(url, {
      method: opts.method ?? (opts.body ? "POST" : "GET"),
      headers: {
        "Authorization": `Bearer ${cfg.apiKey}`,
        "Accept": "application/json",
        "User-Agent": cfg.userAgent,
        ...(opts.body !== undefined
          ? { "Content-Type": "application/json" }
          : {}),
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(t);
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(
        `Request to ${url.pathname} timed out after ${timeoutMs}ms.`,
      );
    }
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Network error calling ${url.pathname}: ${msg}`);
  } finally {
    clearTimeout(t);
  }

  if (!res.ok) {
    let detail = "";
    try {
      detail = (await res.text()).slice(0, 500);
    } catch {
      /* ignore */
    }
    if (res.status === 401) {
      throw new Error(
        `401 Unauthorized — your SCIENCE_AI_API_KEY is missing, revoked, or expired. ` +
          `Generate a fresh key at ${cfg.baseUrl}/settings?section=api-keys`,
      );
    }
    if (res.status === 429) {
      const retryAfter = res.headers.get("retry-after");
      throw new Error(
        `429 Rate Limit — too many requests. ${retryAfter ? `Retry after ${retryAfter}s.` : "Wait a minute and try again."}`,
      );
    }
    throw new Error(
      `HTTP ${res.status} from ${url.pathname}${detail ? `: ${detail}` : ""}`,
    );
  }

  // Some routes return text/event-stream or plain text; we only do JSON here.
  const ct = res.headers.get("content-type") || "";
  if (!ct.includes("application/json")) {
    const text = await res.text();
    // Best-effort JSON parse; if it isn't JSON, surface as text.
    try {
      return JSON.parse(text) as T;
    } catch {
      return text as unknown as T;
    }
  }
  return (await res.json()) as T;
}
