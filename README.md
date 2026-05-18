# science-ai-mcp-server

[Model Context Protocol](https://modelcontextprotocol.io/) server for [Science AI Journal](https://scienceaijournal.com) tools. Use Pre-Check, AI Review, Research Gaps, Journal Recommender, Duplicate Publication Checker, and the Article Writer from inside Claude Desktop, Cursor, Cline, or any MCP-enabled client — without leaving your assistant.

Full docs and screenshots: **<https://scienceaijournal.com/developers/mcp>**

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

The same config works in **Cursor** (`~/.cursor/mcp.json`), **Cline** (via the VS Code extension panel), and **Continue** (anywhere that supports an `mcpServers` object).

## Tools

| Tool | What it does | Cost |
| --- | --- | --- |
| `pre_check_paper` | Tier 1-5 acceptance probability from title + abstract (local FTS5, no LLM) | Free |
| `check_duplicate_publication` | Cross-reference against CrossRef + arXiv + medRxiv + bioRxiv + Unpaywall + a 900k-paper library | Free |
| `recommend_journals` | Ranked target journals from a 1,214-venue index, with predatory-journal flags | Free |
| `find_research_gaps` | Synthesised gaps + most-cited + most-recent papers around your query | Credits |
| `hakem_review_paper` | Single-agent HAKEM peer-review pass on a prepared prompt | Credits |
| `start_writer_pipeline` / `get_writer_pipeline_status` | Drive the Article Writer pipeline from outside the wizard | Credits |

## Configuration

| Env var | Default | Purpose |
| --- | --- | --- |
| `SCIENCE_AI_API_KEY` | _required_ | Your `saij_…` token |
| `SCIENCE_AI_BASE_URL` | `https://scienceaijournal.com` | Override for self-hosted or staging environments |

## Troubleshooting

- **Tools don't appear after editing config:** fully quit the host app (not just close the window) and reopen.
- **401 unauthorized when calling a tool:** the key was wrong, revoked, or expired. Mint a fresh one at Settings → API Keys.
- **429 rate limit on `find_research_gaps`:** you hit the 10-per-hour IP quota. Wait an hour.
- **`npx` can't resolve the package:** ensure Node ≥ 20 and that your npm registry isn't set to a private mirror without this package yet (`npm config set registry https://registry.npmjs.org/`).

## License

MIT
