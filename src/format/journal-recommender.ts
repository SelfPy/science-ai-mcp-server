/**
 * Formatter for recommend_journals — the answer of POST /api/journal-recommender,
 * as text.
 *
 * NO IMPORTS, on purpose: the app's test suite
 * (journal/src/lib/__tests__/mcp-honesty-0927c.test.ts) runs this file
 * directly against the route's real response shape, without the MCP SDK.
 *
 * Shape (journal/src/lib/journal-recommender/index.ts, RecommendResponse and
 * JournalRecommendation; journal/src/app/api/journal-recommender/route.ts):
 *   - `recommendations[]`, each with canonical, scorePct (0-100), letterGrade,
 *     pinnedBestMatch?, topicOverlapTerms, examplePapers[] and a `metadata`
 *     block. Access is `metadata.oaStatus` ("gold" | "hybrid" |
 *     "subscription" | "unknown"); `openAccess` is the legacy boolean and
 *     means gold only. `citedness2yr` is OpenAlex's 2-year mean citedness —
 *     an open proxy, NOT the Journal Impact Factor (0.1.3 printed it as
 *     "IF≈"). `isBreadth` venues are matched by topic scope and have no
 *     papers in the library, so they carry no example papers;
 *   - `refunded: true` when nothing matched: the route gives the charge back;
 *   - `inputQuality` when the text looked corrupted or like a cover sheet;
 *   - `externalFallback.fired` when library coverage was thin and external
 *     indexes were searched too.
 * 0.1.3 read `result.recommendations.length` unguarded, so any reply without
 * that array (an error body that slipped through as 200) threw a TypeError
 * instead of saying what happened.
 */

type Obj = Record<string, unknown>;

const ISSUES_URL = "https://github.com/SelfPy/science-ai-mcp-server/issues";

const obj = (v: unknown): Obj | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : null;
const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;
const str = (v: unknown): string | null =>
  typeof v === "string" && v.trim() ? v.trim() : null;

const ACCESS: Record<string, string> = {
  gold: "open access",
  hybrid: "hybrid OA",
  subscription: "subscription",
  unknown: "access unknown",
};

function accessLabel(m: Obj): string {
  const s = str(m.oaStatus);
  if (s && ACCESS[s]) return ACCESS[s];
  return m.openAccess === true ? "open access" : "access unknown";
}

/** Days as "~3 wk" when a whole number of weeks, else "45 d". */
function days(d: number): string {
  return d % 7 === 0 ? `~${d / 7} wk` : `${Math.round(d)} d`;
}

const RT_STAGES: Array<[string, string]> = [
  ["firstDecisionDays", "first decision"],
  ["postReviewDays", "post-review"],
  ["submissionToAcceptanceDays", "to acceptance"],
  ["submissionToPublicationDays", "to publication"],
  ["acceptanceToPublicationDays", "acceptance→publication"],
];

function respondingTimeLine(rtRaw: unknown): string | null {
  const rt = obj(rtRaw);
  if (!rt) return null;
  const parts: string[] = [];
  const sources = new Set<string>();
  for (const [key, label] of RT_STAGES) {
    const metric = obj(rt[key]);
    const d = metric ? num(metric.days) : null;
    if (metric && d != null) {
      parts.push(`${label} ${days(d)}`);
      const src = str(metric.source);
      if (src) sources.add(src);
    }
  }
  const rate = obj(rt.acceptanceRatePct);
  const pct = rate ? num(rate.pct) : null;
  if (rate && pct != null) {
    parts.push(`acceptance rate ${pct}%`);
    const src = str(rate.source);
    if (src) sources.add(src);
  }
  if (parts.length === 0) return null;
  return `responding time: ${parts.join(" · ")}${sources.size ? `  [${[...sources].join("/")}]` : ""}`;
}

function templateLine(tRaw: unknown): string | null {
  const t = obj(tRaw);
  if (!t) return null;
  const tags: string[] = [];
  if (t.hasLatexClass === true) tags.push("LaTeX class ✓");
  if (t.hasDocx === true) tags.push("docx ✓");
  if (t.lastCompileOk === true) tags.push("compiles ✓");
  else if (t.lastCompileOk === false) tags.push("compile ✗");
  const lic = str(t.licenseSpdx);
  if (lic) tags.push(lic);
  if (t.redistributable === false) tags.push("⚠ user-supplied template required");
  return tags.length ? `template: ${tags.join(" · ")}` : null;
}

