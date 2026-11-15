/**
 * Formatter for pre_check_paper — the answer of POST /api/scorer, as text.
 *
 * NO IMPORTS, on purpose: the app's test suite
 * (journal/src/lib/__tests__/mcp-honesty-0927c.test.ts) runs this file
 * directly against the route's real response shapes, without the MCP SDK.
 *
 * What the route actually returns (journal/src/lib/reviewers/scorer-local.ts,
 * LocalScorerResult, and journal/src/app/api/scorer/route.ts):
 *   - tier1 / tier2 / tier3 are STRINGS such as "35%" (integers 0-95);
 *   - there is NO top-level `confidence`. How much evidence the estimate rests
 *     on lives in `diagnostics`: hits, corpusSize, lowConfidence, thinInput,
 *     sparseClassified and scoreBasis ("curated_tier" | "quartile_fallback" |
 *     "base_rate");
 *   - a repeat of the same title + abstract within the guard window returns
 *     { duplicate: true, runId, ranAt, minutesAgo, historyHref, cost } BEFORE
 *     any charge, and `force: true` in the request skips that guard.
 * Up to 0.1.3 this tool read tier1-3 as numbers and a top-level confidence, so
 * a call the server had charged printed "—" for every tier and every
 * confidence, and a duplicate answer printed as an empty score.
 *
 * A reply this formatter cannot read is reported as exactly that — never as a
 * blank or zero score (a parse failure is "the gate did not run", never a
 * neutral default).
 */

export interface ScorerDiagnosticsLike {
  hits?: unknown;
  corpusSize?: unknown;
  lowConfidence?: unknown;
  thinInput?: unknown;
  sparseClassified?: unknown;
  scoreBasis?: unknown;
  tokensUsed?: unknown;
}

export interface ScorerResponseLike {
  duplicate?: unknown;
  runId?: unknown;
  ranAt?: unknown;
  minutesAgo?: unknown;
  historyHref?: unknown;
  cost?: unknown;
  tier1?: unknown;
  tier2?: unknown;
  tier3?: unknown;
  field?: unknown;
  fieldKey?: unknown;
  booleanQueryEcho?: unknown;
  diagnostics?: ScorerDiagnosticsLike;
  comparableEvidence?: unknown;
  [k: string]: unknown;
}

export interface PreCheckFormatOptions {
  /** Site origin, e.g. "https://scienceaijournal.com" (no trailing slash). */
  baseUrl: string;
}

const ISSUES_URL = "https://github.com/SelfPy/science-ai-mcp-server/issues";

/**
 * A probability as a percentage (0-100), or null when it cannot be read.
 *
 *   "35%"  → 35    the route's shape
 *   "35"   → 35    a bare numeric string is read as a percentage
 *   0.35   → 35    a number from 0 to 1 is a fraction (the 0.1.3 contract)
 *   35     → 35    a number above 1 is already a percentage
 * Anything else — negative, above 100, NaN, text, null — is null.
 */
export function parsePercent(v: unknown): number | null {
  if (typeof v === "number") {
    if (!Number.isFinite(v) || v < 0) return null;
    const pct = v <= 1 ? v * 100 : v;
    return pct <= 100 ? pct : null;
  }
  if (typeof v === "string") {
    const m = v.trim().match(/^(\d+(?:\.\d+)?)\s*%?$/);
    if (!m) return null;
    const n = Number(m[1]);
    return Number.isFinite(n) && n <= 100 ? n : null;
  }
  return null;
}

const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;
const str = (v: unknown): string | null =>
  typeof v === "string" && v.trim() ? v.trim() : null;

const BASIS: Record<string, string> = {
  curated_tier: "the curated acceptance tiers of the journals those papers appeared in",
  quartile_fallback:
    "the Scimago quartiles of the journals those papers appeared in (there is no curated tier data for this field yet)",
  base_rate: "field base rates, not a fit to this specific paper",
};

/** The duplicate-guard answer: nothing ran and nothing was charged. */
function formatDuplicate(r: ScorerResponseLike, baseUrl: string): string {
  const minutes = num(r.minutesAgo);
  const when =
    minutes != null ? `${minutes} minute${minutes === 1 ? "" : "s"} ago` : "recently";
  const ranAt = str(r.ranAt);
  const href = str(r.historyHref);
  const cost = num(r.cost);
  const lines = [
    "Pre-Check did not run again, and this call was not charged.",
    `  You already ran Pre-Check on this same title and abstract ${when}${ranAt ? ` (${ranAt})` : ""}.`,
  ];
  if (href) {
    const url = /^https?:\/\//.test(href) ? href : `${baseUrl}${href.startsWith("/") ? "" : "/"}${href}`;
    lines.push(`  That result is saved in the account's Pre-Check history: ${url}`);
  }
  lines.push(
    "  To score it again anyway, call pre_check_paper again with force: true" +
      (cost != null ? ` — that run is charged ${cost} credits.` : " — that run is charged as usual."),
  );
  return lines.join("\n");
}

