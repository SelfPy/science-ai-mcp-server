/**
 * End-to-end tests for the two metered, no-LLM tools (pre_check_paper and
 * recommend_journals) and the tool list — 0.1.4.
 *
 * What runs: the BUILT package (dist/, exactly what npm ships) behind the MCP
 * SDK's in-memory transport, talking HTTP to a mock of scienceaijournal.com on
 * 127.0.0.1. Nothing here reaches the real site and nothing is charged.
 *
 * The mock answers with the server's real response shapes; each is quoted from
 * the route that sends it (journal/src/app/api/scorer/route.ts,
 * journal/src/app/api/journal-recommender/route.ts, journal/src/middleware.ts,
 * journal/src/lib/partners/scopes.ts and api-limits.ts, lib/meter-tool.ts).
 * The app's own suite (journal/src/app/api/…/mcp-apikey-q4doc.test.ts) checks
 * that the routes really send them.
 *
 * Run: npm test   (builds first; zero dependencies beyond the package's own).
 */
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = JSON.parse(readFileSync(join(HERE, "..", "package.json"), "utf8"));
// 22 url-safe characters after the prefix: the shape the server's edge accepts.
// Not a real key (it is never sent anywhere but 127.0.0.1).
const KEY = "saij_" + "T".repeat(22);

/** What the mock answers next, and what it last received. */
let next = { status: 200, body: {}, headers: {} };
let seen = [];
let server;
let client;

function reply(status, body, headers = {}) {
  next = { status, body, headers };
}

before(async () => {
  server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      let json = null;
      try {
        json = raw ? JSON.parse(raw) : null;
      } catch {
        json = "(not json)";
      }
      seen.push({ method: req.method, url: req.url, headers: req.headers, body: json });
      const isText = typeof next.body === "string";
      res.writeHead(next.status, {
        "content-type": isText ? "text/html" : "application/json",
        ...next.headers,
      });
      res.end(isText ? next.body : JSON.stringify(next.body));
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address();
  // config.ts reads the env once, at the first getConfig(): set it before any import of dist/.
  process.env.SCIENCE_AI_API_KEY = KEY;
  process.env.SCIENCE_AI_BASE_URL = `http://127.0.0.1:${port}`;

  const { McpServer } = await import("@modelcontextprotocol/sdk/server/mcp.js");
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");
  const { registerAllTools } = await import("../dist/tools/index.js");
  const { VERSION } = await import("../dist/version.js");
  const mcp = new McpServer({ name: "science-ai-journal", version: VERSION });
  registerAllTools(mcp);
  const [a, b] = InMemoryTransport.createLinkedPair();
  await mcp.connect(a);
  client = new Client({ name: "test-client", version: "0.0.0" });
  await client.connect(b);
});

after(async () => {
  await client?.close();
  await new Promise((r) => server.close(r));
});

beforeEach(() => {
  seen = [];
  reply(200, {});
});

const PAPER = {
  title: "Maximum power point tracking for grid-tied photovoltaic inverters under partial shading",
  abstract:
    "We propose a tracking method for photovoltaic inverters that stays at the global maximum under partial shading " +
    "and evaluate it on a 5 kW grid-tied test bench against perturb-and-observe and incremental conductance.",
};

async function call(name, args) {
  const res = await client.callTool({ name, arguments: args });
  const text = (res.content ?? []).map((c) => c.text ?? "").join("\n");
  return { isError: res.isError === true, text };
}

// ── The catalogue ─────────────────────────────────────────────────────────
test("tools/list returns the 7 tools, and the handshake reports the package version", async () => {
  const { tools } = await client.listTools();
  assert.deepEqual(
    tools.map((t) => t.name).sort(),
    [
      "ai_review_paper",
      "check_duplicate_publication",
      "find_research_gaps",
      "get_writer_pipeline_status",
      "pre_check_paper",
      "recommend_journals",
      "start_writer_pipeline",
    ],
  );
  assert.equal(client.getServerVersion()?.version, PKG.version);
});

