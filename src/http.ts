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
import { describeRefusal, describeUnauthorized, WEB_APP_FOR_ENDPOINT } from "./format/http-errors.js";

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
      // Two gates answer 401 and they mean different things — the edge turns
      // every key away on endpoints not yet open to API keys, the route
      // rejects a bad key. See format/http-errors.ts.
      throw new Error(describeUnauthorized(url.pathname, detail, cfg.baseUrl, cfg.apiKey));
    }
    if (res.status === 402) {
      // The metered routes answer 402 BEFORE taking any credits
      // ({ error, creditsNeeded, creditsAvailable }), so say both halves: the
      // call was not charged, and how to fix it.
      let needed = "";
      try {
        const body = JSON.parse(detail) as { creditsNeeded?: unknown; creditsAvailable?: unknown };
        if (typeof body.creditsNeeded === "number") {
          needed = ` This call needs ${body.creditsNeeded} credits` +
            (typeof body.creditsAvailable === "number" ? `; the account has ${body.creditsAvailable}.` : ".");
        }
      } catch {
        /* non-JSON body — fall back to the generic message */
      }
      throw new Error(
        `402 Insufficient credits — nothing was charged.${needed} ` +
          `Top up at ${cfg.baseUrl}/pricing (credits come in one-time packs and never expire).`,
      );
    }
    if (res.status === 404 && url.pathname.startsWith("/api/writer/") && !detail.trim()) {
      // The writer gate 404s with an EMPTY body so the feature looks absent
      // (a 404 from the route itself carries a JSON body and falls through to
      // the generic message); without this the agent sees a bare "HTTP 404"
      // and guesses. The gate checks a signed-in browser session, which an API
      // key does not carry, so during the private beta EVERY key gets this —
      // not only keys of accounts without writer access, as an earlier draft
      // of this message said.
      throw new Error(
        "404 — the Article Writer is in private beta, and during the beta the server " +
          "answers every API-key call to the writer with 404. Nothing was charged.",
      );
    }
    // 403 scope / 422 language gate / 426 old package / 429 limits / 503 busy:
    // each is answered before the charge, and the message says so
    // (format/http-errors.ts describeRefusal).
    const refusal = describeRefusal(res.status, url.pathname, detail, res.headers.get("retry-after"), cfg.baseUrl);
    if (refusal) throw new Error(refusal);
    if (res.status === 429) {
      const retryAfter = res.headers.get("retry-after");
      throw new Error(
        `429 Rate Limit — too many requests. ${retryAfter ? `Retry after ${retryAfter}s.` : "Wait a minute and try again."}`,
      );
    }
    if (res.status >= 500 && WEB_APP_FOR_ENDPOINT[url.pathname]) {
      if (res.status === 500) {
        // Both metered routes refund a call that fails after its charge
        // (refundToolCredit(…, "handler_error") in their catch blocks).
        throw new Error(
          `HTTP 500 from ${url.pathname}${detail ? `: ${detail}` : ""} — the server failed while running the tool. ` +
            "A call that was charged before the failure is refunded automatically. Try again in a minute.",
        );
      }
      // 502 / 504 (or a 503 that is not the route's own "busy" answer) come
      // from the gateway: the route may still have finished, charged and
      // saved the run. Never tell the agent it was free, and never tell it to
      // retry blindly.
      throw new Error(
        `HTTP ${res.status} from ${url.pathname} — the gateway gave no answer in time. The run may still have ` +
          "finished and been charged; a finished run is saved in the account's history in the web app " +
          `(${cfg.baseUrl}). Check there before calling again.`,
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
