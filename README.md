# science-ai-mcp-server

[Model Context Protocol](https://modelcontextprotocol.io/) server for [Science AI Journal](https://scienceaijournal.com) research tools. Run a specialist AI Review agent, the research-gap literature search, the duplicate-publication check, Pre-Check and the Journal Finder from inside Claude Desktop, Claude Code, Cursor, Cline, or any MCP-enabled client — without leaving your assistant. Pre-Check and the Journal Finder need version 0.1.4 or later and open on the server after that release (see [Tools](#tools)).

Full docs: **<https://scienceaijournal.com/developers/mcp>**

## Quick start (≈ 2 minutes)

1. Generate an API key at <https://scienceaijournal.com/settings?section=api-keys> (free account required). Copy the `saij_…` token — you only see it once.
2. Add this block to your Claude Desktop config file:

   ```json
   {
     "mcpServers": {
       "science-ai-journal": {
         "command": "npx",
         "args": ["-y", "science-ai-mcp-server"],
         "env": {
           "SCIENCE_AI_API_KEY": "saij_…paste your key…"
         }
       }
     }
   }
   ```

   Config file locations:
   - **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
   - **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`
   - **Linux:** `~/.config/Claude/claude_desktop_config.json`

3. Restart Claude Desktop. The `science-ai-journal` server appears in the 🔌 tool list.

The same config works in **Cursor** (`~/.cursor/mcp.json`), **Cline** (via the VS Code extension panel), and **Continue** (anywhere that supports an `mcpServers` object). In **Claude Code**, one command adds it:

```sh
claude mcp add science-ai-journal --env SCIENCE_AI_API_KEY=saij_… -- npx -y science-ai-mcp-server
```

Calling the API from your own code instead of an assistant? The endpoints, prices and error shapes are at <https://scienceaijournal.com/developers/api>.

## Tools

<!--
  Credit figures are typed here because this package cannot import the app.
  Source of truth: journal/src/lib/credits-constants.ts (SERVICE_COSTS.precheck,
  .recommender, .literature_table, WELCOME_CREDITS, CREDIT_PACK_SIZE and
  REVIEW_API_PER_CALL_COST, the per-call AI Review rate the review route reads).
  journal/src/lib/__tests__/marketing-price-claims.test.ts fails if they drift.

  Which tools are live is decided by the app's edge gate (MCP_ELIGIBLE_PATHS in
  journal/src/middleware.ts) and, for the Journal Finder, the route's scope
  gate — not by this package. journal/src/lib/__tests__/mcp-honesty-0927c.test.ts
  fails if the "Live today" table lists a tool an API key cannot reach, or the
  "Private beta" table one it can. The "From 0.1.4" table is worded to be true
  both before and after the server opens those two endpoints, because a README
  is frozen into the npm tarball and the server opens them only AFTER npm
  serves 0.1.4.
-->

### Live today

| Tool | What it does | Cost |
| --- | --- | --- |
| `find_research_gaps` | Free literature search: field overview, closest papers from a 7.9M-paper library, most-cited and most-recent work | Free search |
| `check_duplicate_publication` | Cross-reference against CrossRef, PubMed, arXiv, bioRxiv, medRxiv, Europe PMC, Unpaywall and a 7.9M-paper library | Free |
| `ai_review_paper` | One specialist reviewer agent on a prepared manuscript prompt | 4 credits per call |

### From 0.1.4: Pre-Check and the Journal Finder

Both run on the local library and index, with no LLM call, and both are metered: a call is charged to the API key's account, exactly once.

| Tool | What it does | Cost |
| --- | --- | --- |
| `pre_check_paper` | Tier 1, 2 and 3 acceptance probabilities from title + abstract, the detected field, and how many similar papers the estimate rests on (local 7.9M-paper library) | 15 credits per call |
| `recommend_journals` | Ranked target journals from a 17,500-venue index: grade, tier, quartile, access, 2-year mean citedness, responding times where reported, predatory-journal flags | 15 credits per call |

- **Availability.** The server opens these two endpoints to API keys in the server release that follows the publication of 0.1.4; the current status is on <https://scienceaijournal.com/developers/mcp>. Until then a call answers "not available through MCP yet" and nothing is charged; the same tools run in the web app — [Pre-Check](https://scienceaijournal.com/scorer) and the [Journal Finder](https://scienceaijournal.com/journal-recommender). Versions before 0.1.4 cannot use them at all: the server answers those with HTTP 426 and charges nothing.
- **What is never charged.** A wrong or revoked key (401), an account without enough credits (402, the message names the price and the balance), a key limited to other tools (401, the same answer as a wrong key), a text that does not look like English (422), a rate-limited call (429) and a busy library index (503) are all refused before the charge. A repeat of a Pre-Check the account ran recently returns the saved result's link instead of charging again (`force: true` runs it again). A Journal Finder call that matches no journal is refunded.
- **Non-English text.** The library and the journal index are English-language. Pass `acknowledgeLowEnglish: true` to run such a text anyway; that run is charged as usual and the result is rough.
- **How to read the results.** Pre-Check's probabilities are estimates from similar published papers; the Journal Finder's list is a ranked shortlist of candidates to check against each journal's aims and scope. Neither is a prediction that a given journal will accept the paper.
- **One call, one purchase.** An API-key call is priced on its own. The web app's bundles (for example the journal list that comes with a Pre-Check run there) apply to signed-in browser sessions, not to API keys.

### Private beta

| Tool | What it does | Cost |
| --- | --- | --- |
| `start_writer_pipeline` / `get_writer_pipeline_status` | Drive the Article Writer pipeline from outside the wizard | Private beta |

The two writer tools get HTTP 404 while the Article Writer is in private beta: writer access is checked against a signed-in browser session, which an API key does not carry — so this holds for every key, including those of accounts with writer access. Nothing is charged.

- **Research gaps:** `find_research_gaps` is the free search, so it returns `gaps: []` and `gapsLocked: true`. The gaps come from unlocking the topic at <https://scienceaijournal.com/research-gaps> — one charge of 50 credits that also includes the filled comparison table, a research proposal and one Pro Report run.
- **Credits:** a free account starts with 25 welcome credits; after that, credits come in one-time packs of 50 that never expire, with no subscription. A call the account can't afford returns HTTP 402 and charges nothing.

What changed in each version: [CHANGELOG.md](./CHANGELOG.md).

## Configuration

| Env var | Default | Purpose |
| --- | --- | --- |
| `SCIENCE_AI_API_KEY` | _required_ | Your `saij_…` token |
| `SCIENCE_AI_BASE_URL` | `https://scienceaijournal.com` | Override for self-hosted or staging environments |

## Troubleshooting

- **Tools don't appear after editing config:** fully quit the host app (not just close the window) and reopen.
- **"Not available through MCP yet" from `pre_check_paper` or `recommend_journals`:** the server has not opened that endpoint to API keys yet (see above). Every key gets this answer there, it says nothing about your key, and nothing is charged. Use the web app meanwhile.
- **426 from `pre_check_paper` or `recommend_journals`:** the MCP client is still running a package older than 0.1.4. Restart it so `npx -y science-ai-mcp-server@latest` starts the current one. Nothing is charged.
- **401 "missing, revoked, or expired, or limited to other tools":** the key was wrong, revoked or expired, or it was minted for other tools only. Mint a fresh one at Settings → API Keys. Nothing is charged.
- **402 insufficient credits:** nothing was charged. Top up at <https://scienceaijournal.com/pricing>; the free tools keep working.
- **404 from the writer tools:** the Article Writer is in private beta, and during the beta every API key gets a 404 there.
- **429 rate limit on `find_research_gaps`:** you hit the 10-per-hour IP quota. Wait an hour.
- **429 on any other tool:** each API key has a per-minute and a per-day limit across all tools. The error says when to retry; a refused call is not charged.
- **502 or 504 from a metered tool:** the answer was lost on the way, but the run may have finished and been charged. A finished run is saved in the account's history in the web app; look there before calling again.
- **`npx` can't resolve the package:** ensure Node ≥ 20 and that your npm registry isn't set to a private mirror without this package yet (`npm config set registry https://registry.npmjs.org/`).

## License

MIT
