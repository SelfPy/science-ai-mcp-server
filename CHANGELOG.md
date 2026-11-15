# Changelog

## Which tools are live

A tool is live when the Science AI Journal server accepts API keys on the endpoint it calls. That is decided on the server, not by this package: a package version can register a tool before its endpoint opens. The current status is on <https://scienceaijournal.com/developers/mcp>.

| Tool | Endpoint | Status on the server |
| --- | --- | --- |
| `find_research_gaps` | `/api/research-gaps` | Live |
| `check_duplicate_publication` | `/api/prior-publication` | Live |
| `ai_review_paper` | `/api/review/claude` | Live |
| `pre_check_paper` | `/api/scorer` | From 0.1.4 — the server opens this endpoint to API keys in the server release that follows the publication of 0.1.4. Until then every API key gets HTTP 401 and nothing is charged. Web app: <https://scienceaijournal.com/scorer> |
| `recommend_journals` | `/api/journal-recommender` | From 0.1.4 — the server opens this endpoint to ordinary API keys in the server release that follows the publication of 0.1.4. Until then they get HTTP 401 and nothing is charged. Web app: <https://scienceaijournal.com/journal-recommender> |
| `start_writer_pipeline` / `get_writer_pipeline_status` | `/api/writer/pipeline` | Coming soon — private beta: the server answers every API key with 404 (writer access is checked against a signed-in browser session, which an API key does not carry) |

## 0.1.4 — 2026-11-15

The release that makes Pre-Check and the Journal Finder usable from an assistant. Both run on the local library with no LLM call.

- `pre_check_paper` reads the answer the server actually sends: tier probabilities arrive as strings such as `"35%"` (0.1.3 expected numbers and printed "—" for every tier), and there is no top-level confidence (0.1.3 printed "—"). The result now states how many similar papers the estimate rests on, what the tiers were estimated from, and whether the result is low-confidence or provisional.
- `pre_check_paper` handles the server's repeat guard: a title + abstract the account ran recently returns a link to the saved result and is not charged. The new `force: true` input scores it again (charged as usual).
- `recommend_journals` reads the answer the server actually sends: access as open / hybrid / subscription (0.1.3 read a legacy flag that only meant fully open), 2-year mean citedness labelled as such (0.1.3 printed it as "IF≈", but it is not the Journal Impact Factor), Scimago quartile, venues matched by topic scope alone, input-quality warnings, a degraded-search warning, and the refund when nothing matches. A reply without a recommendations list is reported instead of crashing.
- A reply either tool cannot read is reported as unreadable, never as an empty or zero result.
- New input on both tools: `acknowledgeLowEnglish: true` runs a text the server would otherwise refuse as not English (the library and the journal index are English-language). Without it such a call gets HTTP 422 and is not charged.
- Errors say whether the call was charged and what to do next: 401 from an endpoint that does not accept API keys yet ("not available through MCP yet", nothing charged; 0.1.3 told the user their key was missing, revoked or expired), 402 with the price and the balance, 401 for a key limited to other tools (the server answers it as it answers a wrong key), 422 for non-English text, 426 when the server refuses an outdated package, 429 with the wait, 503 when the library index is busy, 500 (a charged call is refunded by the server), and 502 / 504 from the gateway (the run may have finished and been charged: look in the account's history before calling again).
- The descriptions of both tools say what the result is: estimates and a shortlist of candidates to check, not a prediction of acceptance.
- The writer tools' descriptions and their 404 message say the Article Writer is in private beta and that, during the beta, every API key gets a 404. 0.1.3 did not mention the gate, so an agent saw a bare "HTTP 404".
- Prices: `pre_check_paper` and `recommend_journals` are metered (15 credits per call once enabled). 0.1.3's descriptions called both free. `ai_review_paper` costs 4 credits per call. `find_research_gaps` is the free literature search and returns no gaps (`gapsLocked: true`); the gaps come from unlocking the topic in the web app for 50 credits.
- The MCP handshake and the User-Agent report the installed package version (0.1.3 always reported 0.1.0). Once the server opens the two metered endpoints it refuses packages older than 0.1.4 on them with HTTP 426 and no charge, so an outdated install can neither be billed for an answer it cannot print nor be told a metered call costs nothing.
- `ai_review_paper` lists the review engine's agents; `plagiarism` is kept as an alias for `originality`.
- `check_duplicate_publication`'s description says what the check does. 0.1.3 called it a "salami-slicing check" (it matches one title + abstract against published records; it does not compare a manuscript with the author's other papers), promised results "in ~30 seconds" (the 7 external sources and the local library are queried in parallel, each capped at 12 seconds), and listed three of the five statuses the server returns — `preprint_found` and `unable_to_check` were missing. It now also says that the other six external sources search by title (an abstract only helps confirm a close match), that Unpaywall is looked up by DOI, so only when `doi` is passed, that the check is rate-limited per account, and that a 429 says when to retry. The check itself is unchanged and still spends no credits.
- Packaging: publishing always makes a clean build and runs the test suite first (`npm test`: 30 checks against a local mock of the server; nothing is sent to the real site).

## 0.1.3 and earlier

- 0.1.3 renamed `hakem_review_paper` to `ai_review_paper`. Earlier history is in the repository's git log.