export function formatScorerResult(raw: unknown, opts: PreCheckFormatOptions): string {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return (
      "Pre-Check sent a reply this tool could not read (not a JSON object). " +
      `This is a problem in science-ai-mcp-server, not a score; please report it at ${ISSUES_URL}.`
    );
  }
  const r = raw as ScorerResponseLike;
  if (r.duplicate === true) return formatDuplicate(r, opts.baseUrl);

  const tiers = [r.tier1, r.tier2, r.tier3].map(parsePercent);
  if (tiers.every((t) => t == null)) {
    const shown = (v: unknown) => (v === undefined ? "missing" : JSON.stringify(v));
    return (
      "Pre-Check sent a reply this tool could not read: no tier probability in it was a percentage " +
      `(tier1=${shown(r.tier1)}, tier2=${shown(r.tier2)}, tier3=${shown(r.tier3)}). ` +
      `This is a problem in science-ai-mcp-server, not a score; please report it at ${ISSUES_URL}.`
    );
  }
  const pct = (i: number) => {
    const t = tiers[i];
    const rawV = [r.tier1, r.tier2, r.tier3][i];
    return t == null ? `unreadable (${JSON.stringify(rawV ?? null)})` : `${Math.round(t)}%`;
  };

  const lines: string[] = ["Pre-Check result"];
  const field = str(r.field);
  lines.push(
    `  Detected field: ${field ?? "not detected"}` +
      (r.fieldKey === null && field ? " (low-confidence detection)" : ""),
  );
  lines.push(`  Tier 1 probability: ${pct(0)}`);
  lines.push(`  Tier 2 probability: ${pct(1)}`);
  lines.push(`  Tier 3 probability: ${pct(2)}`);

  const d = r.diagnostics && typeof r.diagnostics === "object" ? r.diagnostics : null;
  if (d) {
    const hits = num(d.hits);
    const corpus = num(d.corpusSize);
    if (hits != null) {
      lines.push(
        `  Evidence: ${hits.toLocaleString("en-US")} similar paper${hits === 1 ? "" : "s"} retrieved` +
          (corpus != null ? ` from a ${corpus.toLocaleString("en-US")}-paper library` : "") +
          ".",
      );
    }
    const basis = typeof d.scoreBasis === "string" ? BASIS[d.scoreBasis] : undefined;
    if (basis) lines.push(`  Tiers estimated from: ${basis}.`);
    if (d.lowConfidence === true) {
      lines.push(
        "  Low confidence: too few similar papers were found, so the tiers fall back to base rates for the field.",
      );
    } else if (d.thinInput === true) {
      lines.push("  Provisional: the abstract is very short. Pass the full abstract for a reliable estimate.");
    } else if (d.sparseClassified === true || d.scoreBasis === "quartile_fallback" || d.scoreBasis === "base_rate") {
      lines.push("  Provisional: treat these tiers as a rough estimate.");
    }
    const tokens = Array.isArray(d.tokensUsed)
      ? d.tokensUsed.filter((t): t is string => typeof t === "string").slice(0, 6)
      : [];
    if (tokens.length > 0) lines.push(`  Topics matched: ${tokens.join(", ")}`);
  }

  const echo = str(r.booleanQueryEcho);
  if (echo) lines.push(`  Boolean query used: ${echo}`);

  if (Array.isArray(r.comparableEvidence) && r.comparableEvidence.length > 0) {
    const papers = r.comparableEvidence
      .map((e) => (e && typeof e === "object" ? (e as Record<string, unknown>) : null))
      .filter((e): e is Record<string, unknown> => !!e && !!str(e.title))
      .slice(0, 3);
    if (papers.length > 0) {
      lines.push("");
      lines.push("Papers like yours in the library:");
      for (const p of papers) {
        const journal = str(p.journal);
        lines.push(`  - ${str(p.title)}${journal ? ` — ${journal}` : ""}`);
      }
    }
  }
  return lines.join("\n");
}