test("both tools state their price, promise nothing free, and carry no accuracy figure", async () => {
  const { tools } = await client.listTools();
  for (const name of ["pre_check_paper", "recommend_journals"]) {
    const t = tools.find((x) => x.name === name);
    assert.match(t.description, /Costs 15 Science AI Journal credits per call/, name);
    assert.match(t.description, /HTTP 402 and is not charged/, name);
    assert.match(t.description, /no LLM call/, name);
    // "free" as a price would be the 0.1.3 defect (the server charges 15 credits).
    assert.doesNotMatch(t.description, /\bfree\b/i, name);
    assert.ok(t.inputSchema.properties.acknowledgeLowEnglish, `${name} accepts acknowledgeLowEnglish`);
  }
  const jf = tools.find((x) => x.name === "recommend_journals").description;
  // No hit-rate / accuracy percentage for the Journal Finder (the only "%" the
  // description may carry is none at all: it speaks of "a match percentage").
  assert.doesNotMatch(jf, /\d\s?%/);
  assert.doesNotMatch(jf, /accura|hit rate|top[- ]?\d/i);
  assert.match(jf, /not a prediction of acceptance/);
});

// ── Authentication ────────────────────────────────────────────────────────
test("every call carries the Bearer key, JSON, and a User-Agent with the real version", async () => {
  reply(200, { tier1: "12%", tier2: "35%", tier3: "60%", field: "Engineering" });
  await call("pre_check_paper", PAPER);
  reply(200, { recommendations: [] });
  await call("recommend_journals", PAPER);
  assert.equal(seen.length, 2);
  assert.deepEqual(seen.map((s) => `${s.method} ${s.url}`), ["POST /api/scorer", "POST /api/journal-recommender"]);
  for (const s of seen) {
    assert.equal(s.headers.authorization, `Bearer ${KEY}`);
    assert.equal(s.headers["content-type"], "application/json");
    // The server refuses older packages by this header (they sent "0.1.0").
    assert.match(s.headers["user-agent"], new RegExp(`^science-ai-mcp-server/${PKG.version.replace(/\./g, "\\.")} `));
  }
});

test("the request bodies carry only what the routes read — and never a web-app bundle surface", async () => {
  reply(200, { tier1: "12%", tier2: "35%", tier3: "60%" });
  await call("pre_check_paper", { ...PAPER, keywords: "MPPT, inverter", force: true, acknowledgeLowEnglish: true });
  assert.deepEqual(seen[0].body, {
    title: PAPER.title,
    abstract: PAPER.abstract,
    keywords: "MPPT, inverter",
    force: true,
    acknowledgeLowEnglish: true,
  });
  reply(200, { recommendations: [] });
  await call("recommend_journals", { ...PAPER, maxResults: 5, sort: "fastest", filters: { excludePredatory: true } });
  assert.deepEqual(seen[1].body, {
    title: PAPER.title,
    abstract: PAPER.abstract,
    filters: { excludePredatory: true },
    sort: "fastest",
    maxResults: 5,
  });
  // The web app's bundles ("pre-check", "writer", "ai-review", "journal-finder"
  // surfaces, unlock, reviewRunId, sessionId, tier) are not reachable from a tool call.
  for (const s of seen) {
    for (const k of ["surface", "unlock", "reviewRunId", "sessionId", "tier", "holdout"]) {
      assert.equal(k in s.body, false, `${s.url} must not send ${k}`);
    }
  }
});

test("401 from the edge = the endpoint is not open to API keys yet; the key is not blamed", async () => {
  // journal/src/middleware.ts — the edge's literal 401.
  const edge = { error: { code: "UNAUTHORIZED", message: "Authentication required", requestId: "r-1" } };
  for (const [tool, web] of [
    ["pre_check_paper", "/scorer"],
    ["recommend_journals", "/journal-recommender"],
  ]) {
    reply(401, edge);
    const r = await call(tool, PAPER);
    assert.equal(r.isError, true);
    assert.match(r.text, new RegExp(`${tool} is not available through MCP yet`));
    assert.match(r.text, /nothing was charged/);
    assert.match(r.text, new RegExp(`${web.replace("/", "\\/")}$|${web.replace("/", "\\/")}\\b`));
    assert.doesNotMatch(r.text, /revoked|expired/);
  }
});