function formatOne(i: number, recRaw: unknown): string[] {
  const r = obj(recRaw);
  const name = r ? str(r.canonical) : null;
  if (!r || !name) return [`  ${i + 1}. (an entry this tool could not read)`];
  const m = obj(r.metadata) ?? {};
  const bits: string[] = [];
  const score = num(r.scorePct);
  const grade = str(r.letterGrade);
  bits.push(score != null ? `${Math.round(score)}%${grade ? ` (${grade})` : ""}` : grade ?? "score n/a");
  if (r.pinnedBestMatch === true) bits.push("best match");
  const tier = num(m.tier);
  bits.push(tier != null ? `Tier ${tier}` : "tier n/a");
  const q = num(m.quartile);
  if (q != null) bits.push(`Q${q}`);
  bits.push(accessLabel(m));
  const cited = num(m.citedness2yr);
  if (cited != null) bits.push(`2-yr mean citedness ${cited.toFixed(1)}`);
  const publisher = str(m.publisher);
  if (publisher) bits.push(publisher);
  if (m.isPreprint === true) bits.push("preprint server");
  if (m.isPredatory === true) bits.push("⚠ flagged as possibly predatory");

  const lines = [`  ${i + 1}. ${name}  —  ${bits.join(" · ")}`];
  const indent = "        ";
  if (m.isBreadth === true) lines.push(`${indent}matched by topic scope — no papers from this venue in our library`);
  const overlap = Array.isArray(r.topicOverlapTerms)
    ? r.topicOverlapTerms.filter((t): t is string => typeof t === "string").slice(0, 5)
    : [];
  if (overlap.length > 0) lines.push(`${indent}topic overlap: ${overlap.join(", ")}`);
  const tpl = templateLine(m.template);
  if (tpl) lines.push(`${indent}${tpl}`);
  const rt = respondingTimeLine(m.respondingTime);
  if (rt) lines.push(`${indent}${rt}`);
  const examples = Array.isArray(r.examplePapers) ? r.examplePapers : [];
  for (const pRaw of examples.slice(0, 2)) {
    const p = obj(pRaw);
    const title = p ? str(p.title) : null;
    if (!p || !title) continue;
    const y = num(p.year);
    const doi = str(p.doi);
    lines.push(`${indent}e.g. ${title}${y ? ` (${y})` : ""}${doi ? `  doi:${doi}` : ""}`);
  }
  return lines;
}

export function formatRecommendations(raw: unknown): string {
  const res = obj(raw);
  if (!res || !Array.isArray(res.recommendations)) {
    return (
      "The Journal Finder sent a reply this tool could not read (no recommendations list in it). " +
      `This is a problem in science-ai-mcp-server, not an empty result; please report it at ${ISSUES_URL}.`
    );
  }
  const recs = res.recommendations as unknown[];
  const indexCount = num(res.indexJournalCount);
  const ms = num(res.executionMs);
  const lines: string[] = [];
  lines.push(
    `Journal recommendations: ${recs.length} shown` +
      (indexCount != null ? ` from a ${indexCount.toLocaleString("en-US")}-journal index` : "") +
      (ms != null ? ` (${Math.round(ms)} ms)` : ""),
  );

  const iq = obj(res.inputQuality);
  const iqReason = iq ? str(iq.reason) : null;
  if (iqReason) lines.push(`  [input warning] ${iqReason}`);
  if (res.ftsErrored === true) {
    lines.push("  [warning] the full-text search index errored, so these results are degraded.");
  }
  const fb = obj(res.externalFallback);
  if (fb && fb.fired === true) {
    lines.push(
      "  [note] the library's coverage of this topic was thin, so external scholarly indexes were searched as well.",
    );
  }

  if (recs.length === 0) {
    lines.push("");
    lines.push(
      res.refunded === true
        ? "No journal matched this input, and the charge for this call was refunded."
        : "No journal matched this input.",
    );
    return lines.join("\n");
  }

  lines.push("");
  recs.forEach((rec, i) => lines.push(...formatOne(i, rec)));
  return lines.join("\n");
}