test("401 from the route's scope gate (a wildcard key before the server opens the tool) reads the same", async () => {
  // lib/partners/scopes.ts scopeRefusalBody — the edge's shape on purpose.
  reply(401, {
    error: {
      code: "UNAUTHORIZED",
      message: "This endpoint does not accept this API key yet. Keys need the tools:journal-finder scope here; nothing was charged.",
      scope: "tools:journal-finder",
    },
  });
  const r = await call("recommend_journals", PAPER);
  assert.equal(r.isError, true);
  assert.match(r.text, /recommend_journals is not available through MCP yet/);
  assert.match(r.text, /nothing was charged/);
});

test("401 from the route = a bad key (wrong, revoked or expired)", async () => {
  // Both routes: { error: "Sign in to use this tool.", requiresAuth: true }.
  for (const tool of ["pre_check_paper", "recommend_journals"]) {
    reply(401, { error: "Sign in to use this tool.", requiresAuth: true });
    const r = await call(tool, PAPER);
    assert.equal(r.isError, true);
    assert.match(r.text, /missing, revoked, or expired/);
    // A key minted for other tools only gets this same 401 from the route
    // (verifyApiKey nulls it), never a 403: the message has to name that case.
    assert.match(r.text, /limited to other tools/);
    assert.match(r.text, /settings\?section=api-keys/);
    assert.doesNotMatch(r.text, /not available through MCP yet/);
  }
});

test("403 = the key lacks the tool's scope; nothing charged", async () => {
  reply(403, { error: "This API key lacks the tools:journal-finder scope. Nothing was charged.", scope: "tools:journal-finder" });
  const r = await call("recommend_journals", PAPER);
  assert.equal(r.isError, true);
  assert.match(r.text, /^403 — this API key does not carry the tools:journal-finder scope, which recommend_journals needs/);
  assert.match(r.text, /Nothing was charged/);
});

test("426 = the server refuses an outdated package before any charge", async () => {
  reply(426, {
    error: {
      code: "UPGRADE_REQUIRED",
      message: "pre_check_paper needs science-ai-mcp-server 0.1.4 or newer.",
      minVersion: "0.1.4",
    },
  });
  const r = await call("pre_check_paper", PAPER);
  assert.equal(r.isError, true);
  assert.match(r.text, /^426 — pre_check_paper needs science-ai-mcp-server 0\.1\.4 or newer\./);
  assert.match(r.text, /Nothing was charged/);
  assert.match(r.text, /science-ai-mcp-server@latest/);
});

// ── Credits ───────────────────────────────────────────────────────────────
test("402 = not enough credits: says nothing was charged, the price and the balance", async () => {
  // lib/meter-tool.ts chargeToolOrReject → 402 { error, creditsNeeded, creditsAvailable }.
  for (const tool of ["pre_check_paper", "recommend_journals"]) {
    reply(402, { error: "Insufficient credits. This costs 15 credits.", creditsNeeded: 15, creditsAvailable: 3 });
    const r = await call(tool, PAPER);
    assert.equal(r.isError, true);
    assert.match(r.text, /^402 Insufficient credits — nothing was charged\./);
    assert.match(r.text, /needs 15 credits; the account has 3\./);
    assert.match(r.text, /\/pricing/);
  }
});

test("pre_check_paper: a charged run prints the three tiers and the evidence", async () => {
  // LocalScorerResult (lib/reviewers/scorer-local.ts) as the route returns it.
  reply(200, {
    tier1: "12%",
    tier2: "35%",
    tier3: "60%",
    field: "Engineering",
    fieldKey: "engineering",
    mode: "abstractOnly",
    tier: "basic",
    diagnostics: {
      hits: 143,
      corpusSize: 7900000,
      lowConfidence: false,
      thinInput: false,
      sparseClassified: false,
      scoreBasis: "curated_tier",
      tokensUsed: ["photovoltaic", "inverter", "grid"],
    },
  });
  const r = await call("pre_check_paper", PAPER);
  assert.equal(r.isError, false);
  assert.match(r.text, /Tier 1 probability: 12%/);
  assert.match(r.text, /Tier 2 probability: 35%/);
  assert.match(r.text, /Tier 3 probability: 60%/);
  assert.match(r.text, /143 similar papers retrieved from a 7,900,000-paper library/);
  assert.doesNotMatch(r.text, /—\n|Confidence: —/);
});

test("pre_check_paper: the repeat guard answers before the charge and says so", async () => {
  reply(200, {
    duplicate: true,
    runId: "run1",
    ranAt: "2026-11-15T08:00:00.000Z",
    minutesAgo: 4,
    historyHref: "/my-pre-checks/run1",
    cost: 15,
  });
  const r = await call("pre_check_paper", PAPER);
  assert.equal(r.isError, false);
  assert.match(r.text, /did not run again, and this call was not charged/);
  assert.match(r.text, /\/my-pre-checks\/run1/);
  assert.match(r.text, /force: true — that run is charged 15 credits/);
  assert.doesNotMatch(r.text, /Tier 1 probability/);
});

test("recommend_journals: a charged run prints the ranked list as the route sends it", async () => {
  // RecommendResponse (lib/journal-recommender/index.ts). An API-key call is
  // never a locked preview: the body carries no `journalFinder` lock block.
  reply(200, {
    recommendations: [
      {
        canonical: "Solar Energy",
        scorePct: 52,
        letterGrade: "B",
        pinnedBestMatch: true,
        topicOverlapTerms: ["photovoltaic", "inverter"],
        examplePapers: [{ title: "A PV inverter study", year: 2024, doi: "10.1/x" }],
        metadata: { tier: 1, quartile: 1, oaStatus: "hybrid", citedness2yr: 6.42, publisher: "Elsevier", isPredatory: false },
      },
      {
        canonical: "Scope Only Venue",
        scorePct: 9,
        letterGrade: "D",
        topicOverlapTerms: [],
        examplePapers: [],
        metadata: { tier: null, oaStatus: "gold", isPredatory: true, isBreadth: true },
      },
    ],
    executionMs: 812,
    indexJournalCount: 17786,
    ftsErrored: false,
  });
  const r = await call("recommend_journals", PAPER);
  assert.equal(r.isError, false);
  assert.match(r.text, /2 shown from a 17,786-journal index/);
  assert.match(r.text, /1\. Solar Energy {2}— {2}52% \(B\) · best match · Tier 1 · Q1 · hybrid OA · 2-yr mean citedness 6\.4 · Elsevier/);
  assert.match(r.text, /possibly predatory/);
  assert.doesNotMatch(r.text, /IF≈/);
});

test("recommend_journals: no match = refunded, and the result says so", async () => {
  reply(200, { recommendations: [], indexJournalCount: 17786, executionMs: 5, refunded: true });
  const r = await call("recommend_journals", PAPER);
  assert.equal(r.isError, false);
  assert.match(r.text, /No journal matched this input, and the charge for this call was refunded\./);
});

test("recommend_journals: a degraded search is flagged, never shown as a clean list", async () => {
  reply(200, { recommendations: [{ canonical: "X", scorePct: 40, letterGrade: "C", metadata: {} }], ftsErrored: true });
  const r = await call("recommend_journals", PAPER);
  assert.match(r.text, /\[warning\] the full-text search index errored, so these results are degraded\./);
});

// ── Error shapes ──────────────────────────────────────────────────────────
test("422 language gate: not charged, and the way through is named", async () => {
  for (const tool of ["pre_check_paper", "recommend_journals"]) {
    reply(422, {
      error: "This text doesn't look like English. … You have NOT been charged.",
      reason: "non_english_input",
      detected: "tr",
      usableTerms: 3,
    });
    const r = await call(tool, PAPER);
    assert.equal(r.isError, true);
    assert.match(r.text, /^422 — the text does not look like English/);
    assert.match(r.text, /Nothing was charged/);
    assert.match(r.text, new RegExp(`call ${tool} again with acknowledgeLowEnglish: true`));
  }
});

test("400 (a Boolean query the parser rejected) passes the server's own sentence through", async () => {
  reply(400, { error: "Invalid Boolean query: unbalanced parenthesis", position: 17, query: "(a OR b" });
  const r = await call("pre_check_paper", { ...PAPER, booleanQuery: "(a OR b" });
  assert.equal(r.isError, true);
  assert.match(r.text, /HTTP 400 from \/api\/scorer: .*Invalid Boolean query: unbalanced parenthesis.*"position":17/);
});

test("503 busy: not charged, with the wait", async () => {
  // api/scorer/route.ts LibraryDbBusyError → 503 { busy: true, retryAfterS } + Retry-After.
  reply(503, { error: "The library index is busy right now — … You have NOT been charged.", busy: true, reason: "queue_full", retryAfterS: 5 }, { "retry-after": "5" });
  const r = await call("pre_check_paper", PAPER);
  assert.equal(r.isError, true);
  assert.match(r.text, /^503 — the library index is busy right now, and nothing was charged\. Retry after 5s\./);
});

test("500 = the server failed; a charged call is refunded by the server", async () => {
  reply(500, { error: "Scoring failed" });
  const r = await call("pre_check_paper", PAPER);
  assert.equal(r.isError, true);
  assert.match(r.text, /HTTP 500 from \/api\/scorer: .*Scoring failed/);
  assert.match(r.text, /refunded automatically/);
});

test("502/504 from the gateway: never 'free', never 'just retry' — the run may have been charged", async () => {
  for (const status of [502, 504]) {
    reply(status, "<html><body>gateway</body></html>");
    const r = await call("recommend_journals", PAPER);
    assert.equal(r.isError, true);
    assert.match(r.text, new RegExp(`^HTTP ${status} from /api/journal-recommender`));
    assert.match(r.text, /may still have finished and been charged/);
    assert.match(r.text, /Check there before calling again/);
    assert.doesNotMatch(r.text, /nothing was charged|not charged/i);
  }
});

test("a 200 the formatter cannot read is reported as unreadable, never as a score or an empty list", async () => {
  reply(200, { tier1: "high", tier2: null });
  const a = await call("pre_check_paper", PAPER);
  assert.match(a.text, /could not read/);
  assert.doesNotMatch(a.text, /\b0%/);
  reply(200, { error: "x" });
  const b = await call("recommend_journals", PAPER);
  assert.match(b.text, /could not read/);
  assert.match(b.text, /not an empty result/);
});

// ── Rate limits ───────────────────────────────────────────────────────────
test("429 per-key limit: the server's sentence, the wait, and no charge", async () => {
  // lib/partners/api-limits.ts enforceApiKeyLimits.
  for (const [tool, label] of [
    ["pre_check_paper", "precheck"],
    ["recommend_journals", "journal-finder"],
  ]) {
    reply(
      429,
      {
        error: `Rate limit for this API key reached (60 calls a minute, 2000 a day, across all tools; this call: ${label}). Nothing was charged.`,
        retryAfterSeconds: 37,
      },
      { "retry-after": "37" },
    );
    const r = await call(tool, PAPER);
    assert.equal(r.isError, true);
    assert.match(r.text, /^429 Rate Limit — Rate limit for this API key reached \(60 calls a minute, 2000 a day/);
    assert.match(r.text, /Nothing was charged\. Retry after 37s\.$/);
  }
});

test("429 without a body (an edge or proxy limit) still says when to retry and that it was not charged", async () => {
  reply(429, "", { "retry-after": "60" });
  const r = await call("recommend_journals", PAPER);
  assert.equal(r.isError, true);
  assert.match(r.text, /^429 Rate Limit — too many requests\. Retry after 60s\. A refused call is not charged\.$/);
});

// ── Input validation happens before any HTTP call ─────────────────────────
test("a call without a title is refused by the tool's schema and never reaches the server", async () => {
  const r = await call("pre_check_paper", { abstract: PAPER.abstract });
  assert.equal(r.isError, true);
  assert.equal(seen.length, 0);
});
